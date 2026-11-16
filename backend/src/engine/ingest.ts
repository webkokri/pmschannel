import { nightsBetween, type NormalizedBooking } from '@cm/shared';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify/send';
import { evaluateBooking, type PendingNotification } from './conflict';
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
  opts: { simulated?: boolean; sourceConnectionId?: string; roomTypeId?: string } = {},
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

  // Resolve local room type / rate plan. Direct-portal bookings (and anything
  // else that already knows the real RoomType, rather than an external code
  // needing a RoomMapping) pass `opts.roomTypeId` straight through — without
  // this, a guest booking through our own portal would silently never
  // decrement availability or get conflict-checked against OTA bookings for
  // the same room, which defeats the entire point of two-way sync.
  let roomTypeId: string | null = opts.roomTypeId ?? null;
  let ratePlanId: string | null = null;
  if (!roomTypeId && connection) {
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
    organizationId: property.organizationId,
    propertyId: property.id,
    sourceChannelId: channel.id,
    roomTypeId,
    ratePlanId,
    externalRef: b.externalRef,
    status: b.status,
    guestName: b.guestName,
    guestEmail: b.guestEmail ?? null,
    guestPhone: b.guestPhone ?? '',
    checkIn: new Date(b.checkIn + 'T00:00:00Z'),
    checkOut: new Date(b.checkOut + 'T00:00:00Z'),
    unitsBooked: b.units,
    adults: b.adults ?? 1,
    children: b.children ?? 0,
    currency: b.currency,
    amount: b.amount,
    unmapped,
    externalRoomId: b.externalRoomId,
    rawPayload: (b.raw ?? {}) as object,
    bookedAt: b.bookedAt ? new Date(b.bookedAt) : null,
  };

  // Idempotency: identical status + dates + units → no-op.
  if (existing) {
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

  let bookingId: string = existing?.id ?? '';
  let action: IngestOutcome['action'] = 'created';
  let overbooking = false;
  let rejected = false;
  let conflictIds: string[] = [];
  let pendingNotifications: PendingNotification[] = [];

  /**
   * Everything that reads or depends on "how many units are already committed for
   * this room on these dates" runs inside one transaction, serialized per room type
   * via a Postgres advisory lock. Without this, two bookings for the same last unit
   * arriving at nearly the same instant (e.g. one from Booking.com, one from the
   * direct-booking portal) could each run their capacity check before the other's
   * write is visible, and both pass — a real double-booking the sweep job would only
   * catch after the fact. Locks are acquired in a fixed (sorted) order across every
   * affected room type to avoid deadlocking against another concurrent ingest that
   * touches the same two rooms in the opposite order.
   */
  await prisma.$transaction(
    async (tx) => {
      const roomTypeIdsToLock = [...new Set([roomTypeId, existing?.roomTypeId ?? null].filter(Boolean))].sort() as string[];
      for (const rtId of roomTypeIdsToLock) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rtId}))`;
      }

      if (existing) {
        action = 'updated';
        await tx.booking.update({ where: { id: existing.id }, data });
        await tx.bookingNight.deleteMany({ where: { bookingId: existing.id } });
        await tx.bookingNight.createMany({
          data: nights.map((d) => ({ bookingId: existing.id, date: new Date(d + 'T00:00:00Z'), units: b.units })),
        });
        bookingId = existing.id;
      } else {
        const created = await tx.booking.create({
          data: {
            ...data,
            nights: {
              create: nights.map((d) => ({ date: new Date(d + 'T00:00:00Z'), units: b.units })),
            },
          },
        });
        bookingId = created.id;
      }

      // Conflict evaluation (may flip status → rejected) — sees every other booking
      // already committed for this room, including ones from a different channel.
      if (!unmapped && (b.status === 'confirmed' || b.status === 'modified')) {
        const fresh = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
        const evalResult = await evaluateBooking(fresh, tx);
        overbooking = evalResult.overbooking;
        rejected = evalResult.rejected;
        conflictIds = evalResult.alertIds;
        pendingNotifications = evalResult.pendingNotifications;
      }

      // Recompute availability while still holding the lock, so the number every
      // channel gets pushed next always reflects this booking (accepted or rejected).
      for (const [rt, dateSet] of affectedRooms) {
        await recomputeAvailability(rt, [...dateSet].sort(), tx);
      }
    },
    // Several concurrent bookings can queue up waiting on the same room's advisory
    // lock (e.g. a last-room rush) — Prisma's 5s default transaction timeout is easy
    // to blow through purely on lock-wait time, which would wrongly surface as a
    // request failure rather than the booking just taking its turn. 20s comfortably
    // covers realistic contention for a single room without masking a truly stuck query.
    { timeout: 20_000, maxWait: 10_000 },
  );

  // Overbooking/double-booking staff alerts — sent now that the transaction (and the
  // advisory lock it held) has released, not from inside it.
  for (const n of pendingNotifications) {
    await notify(property.organizationId, n.template, { email: n.email, vars: n.vars });
  }

  // Fan out to the other channels — outside the transaction; this only enqueues
  // SyncJob rows (the worker does the actual push) so it doesn't need the lock.
  let fannedOutTo = 0;
  for (const [rt, dateSet] of affectedRooms) {
    fannedOutTo += await enqueueAvailabilityFanout(rt, [...dateSet].sort(), {
      excludeConnectionId: connection?.id,
      reason: opts.simulated ? 'simulated-booking' : `booking:${channelCode}`,
    });
  }

  // Acknowledge back to the source channel (best-effort job).
  if (connection && !unmapped) {
    await prisma.syncJob
      .create({
        data: {
          organizationId: property.organizationId,
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

  // Best-effort guest notification — never blocks or fails the ingest itself. (`action`
  // is always 'created' | 'updated' here — the 'unchanged' case already returned above.)
  if (b.guestEmail) {
    const effectiveStatus = rejected ? 'rejected' : b.status;
    const vars = {
      guestName: b.guestName,
      propertyName: property.name,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      amount: String(b.amount),
      currency: b.currency,
    };
    if (effectiveStatus === 'confirmed' || effectiveStatus === 'modified') {
      await notify(property.organizationId, 'booking_confirmation', { email: b.guestEmail, vars });
    } else if (effectiveStatus === 'cancelled') {
      await notify(property.organizationId, 'booking_cancelled', { email: b.guestEmail, vars });
    }
  }

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
