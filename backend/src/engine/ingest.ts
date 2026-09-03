import { nightsBetween, type NormalizedBooking } from '@cm/shared';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { evaluateBooking } from './conflict';
import { enqueueAvailabilityFanout, recomputeAvailability } from './ari';

const log = logger('engine:ingest');

export interface IngestOutcome {
  bookingId: string;
  action: 'created' | 'updated' | 'unchanged';
  status: string;
  unmapped: boolean;
  overbooking: boolean;
  rejected: boolean;
  conflictIds: string[];
  fannedOutTo: number;
}

/**
 * Single entry point for every inbound booking (webhook, poll, simulator).
 * Idempotent on (sourceChannel, externalRef).
 */
export async function ingestBooking(
  channelCode: string,
  b: NormalizedBooking,
  opts: { simulated?: boolean; sourceConnectionId?: string } = {},
): Promise<IngestOutcome> {
  const channel = await prisma.channel.findUnique({ where: { code: channelCode } });
  if (!channel) throw new Error(`Unknown channel code: ${channelCode}`);

  const property = await prisma.property.findUnique({ where: { code: b.propertyCode } });
  if (!property) throw new Error(`Unknown property code: ${b.propertyCode}`);

  const connection =
    (opts.sourceConnectionId
      ? await prisma.channelConnection.findUnique({ where: { id: opts.sourceConnectionId } })
      : null) ??
    (await prisma.channelConnection.findUnique({
      where: { propertyId_channelId: { propertyId: property.id, channelId: channel.id } },
    }));

  // Resolve local room type / rate plan through the mapping.
  let roomTypeId: string | null = null;
  let ratePlanId: string | null = null;
  if (connection) {
    const mapping = await prisma.roomMapping.findFirst({
      where: {
        channelConnectionId: connection.id,
        externalRoomId: b.externalRoomId,
        active: true,
      },
    });
    if (mapping) {
      roomTypeId = mapping.roomTypeId;
      ratePlanId = mapping.ratePlanId;
    }
  }
  const unmapped = roomTypeId === null;

  const nights = nightsBetween(b.checkIn, b.checkOut);
  if (nights.length === 0) throw new Error('Booking has no nights (checkOut must be after checkIn)');

  const existing = await prisma.booking.findUnique({
    where: { sourceChannelId_externalRef: { sourceChannelId: channel.id, externalRef: b.externalRef } },
    include: { nights: true },
  });

  const data = {
    propertyId: property.id,
    sourceChannelId: channel.id,
    roomTypeId,
    ratePlanId,
    externalRef: b.externalRef,
    status: b.status,
    guestName: b.guestName,
    guestEmail: b.guestEmail ?? null,
    checkIn: new Date(b.checkIn + 'T00:00:00Z'),
    checkOut: new Date(b.checkOut + 'T00:00:00Z'),
    unitsBooked: b.units,
    currency: b.currency,
    amount: b.amount,
    unmapped,
    externalRoomId: b.externalRoomId,
    rawPayload: (b.raw ?? {}) as object,
    bookedAt: b.bookedAt ? new Date(b.bookedAt) : null,
  };

  let bookingId: string;
  let action: IngestOutcome['action'] = 'created';

  if (existing) {
    // Idempotency: identical status + dates + units → no-op.
    const same =
      existing.status === b.status &&
      existing.checkIn.toISOString().slice(0, 10) === b.checkIn &&
      existing.checkOut.toISOString().slice(0, 10) === b.checkOut &&
      existing.unitsBooked === b.units;
    if (same) {
      return {
        bookingId: existing.id,
        action: 'unchanged',
        status: existing.status,
        unmapped: existing.unmapped,
        overbooking: false,
        rejected: existing.status === 'rejected',
        conflictIds: [],
        fannedOutTo: 0,
      };
    }
    action = 'updated';
    await prisma.$transaction([
      prisma.booking.update({ where: { id: existing.id }, data }),
      prisma.bookingNight.deleteMany({ where: { bookingId: existing.id } }),
      prisma.bookingNight.createMany({
        data: nights.map((d) => ({ bookingId: existing.id, date: new Date(d + 'T00:00:00Z'), units: b.units })),
      }),
    ]);
    bookingId = existing.id;
  } else {
    const created = await prisma.booking.create({
      data: {
        ...data,
        nights: {
          create: nights.map((d) => ({ date: new Date(d + 'T00:00:00Z'), units: b.units })),
        },
      },
    });
    bookingId = created.id;
  }

  // Which room/date ranges need availability recomputed + fan-out.
  const affectedRooms = new Map<string, Set<string>>();
  const addAffected = (rt: string | null, dates: string[]) => {
    if (!rt) return;
    const set = affectedRooms.get(rt) ?? new Set<string>();
    dates.forEach((d) => set.add(d));
    affectedRooms.set(rt, set);
  };
  addAffected(roomTypeId, nights);
  if (existing?.roomTypeId && existing.roomTypeId !== roomTypeId) {
    addAffected(
      existing.roomTypeId,
      nightsBetween(
        existing.checkIn.toISOString().slice(0, 10),
        existing.checkOut.toISOString().slice(0, 10),
      ),
    );
  }

  // Conflict evaluation (may flip status → rejected).
  let overbooking = false;
  let rejected = false;
  let conflictIds: string[] = [];
  if (!unmapped && (b.status === 'confirmed' || b.status === 'modified')) {
    const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const evalResult = await evaluateBooking(fresh);
    overbooking = evalResult.overbooking;
    rejected = evalResult.rejected;
    conflictIds = evalResult.alertIds;
  }

  // Recompute availability + fan out to the other channels.
  let fannedOutTo = 0;
  for (const [rt, dateSet] of affectedRooms) {
    const dates = [...dateSet].sort();
    await recomputeAvailability(rt, dates);
    fannedOutTo += await enqueueAvailabilityFanout(rt, dates, {
      excludeConnectionId: connection?.id,
      reason: opts.simulated ? 'simulated-booking' : `booking:${channelCode}`,
    });
  }

  // Acknowledge back to the source channel (best-effort job).
  if (connection && !unmapped) {
    await prisma.syncJob
      .create({
        data: {
          channelConnectionId: connection.id,
          direction: 'push',
          entityType: 'booking_ack',
          payload: { bookingId, externalRef: b.externalRef },
          status: 'pending',
          nextRunAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  log.info(
    `${action} booking ${bookingId} from ${channelCode} (${b.checkIn}→${b.checkOut}) ` +
      `${unmapped ? '[UNMAPPED] ' : ''}${rejected ? '[REJECTED] ' : ''}→ fan-out ${fannedOutTo}`,
  );

  return {
    bookingId,
    action,
    status: rejected ? 'rejected' : b.status,
    unmapped,
    overbooking,
    rejected,
    conflictIds,
    fannedOutTo,
  };
}
