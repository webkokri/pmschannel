import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { finalizePaidDirectBooking } from '../src/modules/public';
import { setOrgSetting } from '../src/lib/settings';
import { cleanWorld, isoDate, makeWorld } from './helpers';

let world: Awaited<ReturnType<typeof makeWorld>>;

beforeAll(async () => {
  await cleanWorld();
  world = await makeWorld({ capacity: 1, channels: ['booking_com'] });
  await setOrgSetting(world.organization.id, 'payments:gateway', 'stripe');
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

async function makePending(over: Partial<{ checkIn: string; checkOut: string; amountCents: number }> = {}) {
  return prisma.pendingDirectBooking.create({
    data: {
      organizationId: world.organization.id,
      propertyId: world.property.id,
      roomTypeId: world.room.id,
      checkIn: new Date((over.checkIn ?? isoDate(10)) + 'T00:00:00Z'),
      checkOut: new Date((over.checkOut ?? isoDate(12)) + 'T00:00:00Z'),
      units: 1,
      guestName: 'Paid Guest',
      guestEmail: 'paid@example.com',
      guestPhone: '+15559876543',
      adults: 2,
      children: 0,
      amountCents: over.amountCents ?? 20_000,
      currency: 'USD',
      gateway: 'stripe',
    },
  });
}

describe('finalizePaidDirectBooking', () => {
  it('creates the booking and a captured Payment with the correct commission split, once payment is confirmed', async () => {
    const pending = await makePending();
    await finalizePaidDirectBooking(pending.id, 'pi_test_123');

    const after = await prisma.pendingDirectBooking.findUniqueOrThrow({ where: { id: pending.id } });
    expect(after.status).toBe('completed');
    expect(after.bookingId).toBeTruthy();

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: after.bookingId! } });
    expect(booking.status).toBe('confirmed');
    expect(booking.roomTypeId).toBe(world.room.id);
    expect(booking.unmapped).toBe(false);
    expect(booking.guestPhone).toBe('+15559876543');
    expect(booking.adults).toBe(2);

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('captured');
    expect(payment.method).toBe('card');
    expect(payment.gateway).toBe('stripe');
    expect(payment.gatewayRef).toBe('pi_test_123');
    expect(payment.amountCents).toBe(20_000);
    expect(payment.commissionCents + payment.netCents).toBe(20_000);

    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(10) + 'T00:00:00Z') },
    });
    expect(day?.availableUnits).toBe(0); // capacity 1, now taken
  });

  it('is idempotent — finalizing an already-completed checkout a second time is a no-op', async () => {
    const pending = await makePending({ checkIn: isoDate(20), checkOut: isoDate(21) });
    await finalizePaidDirectBooking(pending.id, 'pi_test_once');
    await finalizePaidDirectBooking(pending.id, 'pi_test_twice'); // e.g. a duplicate webhook delivery

    const payments = await prisma.payment.findMany({
      where: { bookingId: (await prisma.pendingDirectBooking.findUniqueOrThrow({ where: { id: pending.id } })).bookingId! },
    });
    expect(payments.length).toBe(1);
    expect(payments[0].gatewayRef).toBe('pi_test_once');
  });

  it('marks the checkout rejected (never confirms the booking) when the room sold out while payment was in flight', async () => {
    // Capacity 1 on this room; fill it first with a normal confirmed booking for the
    // same night the pending checkout targets.
    const night = isoDate(30);
    await prisma.booking.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        sourceChannelId: (await prisma.channel.findUniqueOrThrow({ where: { code: 'booking_com' } })).id,
        externalRef: 'BLOCKER',
        roomTypeId: world.room.id,
        guestName: 'Earlier Guest',
        checkIn: new Date(night + 'T00:00:00Z'),
        checkOut: new Date(isoDate(31) + 'T00:00:00Z'),
        amount: 100,
        rawPayload: {},
        nights: { create: [{ date: new Date(night + 'T00:00:00Z'), units: 1 }] },
      },
    });

    const pending = await makePending({ checkIn: night, checkOut: isoDate(31) });
    await finalizePaidDirectBooking(pending.id, 'pi_test_race');

    const after = await prisma.pendingDirectBooking.findUniqueOrThrow({ where: { id: pending.id } });
    expect(after.status).toBe('rejected');

    // No Payment should exist for a booking that never confirmed — the guest paid, but
    // since no gateway is actually configured in this test env the refund attempt itself
    // fails; what matters here is that we never record a captured Payment nor confirm
    // the booking despite the payment having gone through.
    const payments = await prisma.payment.findMany({ where: { organizationId: world.organization.id, gatewayRef: 'pi_test_race' } });
    expect(payments.length).toBe(0);
  });
});
