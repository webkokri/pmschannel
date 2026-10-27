import { nightsBetween } from '@cm/shared';
import type { Prisma as PrismaNS } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../lib/logger';

const log = logger('engine:ari');

type Tx = PrismaNS.TransactionClient | typeof prisma;

/**
 * Recompute `CalendarDay.availableUnits` for a room type on the given dates:
 *   available = totalUnits − Σ units from active (confirmed|modified) booking nights
 * Missing CalendarDay rows are created using the room's base price.
 */
export async function recomputeAvailability(
  roomTypeId: string,
  dates: string[],
  client: Tx = prisma,
): Promise<void> {
  if (dates.length === 0) return;
  const room = await client.roomType.findUnique({ where: { id: roomTypeId } });
  if (!room) return;

  const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));

  const nights = await client.bookingNight.groupBy({
    by: ['date'],
    where: {
      date: { in: dateObjs },
      booking: { roomTypeId, status: { in: ['confirmed', 'modified'] } },
    },
    _sum: { units: true },
  });
  const booked = new Map(nights.map((n) => [n.date.toISOString().slice(0, 10), n._sum.units ?? 0]));

  for (const date of dates) {
    const used = booked.get(date) ?? 0;
    const available = Math.max(0, room.totalUnits - used);
    await client.calendarDay.upsert({
      where: { roomTypeId_date: { roomTypeId, date: new Date(date + 'T00:00:00Z') } },
      create: {
        roomTypeId,
        date: new Date(date + 'T00:00:00Z'),
        price: room.basePrice,
        availableUnits: available,
        stopSell: available === 0,
      },
      update: { availableUnits: available },
    });
  }
}

/**
 * Enqueue an availability push to every *other* enabled channel connection that
 * has an active mapping for this room type. Coalesces with any pending job for
 * the same connection+room via `dedupeKey`, unioning the date list.
 */
export async function enqueueAvailabilityFanout(
  roomTypeId: string,
  dates: string[],
  opts: { excludeConnectionId?: string; reason?: string } = {},
): Promise<number> {
  if (dates.length === 0) return 0;

  const room = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    select: { propertyId: true, property: { select: { organizationId: true } } },
  });
  if (!room) return 0;

  const connections = await prisma.channelConnection.findMany({
    where: {
      propertyId: room.propertyId,
      enabled: true,
      pushEnabled: true,
      syncAvailability: true,
      id: opts.excludeConnectionId ? { not: opts.excludeConnectionId } : undefined,
      roomMappings: { some: { roomTypeId, active: true } },
    },
    select: { id: true },
  });

  let queued = 0;
  for (const conn of connections) {
    await upsertAriJob(room.property.organizationId, conn.id, 'availability', roomTypeId, dates, opts.reason);
    queued++;
  }
  log.info(
    `availability fan-out for room ${roomTypeId} (${dates.length} day(s)) → ${queued} channel(s)` +
      (opts.reason ? ` [${opts.reason}]` : ''),
  );
  return queued;
}

/** Enqueue rates/restrictions/availability pushes for a manual calendar edit. */
export async function enqueueAriForEdit(
  roomTypeId: string,
  dates: string[],
  entityTypes: Array<'availability' | 'rates' | 'restrictions'>,
): Promise<number> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    select: { propertyId: true, property: { select: { organizationId: true } } },
  });
  if (!room) return 0;

  const connections = await prisma.channelConnection.findMany({
    where: {
      propertyId: room.propertyId,
      enabled: true,
      pushEnabled: true,
      roomMappings: { some: { roomTypeId, active: true } },
    },
    select: { id: true, syncAvailability: true, syncRates: true, syncRestrictions: true },
  });

  let queued = 0;
  for (const conn of connections) {
    for (const entity of entityTypes) {
      if (entity === 'availability' && !conn.syncAvailability) continue;
      if (entity === 'rates' && !conn.syncRates) continue;
      if (entity === 'restrictions' && !conn.syncRestrictions) continue;
      await upsertAriJob(room.property.organizationId, conn.id, entity, roomTypeId, dates, 'calendar-edit');
      queued++;
    }
  }
  return queued;
}

async function upsertAriJob(
  organizationId: string,
  connectionId: string,
  entityType: 'availability' | 'rates' | 'restrictions',
  roomTypeId: string,
  dates: string[],
  reason?: string,
) {
  const dedupeKey = `${entityType}:${connectionId}:${roomTypeId}`;
  const existing = await prisma.syncJob.findUnique({ where: { dedupeKey } });

  if (existing && (existing.status === 'pending' || existing.status === 'failed')) {
    const prev = (existing.payload as { dates?: string[] })?.dates ?? [];
    const merged = Array.from(new Set([...prev, ...dates])).sort();
    await prisma.syncJob.update({
      where: { id: existing.id },
      data: {
        payload: { roomTypeId, dates: merged, reason },
        status: 'pending',
        nextRunAt: new Date(),
      },
    });
    return;
  }

  await prisma.syncJob.create({
    data: {
      organizationId,
      channelConnectionId: connectionId,
      direction: 'push',
      entityType,
      payload: { roomTypeId, dates: Array.from(new Set(dates)).sort(), reason },
      status: 'pending',
      nextRunAt: new Date(),
      // Only keep a stable dedupeKey while the job is fresh; the worker clears it
      // once the job reaches a terminal state so future edits create new jobs.
      dedupeKey,
    },
  });
}

export function stayDates(checkIn: Date | string, checkOut: Date | string): string[] {
  const ci = typeof checkIn === 'string' ? checkIn : checkIn.toISOString().slice(0, 10);
  const co = typeof checkOut === 'string' ? checkOut : checkOut.toISOString().slice(0, 10);
  return nightsBetween(ci, co);
}
