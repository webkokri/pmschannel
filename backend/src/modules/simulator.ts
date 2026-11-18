import { Router } from 'express';
import { z } from 'zod';
import { addDays, nightsBetween, todayIso, type NormalizedBooking } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, parse } from '../lib/http';
import { requireRole } from '../auth';
import { propertyScope, requireOrg } from '../lib/tenant';
import { getOrgSetting, setOrgSetting } from '../lib/settings';
import { MockConnector } from '../connectors/mock/mock-connector';
import { resolveConnection } from '../connectors/registry';
import { ingestBooking } from '../engine/ingest';
import { recomputeAvailability } from '../engine/ari';

export const simulatorRouter = Router();
simulatorRouter.use(requireOrg);

/** List the connections available to drive from the simulator. */
simulatorRouter.get(
  '/targets',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const scope = propertyScope(req);
    const connections = await prisma.channelConnection.findMany({
      where: { organizationId, enabled: true, roomMappings: { some: { active: true } }, ...(scope ? { propertyId: scope } : {}) },
      include: {
        channel: { select: { name: true, code: true, kind: true } },
        property: { select: { name: true, code: true } },
        _count: { select: { roomMappings: true } },
      },
    });
    const autopilot = (await getOrgSetting(organizationId, 'mock:autopilot')) ?? {
      enabled: false,
      lambdaByChannel: {},
    };
    res.json({ connections, autopilot });
  }),
);

const generateInput = z.object({
  connectionIds: z.array(z.string()).min(1),
  count: z.number().int().min(1).max(200).default(10),
  horizonDays: z.number().int().min(1).max(120).default(45),
  avgStayNights: z.number().int().min(1).max(21).default(2),
});

/** Generate N random bookings spread across the chosen connections, via ingest. */
simulatorRouter.post(
  '/generate',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const scope = propertyScope(req);
    const body = parse(generateInput, req.body);
    const conns = await prisma.channelConnection.findMany({
      where: { id: { in: body.connectionIds }, organizationId, ...(scope ? { propertyId: scope } : {}) },
      include: { channel: true },
    });
    if (conns.length === 0) throw badRequest('No matching connections');

    const outcomes = [];
    for (let i = 0; i < body.count; i++) {
      const conn = conns[i % conns.length];
      const { ctx } = await resolveConnection(conn.id);
      if (ctx.roomMap.length === 0) continue;
      const mock = new MockConnector(conn.channel.code);
      const booking = await mock.invent(ctx, { horizonDays: body.horizonDays, avgStayNights: body.avgStayNights });
      const outcome = await ingestBooking(conn.channel.code, booking, {
        simulated: true,
        sourceConnectionId: conn.id,
      });
      outcomes.push({ channel: conn.channel.code, ...outcome });
    }

    res.json({
      generated: outcomes.length,
      created: outcomes.filter((o) => o.action === 'created').length,
      rejected: outcomes.filter((o) => o.rejected).length,
      conflicts: outcomes.flatMap((o) => o.conflictIds),
      totalFanout: outcomes.reduce((s, o) => s + o.fannedOutTo, 0),
      outcomes,
    });
  }),
);

const overbookInput = z.object({
  propertyId: z.string().optional(),
  roomTypeId: z.string().optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nights: z.number().int().min(1).max(14).default(2),
});

/**
 * Deliberately create an overbooking: fill a room to capacity from one channel,
 * then push one more reservation for overlapping dates from a *different*
 * channel. Demonstrates the conflict guard + auto-protect.
 */
simulatorRouter.post(
  '/overbooking',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const scope = propertyScope(req);
    const body = parse(overbookInput, req.body);
    if (scope && body.propertyId && body.propertyId !== scope) throw badRequest('No room type with active channel mappings found');

    const roomType = body.roomTypeId
      ? await prisma.roomType.findFirst({ where: { id: body.roomTypeId, property: { organizationId, id: scope ?? undefined } } })
      : await prisma.roomType.findFirst({
          where: {
            property: { organizationId, id: scope ?? body.propertyId },
            roomMappings: { some: { active: true, channelConnection: { enabled: true } } },
          },
          orderBy: { totalUnits: 'asc' },
        });
    if (!roomType) throw badRequest('No room type with active channel mappings found');

    const conns = await prisma.channelConnection.findMany({
      where: {
        organizationId,
        propertyId: roomType.propertyId,
        enabled: true,
        roomMappings: { some: { roomTypeId: roomType.id, active: true } },
      },
      include: { channel: true, roomMappings: { where: { roomTypeId: roomType.id, active: true } } },
    });
    if (conns.length < 2) {
      throw badRequest('Need at least 2 channels mapped to the same room type to force an overbooking');
    }

    const checkIn = body.checkIn ?? addDays(todayIso(), 7);
    const checkOut = addDays(checkIn, body.nights);
    const outcomes = [];

    // Fill to capacity from channel A, then one extra from channel B.
    for (let unit = 0; unit < roomType.totalUnits; unit++) {
      outcomes.push(await placeBooking(conns[0], roomType.id, checkIn, checkOut, `fill ${unit + 1}`));
    }
    const tipping = await placeBooking(conns[1], roomType.id, checkIn, checkOut, 'the one too many');

    const conflict = tipping.conflictIds.length
      ? await prisma.conflictAlert.findUnique({ where: { id: tipping.conflictIds[0] } })
      : null;

    res.json({
      roomType: { id: roomType.id, name: roomType.name, capacity: roomType.totalUnits },
      dates: { checkIn, checkOut },
      filledFrom: conns[0].channel.name,
      overflowFrom: conns[1].channel.name,
      overbookingDetected: tipping.overbooking,
      autoProtected: tipping.rejected,
      conflict,
      outcomes: [...outcomes, tipping],
    });
  }),
);

