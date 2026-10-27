import { Router } from 'express';
import { z } from 'zod';
import { todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { requireOrg, assertOwned } from '../lib/tenant';
import { requireRole } from '../auth';
import { requirePermission } from '../lib/permissions';

export const pmsRouter = Router();
pmsRouter.use(requireOrg);

// ── Room units ───────────────────────────────────────────────────────────────

async function assertRoomTypeOwned(roomTypeId: string, organizationId: string) {
  const room = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    include: { property: { select: { organizationId: true } } },
  });
  if (!room || room.property.organizationId !== organizationId) throw notFound('Room type not found');
  return room;
}

pmsRouter.get(
  '/room-units',
  asyncHandler(async (req, res) => {
    const roomTypeId = req.query.roomTypeId ? String(req.query.roomTypeId) : undefined;
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
    const organizationId = req.user!.organizationId!;
    const units = await prisma.roomUnit.findMany({
      where: {
        roomTypeId,
        roomType: { property: { organizationId, id: propertyId } },
      },
      orderBy: { unitNumber: 'asc' },
      include: { roomType: { select: { name: true, propertyId: true } } },
    });
    res.json({ units });
  }),
);

const unitInput = z.object({
  roomTypeId: z.string(),
  unitNumber: z.string().min(1),
  housekeepingStatus: z.enum(['clean', 'dirty', 'inspected', 'out_of_order']).default('clean'),
  notes: z.string().default(''),
});

pmsRouter.post(
  '/room-units',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(unitInput, req.body);
    await assertRoomTypeOwned(body.roomTypeId, req.user!.organizationId!);
    const unit = await prisma.roomUnit.create({ data: body });
    res.status(201).json({ unit });
  }),
);

pmsRouter.patch(
  '/room-units/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.roomUnit.findUnique({
      where: { id: req.params.id },
      include: { roomType: { include: { property: { select: { organizationId: true } } } } },
    });
    if (!existing || existing.roomType.property.organizationId !== req.user!.organizationId) {
      throw notFound('Room unit not found');
    }
    const body = parse(unitInput.partial().omit({ roomTypeId: true }), req.body);
    const unit = await prisma.roomUnit.update({ where: { id: req.params.id }, data: body });
    res.json({ unit });
  }),
);

/** The housekeeping board — every unit with its current status, grouped by room type. */
pmsRouter.get(
  '/housekeeping',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
    const units = await prisma.roomUnit.findMany({
      where: { roomType: { property: { organizationId, id: propertyId } } },
      orderBy: [{ roomType: { name: 'asc' } }, { unitNumber: 'asc' }],
      include: { roomType: { select: { name: true } } },
    });
    res.json({ units });
  }),
);

// ── Front desk board ─────────────────────────────────────────────────────────

/** Arrivals / departures / in-house for one property on one date. */
pmsRouter.get(
  '/board',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
    if (!propertyId) throw badRequest('propertyId is required');
    await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), organizationId, 'Property');
    const date = String(req.query.date ?? todayIso());
    const dateStart = new Date(date + 'T00:00:00Z');

    const include = {
      roomType: { select: { name: true } },
      roomUnit: { select: { unitNumber: true } },
      sourceChannel: { select: { name: true } },
    } as const;

    const [arrivals, departures, inHouse] = await Promise.all([
      prisma.booking.findMany({
        where: { organizationId, propertyId, checkIn: dateStart, status: { in: ['confirmed', 'modified'] } },
        include,
      }),
      prisma.booking.findMany({
        where: { organizationId, propertyId, checkOut: dateStart, status: { in: ['confirmed', 'modified'] } },
        include,
      }),
      prisma.booking.findMany({
        where: {
          organizationId,
          propertyId,
          status: { in: ['confirmed', 'modified'] },
          checkIn: { lte: dateStart },
          checkOut: { gt: dateStart },
          checkedInAt: { not: null },
          checkedOutAt: null,
        },
        include,
      }),
    ]);

    res.json({ date, arrivals, departures, inHouse });
  }),
);

async function assertBookingOwned(bookingId: string, organizationId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.organizationId !== organizationId) throw notFound('Booking not found');
  return booking;
}

const checkInInput = z.object({ roomUnitId: z.string().nullish() });

pmsRouter.post(
  '/bookings/:id/check-in',
  requirePermission('pms.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const booking = await assertBookingOwned(req.params.id, organizationId);
    if (booking.checkedInAt) throw badRequest('Already checked in');
    const body = parse(checkInInput, req.body);

    if (body.roomUnitId) {
      const unit = await prisma.roomUnit.findUnique({ where: { id: body.roomUnitId } });
      if (!unit || unit.roomTypeId !== booking.roomTypeId) throw badRequest('Room unit does not match this booking\'s room type');
      const clash = await prisma.booking.findFirst({
        where: { roomUnitId: unit.id, checkedInAt: { not: null }, checkedOutAt: null, id: { not: booking.id } },
      });
      if (clash) throw badRequest('That room unit is already occupied');
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { checkedInAt: new Date(), roomUnitId: body.roomUnitId ?? booking.roomUnitId },
    });
    if (body.roomUnitId) {
      await prisma.roomUnit.update({ where: { id: body.roomUnitId }, data: { housekeepingStatus: 'dirty' } }).catch(() => undefined);
    }
    res.json({ booking: updated });
  }),
);

pmsRouter.post(
  '/bookings/:id/check-out',
  requirePermission('pms.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const booking = await assertBookingOwned(req.params.id, organizationId);
    if (!booking.checkedInAt) throw badRequest('Not checked in yet');
    if (booking.checkedOutAt) throw badRequest('Already checked out');

    const updated = await prisma.booking.update({ where: { id: booking.id }, data: { checkedOutAt: new Date() } });
    if (booking.roomUnitId) {
      await prisma.roomUnit
        .update({ where: { id: booking.roomUnitId }, data: { housekeepingStatus: 'dirty' } })
        .catch(() => undefined);
    }
    res.json({ booking: updated });
  }),
);
