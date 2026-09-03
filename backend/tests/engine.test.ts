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
    guestName: 'Test Guest',
    guestEmail: 'g@example.com',
    units: 1,
    currency: 'USD',
    amount: 200,
    raw: { source: 'test' },
    ...over,
  };
}

let world: Awaited<ReturnType<typeof makeWorld>>;

beforeAll(async () => {
  await cleanWorld();
  await updateSettings({ autoProtectOverbooking: true, detectRateMismatch: true });
  world = await makeWorld({ capacity: 2, channels: ['booking_com', 'airbnb'] });
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

describe('ingest + conflict engine', () => {
  it('ingests a booking, decrements availability and fans out to other channels', async () => {
    const out = await ingestBooking(
      'booking_com',
      booking({
        externalRef: 'T-1',
        channelCode: 'booking_com',
        propertyCode: world.property.code,
        externalRoomId: 'booking_com-R1',
        checkIn: isoDate(3),
        checkOut: isoDate(5),
        amount: 200,
      }),
      { sourceConnectionId: world.connections.booking_com },
    );

    expect(out.action).toBe('created');
    expect(out.rejected).toBe(false);
    // 2 nights × 1 other channel (airbnb) = fan-out to 1 connection
    expect(out.fannedOutTo).toBe(1);

    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(3) + 'T00:00:00Z') },
    });
    expect(day?.availableUnits).toBe(1); // capacity 2 − 1 booked

    const jobs = await prisma.syncJob.findMany({
      where: { channelConnectionId: world.connections.airbnb, entityType: 'availability' },
    });
    expect(jobs.length).toBe(1);
    expect((jobs[0].payload as { dates: string[] }).dates).toContain(isoDate(3));
  });

  it('is idempotent on (channel, externalRef)', async () => {
    const again = await ingestBooking(
      'booking_com',
      booking({
        externalRef: 'T-1',
        channelCode: 'booking_com',
        propertyCode: world.property.code,
        externalRoomId: 'booking_com-R1',
        checkIn: isoDate(3),
        checkOut: isoDate(5),
      }),
      { sourceConnectionId: world.connections.booking_com },
    );
    expect(again.action).toBe('unchanged');

    const count = await prisma.booking.count({ where: { externalRef: 'T-1' } });
    expect(count).toBe(1);
  });

  it('rejects an oversold booking and raises an overbooking conflict (auto-protect on)', async () => {
    // Room capacity 2; T-1 already holds 1 on nights 3-4. Add one at capacity, then one over.
    await ingestBooking(
      'airbnb',
      booking({
        externalRef: 'T-2',
        channelCode: 'airbnb',
        propertyCode: world.property.code,
        externalRoomId: 'airbnb-R1',
        checkIn: isoDate(3),
        checkOut: isoDate(4),
      }),
      { sourceConnectionId: world.connections.airbnb },
    );

    const over = await ingestBooking(
      'airbnb',
      booking({
        externalRef: 'T-3',
        channelCode: 'airbnb',
        propertyCode: world.property.code,
        externalRoomId: 'airbnb-R1',
        checkIn: isoDate(3),
        checkOut: isoDate(4),
      }),
      { sourceConnectionId: world.connections.airbnb },
    );

    expect(over.overbooking).toBe(true);
    expect(over.rejected).toBe(true);

    const rejected = await prisma.booking.findFirst({ where: { externalRef: 'T-3' } });
    expect(rejected?.status).toBe('rejected');

    const alerts = await prisma.conflictAlert.findMany({
      where: { roomTypeId: world.room.id, type: { in: ['overbooking', 'double_booking'] } },
    });
    expect(alerts.length).toBeGreaterThan(0);

    // Availability never went negative.
    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(3) + 'T00:00:00Z') },
    });
    expect(day!.availableUnits).toBeGreaterThanOrEqual(0);
  });

  it('flags a rate mismatch without rejecting the booking', async () => {
    const out = await ingestBooking(
      'booking_com',
      booking({
        externalRef: 'T-RATE',
        channelCode: 'booking_com',
        propertyCode: world.property.code,
        externalRoomId: 'booking_com-R1',
        checkIn: isoDate(10),
        checkOut: isoDate(12),
        amount: 20, // calendar says 2 × 100 = 200
      }),
      { sourceConnectionId: world.connections.booking_com },
    );
    expect(out.rejected).toBe(false);
    const alert = await prisma.conflictAlert.findFirst({
      where: { type: 'rate_mismatch', bookingIds: { has: out.bookingId } },
    });
    expect(alert).toBeTruthy();
  });

  it('cancellation restores availability', async () => {
    const b = await prisma.booking.findFirstOrThrow({ where: { externalRef: 'T-1' } });
    await ingestBooking(
      'booking_com',
      booking({
        externalRef: 'T-1',
        channelCode: 'booking_com',
        propertyCode: world.property.code,
        externalRoomId: 'booking_com-R1',
        checkIn: isoDate(3),
        checkOut: isoDate(5),
        status: 'cancelled',
      }),
      { sourceConnectionId: world.connections.booking_com },
    );
    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(4) + 'T00:00:00Z') },
    });
    // night 4 had T-1 only (T-2 was nights 3-3). back to full capacity 2.
    expect(day?.availableUnits).toBe(2);
    expect(b.status).toBe('confirmed');
  });
});