async function placeBooking(
  conn: { id: string; channel: { code: string } },
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  label: string,
) {
  const { ctx } = await resolveConnection(conn.id);
  const mapping =
    ctx.roomMap.find((m) => m.roomTypeId === roomTypeId) ?? ctx.roomMap[0];
  const nights = nightsBetween(checkIn, checkOut).length;
  const booking: NormalizedBooking = {
    externalRef: `SIM-${label.replace(/\s+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'confirmed',
    channelCode: conn.channel.code,
    propertyCode: ctx.propertyCode,
    externalRoomId: mapping.externalRoomId,
    externalRatePlanId: mapping.externalRatePlanId,
    guestName: `Sim Guest (${label})`,
    guestEmail: 'sim@example.com',
    checkIn,
    checkOut,
    units: 1,
    currency: 'USD',
    amount: 150 * nights,
    bookedAt: new Date().toISOString(),
    raw: { source: 'simulator', scenario: 'overbooking', label },
  };
  return ingestBooking(conn.channel.code, booking, { simulated: true, sourceConnectionId: conn.id });
}

const autopilotInput = z.object({
  enabled: z.boolean(),
  ratePerMinute: z.number().min(0).max(120).default(6),
  horizonDays: z.number().int().min(1).max(120).default(45),
  avgStayNights: z.number().int().min(1).max(21).default(2),
  channelCodes: z.array(z.string()).optional(),
});

/** Toggle continuous mock demand — the worker's poll loop invents bookings. */
simulatorRouter.post(
  '/autopilot',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(autopilotInput, req.body);

    // Convert bookings/minute → lambda per poll (poll interval defaults to 60s).
    const lambdaPerPoll = body.ratePerMinute / 1;
    const codes =
      body.channelCodes ??
      (await prisma.channelConnection.findMany({
        where: { organizationId, enabled: true, channel: { kind: { in: ['pull', 'both'] } } },
        select: { channel: { select: { code: true } } },
      })).map((c) => c.channel.code);

    const lambdaByChannel: Record<string, number> = {};
    for (const code of codes) lambdaByChannel[code] = lambdaPerPoll / Math.max(1, codes.length);

    const value = {
      enabled: body.enabled,
      lambdaByChannel,
      horizonDays: body.horizonDays,
      avgStayNights: body.avgStayNights,
    };
    await setOrgSetting(organizationId, 'mock:autopilot', value);
    res.json({ autopilot: value });
  }),
);

/** Remove every simulated booking (this organization only) and recompute availability. */
simulatorRouter.post(
  '/reset',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const simulated = await prisma.booking.findMany({
      where: {
        organizationId,
        OR: [
          { rawPayload: { path: ['source'], equals: 'simulator' } },
          { rawPayload: { path: ['source'], equals: 'mock-autopilot' } },
          { rawPayload: { path: ['scenario'], equals: 'overbooking' } },
          { externalRef: { startsWith: 'SIM-' } },
        ],
      },
      select: { id: true, roomTypeId: true, checkIn: true, checkOut: true },
    });

    const affected = new Map<string, Set<string>>();
    for (const b of simulated) {
      if (!b.roomTypeId) continue;
      const set = affected.get(b.roomTypeId) ?? new Set<string>();
      nightsBetween(b.checkIn.toISOString().slice(0, 10), b.checkOut.toISOString().slice(0, 10)).forEach((d) =>
        set.add(d),
      );
      affected.set(b.roomTypeId, set);
    }

    await prisma.booking.deleteMany({ where: { id: { in: simulated.map((b) => b.id) } } });
    await prisma.conflictAlert.deleteMany({
      where: { organizationId, details: { path: ['newBooking'], not: undefined }, status: { not: 'resolved' } },
    }).catch(() => undefined);

    for (const [roomTypeId, dates] of affected) {
      await recomputeAvailability(roomTypeId, [...dates]);
    }

    await setOrgSetting(organizationId, 'mock:autopilot', { enabled: false, lambdaByChannel: {} });

    res.json({ deletedBookings: simulated.length, roomsRecomputed: affected.size });
  }),
);
