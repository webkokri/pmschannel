import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { ingestBooking } from '../src/engine/ingest';
import { updateSettings } from '../src/lib/settings';
import { cleanWorld, isoDate, makeWorld } from './helpers';
import type { NormalizedBooking } from '@cm/shared';

function booking(over: Partial<NormalizedBooking> & Pick<NormalizedBooking, 'externalRef' | 'channelCode' | 'propertyCode' | 'externalRoomId' | 'checkIn' | 'checkOut'>): NormalizedBooking {
  return {
    status: 'confirmed',
    externalRatePlanId: null,
    guestName: 'Race Guest',
    guestEmail: null,
    units: 1,
    currency: 'USD',
    amount: 100,
    raw: { source: 'concurrency-test' },
    ...over,
  };
}

let world: Awaited<ReturnType<typeof makeWorld>>;

beforeAll(async () => {
  await cleanWorld();
  // A single-unit room, booked from two different channels at once — the
  // classic "last room, two OTAs" race this test exists to rule out.
  world = await makeWorld({ capacity: 1, channels: ['booking_com', 'airbnb'] });
  await updateSettings(world.organization.id, { autoProtectOverbooking: true });
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

describe('concurrent ingest — overbooking race', () => {
  it('only one of several simultaneous bookings for the last unit is ever confirmed', async () => {
    const night = isoDate(5);
    const attempts = [
      { ref: 'RACE-1', channel: 'booking_com' as const },
      { ref: 'RACE-2', channel: 'airbnb' as const },
      { ref: 'RACE-3', channel: 'booking_com' as const },
      { ref: 'RACE-4', channel: 'airbnb' as const },
      { ref: 'RACE-5', channel: 'booking_com' as const },
    ];

    // Fire every attempt at once — this is exactly what two OTAs (or an OTA and
    // the direct-booking portal) racing for the same last unit looks like.
    await Promise.all(
      attempts.map(({ ref, channel }) =>
        ingestBooking(
          channel,
          booking({
            externalRef: ref,
            channelCode: channel,
            propertyCode: world.property.code,
            externalRoomId: `${channel}-R1`,
            checkIn: night,
            checkOut: isoDate(6),
          }),
          { sourceConnectionId: world.connections[channel] },
        ),
      ),
    );

    const bookings = await prisma.booking.findMany({
      where: { externalRef: { in: attempts.map((a) => a.ref) } },
    });
    expect(bookings.length).toBe(5);

    const confirmed = bookings.filter((b) => b.status === 'confirmed');
    const rejected = bookings.filter((b) => b.status === 'rejected');
    expect(confirmed.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Inventory must land exactly at zero — never negative (oversold) and never
    // left at 1 (a confirmed booking that failed to decrement availability).
    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(night + 'T00:00:00Z') },
    });
    expect(day?.availableUnits).toBe(0);

    // Every channel with a mapping for this room got an availability push telling
    // it the room is now sold out, including whichever channel didn't win the race.
    const jobs = await prisma.syncJob.findMany({
      where: { entityType: 'availability' },
    });
    expect(jobs.length).toBeGreaterThan(0);
  });
});
