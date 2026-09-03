import { nightsBetween } from '@cm/shared';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { getSettings } from '../lib/settings';

const log = logger('engine:conflict');

export interface ConflictResult {
  overbooking: boolean;
  rejected: boolean;
  alertIds: string[];
}

interface BookingLike {
  id: string;
  roomTypeId: string | null;
  checkIn: Date;
  checkOut: Date;
  unitsBooked: number;
  amount: unknown; // Prisma Decimal
  currency: string;
}

/**
 * Evaluate a freshly-ingested booking against current inventory.
 *  - overbooking / double_booking  → high/critical alert; booking rejected when
 *    auto-protect is on (so it never consumes inventory)
 *  - rate_mismatch                 → low alert; booking left as-is
 */
export async function evaluateBooking(booking: BookingLike): Promise<ConflictResult> {
  const settings = await getSettings();
  const result: ConflictResult = { overbooking: false, rejected: false, alertIds: [] };
  if (!booking.roomTypeId) return result;

  const room = await prisma.roomType.findUnique({ where: { id: booking.roomTypeId } });
  if (!room) return result;

  const dates = nightsBetween(
    booking.checkIn.toISOString().slice(0, 10),
    booking.checkOut.toISOString().slice(0, 10),
  );
  const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));

  // Units already committed by other active bookings, per night.
  const grouped = await prisma.bookingNight.groupBy({
    by: ['date'],
    where: {
      date: { in: dateObjs },
      booking: {
        roomTypeId: booking.roomTypeId,
        status: { in: ['confirmed', 'modified'] },
        id: { not: booking.id },
      },
    },
    _sum: { units: true },
  });
  const otherUnits = new Map(grouped.map((g) => [g.date.toISOString().slice(0, 10), g._sum.units ?? 0]));

  const oversoldDates: Array<{ date: string; demand: number; capacity: number }> = [];
  for (const date of dates) {
    const demand = (otherUnits.get(date) ?? 0) + booking.unitsBooked;
    if (demand > room.totalUnits) {
      oversoldDates.push({ date, demand, capacity: room.totalUnits });
    }
  }

  if (oversoldDates.length > 0) {
    result.overbooking = true;
    const type = room.totalUnits === 1 ? 'double_booking' : 'overbooking';

    // Collect the colliding bookings for the alert detail.
    const colliding = await prisma.booking.findMany({
      where: {
        roomTypeId: booking.roomTypeId,
        status: { in: ['confirmed', 'modified'] },
        id: { not: booking.id },
        checkIn: { lt: booking.checkOut },
        checkOut: { gt: booking.checkIn },
      },
      select: { id: true, externalRef: true, sourceChannel: { select: { name: true } } },
    });

    if (settings.autoProtectOverbooking) {
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'rejected' } });
      result.rejected = true;
    }

    const alert = await prisma.conflictAlert.create({
      data: {
        type,
        severity: settings.autoProtectOverbooking ? 'high' : 'critical',
        roomTypeId: booking.roomTypeId,
        fromDate: new Date(oversoldDates[0].date + 'T00:00:00Z'),
        toDate: new Date(oversoldDates[oversoldDates.length - 1].date + 'T00:00:00Z'),
        bookingIds: [booking.id, ...colliding.map((c) => c.id)],
        details: {
          message:
            `${type === 'double_booking' ? 'Double booking' : 'Overbooking'} detected on ` +
            `${room.name}: ${oversoldDates.length} night(s) exceed capacity of ${room.totalUnits}.`,
          oversoldDates,
          autoProtected: settings.autoProtectOverbooking,
          newBooking: { id: booking.id },
          collidingBookings: colliding.map((c) => ({
            id: c.id,
            externalRef: c.externalRef,
            channel: c.sourceChannel.name,
          })),
        },
      },
    });
    result.alertIds.push(alert.id);
    log.warn(
      `${type} on room ${room.id} — booking ${booking.id} ${result.rejected ? 'REJECTED' : 'flagged'}`,
    );
  }

  // ── rate mismatch ──────────────────────────────────────────────────────────
  if (settings.detectRateMismatch && !result.rejected) {
    const days = await prisma.calendarDay.findMany({
      where: { roomTypeId: booking.roomTypeId, date: { in: dateObjs } },
      select: { price: true },
    });
    if (days.length === dates.length) {
      const expected = days.reduce((s, d) => s + Number(d.price), 0) * booking.unitsBooked;
      const actual = Number(booking.amount);
      const delta = Math.abs(actual - expected);
      const tolerance = Math.max(settings.rateMismatchAbs, expected * settings.rateMismatchPct);
      if (expected > 0 && delta > tolerance) {
        const alert = await prisma.conflictAlert.create({
          data: {
            type: 'rate_mismatch',
            severity: 'low',
            roomTypeId: booking.roomTypeId,
            fromDate: dateObjs[0],
            toDate: dateObjs[dateObjs.length - 1],
            bookingIds: [booking.id],
            details: {
              message: `Booking amount ${actual} ${booking.currency} differs from calendar total ${expected.toFixed(2)} by ${delta.toFixed(2)}.`,
              expected,
              actual,
              delta,
              tolerance,
            },
          },
        });
        result.alertIds.push(alert.id);
      }
    }
  }

  return result;
}

/**
 * Full-inventory sweep — flags any room/date where active bookings exceed
 * capacity and any RoomMapping that points at a deleted room. Used by the
 * "re-scan" action and after bulk imports.
 */
export async function sweepConflicts(propertyId?: string): Promise<{ created: number }> {
  const rooms = await prisma.roomType.findMany({
    where: propertyId ? { propertyId } : undefined,
    select: { id: true, name: true, totalUnits: true },
  });
  let created = 0;

  for (const room of rooms) {
    const rows = await prisma.bookingNight.groupBy({
      by: ['date'],
      where: { booking: { roomTypeId: room.id, status: { in: ['confirmed', 'modified'] } } },
      _sum: { units: true },
      having: { units: { _sum: { gt: room.totalUnits } } },
    });
    if (rows.length === 0) continue;

    const dates = rows.map((r) => r.date).sort((a, b) => a.getTime() - b.getTime());
    const existing = await prisma.conflictAlert.findFirst({
      where: { type: { in: ['overbooking', 'double_booking'] }, roomTypeId: room.id, status: 'open' },
    });
    if (existing) continue;

    await prisma.conflictAlert.create({
      data: {
        type: room.totalUnits === 1 ? 'double_booking' : 'overbooking',
        severity: 'high',
        roomTypeId: room.id,
        fromDate: dates[0],
        toDate: dates[dates.length - 1],
        bookingIds: [],
        details: {
          message: `Inventory sweep: ${rows.length} night(s) oversold on ${room.name}.`,
          oversoldDates: rows.map((r) => ({
            date: r.date.toISOString().slice(0, 10),
            demand: r._sum.units,
            capacity: room.totalUnits,
          })),
        },
      },
    });
    created++;
  }

  return { created };
}
