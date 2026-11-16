import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { applyPricingRules } from '../src/engine/pricing';
import { cleanWorld, isoDate, makeWorld } from './helpers';

const app = createApp();

let world: Awaited<ReturnType<typeof makeWorld>>;

beforeAll(async () => {
  await cleanWorld();
  world = await makeWorld({ capacity: 2, channels: ['booking_com', 'airbnb'] });
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

describe('RMS pricing engine', () => {
  it('reprices only dates a rule matches, and is idempotent on repeat runs', async () => {
    const weekday = new Date(isoDate(3) + 'T00:00:00Z').getUTCDay();
    await prisma.pricingRule.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        name: 'Test day rule',
        type: 'day_of_week',
        conditions: { weekdays: [weekday] },
        adjustPct: 20,
        priority: 1,
      },
    });

    const from = isoDate(0);
    const to = isoDate(10);
    const first = await applyPricingRules(world.organization.id, world.property.id, { from, to });
    expect(first.datesChanged).toBeGreaterThan(0);

    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(3) + 'T00:00:00Z') },
    });
    expect(Number(day!.price)).toBe(120); // basePrice 100 * 1.2

    // A date whose weekday doesn't match is untouched (still the seeded 100).
    const nonMatchWeekday = (weekday + 1) % 7;
    const nonMatchDate = [1, 2, 3, 4, 5, 6, 7].map((i) => isoDate(i)).find((d) => new Date(d + 'T00:00:00Z').getUTCDay() === nonMatchWeekday);
    if (nonMatchDate) {
      const untouched = await prisma.calendarDay.findFirst({ where: { roomTypeId: world.room.id, date: new Date(nonMatchDate + 'T00:00:00Z') } });
      expect(Number(untouched!.price)).toBe(100);
    }

    // Re-running doesn't compound the price (always recomputed from basePrice).
    const second = await applyPricingRules(world.organization.id, world.property.id, { from, to });
    expect(second.datesChanged).toBe(0); // no-op: price already matches
    const dayAgain = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(3) + 'T00:00:00Z') },
    });
    expect(Number(dayAgain!.price)).toBe(120);
  });
});

describe('PMS front desk', () => {
  it('prevents checking two bookings into the same room unit', async () => {
    const unit = await prisma.roomUnit.create({ data: { roomTypeId: world.room.id, unitNumber: 'PMS-TEST-1' } });

    const bookingA = await prisma.booking.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        sourceChannelId: (await prisma.channel.findUniqueOrThrow({ where: { code: 'booking_com' } })).id,
        externalRef: 'PMS-A',
        roomTypeId: world.room.id,
        guestName: 'Guest A',
        checkIn: new Date(isoDate(1) + 'T00:00:00Z'),
        checkOut: new Date(isoDate(2) + 'T00:00:00Z'),
        rawPayload: {},
      },
    });
    const bookingB = await prisma.booking.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        sourceChannelId: (await prisma.channel.findUniqueOrThrow({ where: { code: 'airbnb' } })).id,
        externalRef: 'PMS-B',
        roomTypeId: world.room.id,
        guestName: 'Guest B',
        checkIn: new Date(isoDate(1) + 'T00:00:00Z'),
        checkOut: new Date(isoDate(2) + 'T00:00:00Z'),
        rawPayload: {},
      },
    });

    const token = await loginAsAdmin();
    const first = await request(app)
      .post(`/api/pms/bookings/${bookingA.id}/check-in`)
      .set('authorization', `Bearer ${token}`)
      .send({ roomUnitId: unit.id });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/pms/bookings/${bookingB.id}/check-in`)
      .set('authorization', `Bearer ${token}`)
      .send({ roomUnitId: unit.id });
    expect(second.status).toBe(400);
  });
});

describe('public microsite', () => {
  it('404s for a property that has not been published', async () => {
    const res = await request(app).get(`/api/public/properties/${world.property.code}`);
    expect(res.status).toBe(404);
  });

  it('serves the property and accepts a booking once published', async () => {
    await prisma.propertySeo.upsert({
      where: { propertyId: world.property.id },
      create: { propertyId: world.property.id, published: true },
      update: { published: true },
    });

    const page = await request(app).get(`/api/public/properties/${world.property.code}`);
    expect(page.status).toBe(200);
    expect(page.body.roomTypes.length).toBeGreaterThan(0);

    const res = await request(app).post(`/api/public/bookings/${world.property.code}`).send({
      roomTypeId: world.room.id,
      checkIn: isoDate(20),
      checkOut: isoDate(22),
      guestName: 'Public Guest',
      guestEmail: 'pub@example.com',
      guestPhone: '+15551234567',
      adults: 2,
    });
    expect(res.status).toBe(201);

    const booking = await prisma.booking.findFirst({ where: { externalRef: res.body.reference } });
    expect(booking?.organizationId).toBe(world.organization.id);
    // A direct-portal booking must land mapped to the real room — otherwise it
    // never decrements availability and OTAs never learn the room is taken.
    expect(booking?.roomTypeId).toBe(world.room.id);
    expect(booking?.unmapped).toBe(false);
    expect(booking?.guestPhone).toBe('+15551234567');
    expect(booking?.adults).toBe(2);

    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(isoDate(20) + 'T00:00:00Z') },
    });
    expect(day?.availableUnits).toBe(1); // capacity 2 − 1 booked via the portal
  });

  it('rejects a party larger than the room (and every requested room) sleeps', async () => {
    const res = await request(app).post(`/api/public/bookings/${world.property.code}`).send({
      roomTypeId: world.room.id,
      checkIn: isoDate(40),
      checkOut: isoDate(42),
      guestName: 'Too Many',
      guestEmail: 'toomany@example.com',
      guestPhone: '+15551234567',
      adults: 3, // room sleeps 2, only 1 room requested
    });
    expect(res.status).toBe(400);
    const booking = await prisma.booking.findFirst({ where: { guestEmail: 'toomany@example.com' } });
    expect(booking).toBeNull();
  });

  it('a direct-portal booking is visible to the conflict engine against OTA bookings for the same room', async () => {
    // The webhook route requires each connection's secret — set known ones here
    // rather than going through the API, to keep this test focused on the
    // conflict-engine behavior.
    await prisma.channelConnection.update({ where: { id: world.connections.booking_com }, data: { webhookSecret: 'test-secret-bdc' } });
    await prisma.channelConnection.update({ where: { id: world.connections.airbnb }, data: { webhookSecret: 'test-secret-abb' } });

    // Capacity 2; one unit already consumed by the portal booking above on
    // isoDate(20)-isoDate(22). One more OTA booking on the same night is fine...
    const ok = await request(app).post('/api/webhooks/booking_com?propertyCode=' + world.property.code + '&secret=test-secret-bdc').send({
      propertyCode: world.property.code,
      externalRef: 'BDC-VS-DIRECT-OK',
      status: 'confirmed',
      channelCode: 'booking_com',
      externalRoomId: 'booking_com-R1',
      guestName: 'OTA Guest',
      guestEmail: 'ota@example.com',
      checkIn: isoDate(20),
      checkOut: isoDate(21),
      units: 1,
      currency: 'USD',
      amount: 100,
      raw: {},
    });
    expect(ok.status).toBe(200);

    // ...but a THIRD booking for that same night, from yet another OTA, must be
    // rejected — it would oversell a room the direct portal already half-filled.
    const over = await request(app).post('/api/webhooks/airbnb?propertyCode=' + world.property.code + '&secret=test-secret-abb').send({
      propertyCode: world.property.code,
      externalRef: 'ABB-VS-DIRECT-OVER',
      status: 'confirmed',
      channelCode: 'airbnb',
      externalRoomId: 'airbnb-R1',
      guestName: 'Second OTA Guest',
      guestEmail: 'ota2@example.com',
      checkIn: isoDate(20),
      checkOut: isoDate(21),
      units: 1,
      currency: 'USD',
      amount: 100,
      raw: {},
    });
    expect(over.status).toBe(200);
    expect(over.body.outcomes[0].rejected).toBe(true);
  });

  it('rejects a webhook call with a missing or wrong secret — propertyCode alone is not enough', async () => {
    await prisma.channelConnection.update({ where: { id: world.connections.booking_com }, data: { webhookSecret: 'the-real-secret' } });

    const noSecret = await request(app).post('/api/webhooks/booking_com?propertyCode=' + world.property.code).send({
      externalRef: 'FORGED-1',
      checkIn: isoDate(25),
      checkOut: isoDate(26),
      guestName: 'Attacker',
    });
    expect(noSecret.status).toBe(401);

    const wrongSecret = await request(app)
      .post('/api/webhooks/booking_com?propertyCode=' + world.property.code + '&secret=guessed-wrong')
      .send({ externalRef: 'FORGED-2', checkIn: isoDate(25), checkOut: isoDate(26), guestName: 'Attacker' });
    expect(wrongSecret.status).toBe(401);

    const injected = await prisma.booking.findFirst({ where: { externalRef: { in: ['FORGED-1', 'FORGED-2'] } } });
    expect(injected).toBeNull();
  });
});

async function loginAsAdmin(): Promise<string> {
  const email = `pms-test-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      organizationId: world.organization.id,
      email,
      name: 'PMS Tester',
      role: 'admin',
      // bcrypt hash of "password123" isn't needed — log in via a direct token-less path
      // would require the auth module; simplest is to hash here.
      passwordHash: await (await import('bcryptjs')).default.hash('password123', 4),
    },
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.token as string;
}
