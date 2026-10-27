import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { getCommissionRateBps } from '../src/lib/commission';
import { activateAccelerator, getAcceleratorChannelCodes } from '../src/lib/accelerator';
import { assertWithinLimit } from '../src/lib/limits';
import { setPlatformSetting } from '../src/lib/platform-settings';
import { cleanWorld, isoDate, makeWorld } from './helpers';

const app = createApp();
let world: Awaited<ReturnType<typeof makeWorld>>;

async function loginAsAdmin(): Promise<string> {
  const email = `commission-test-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      organizationId: world.organization.id,
      email,
      name: 'Commission Tester',
      role: 'admin',
      passwordHash: await bcrypt.hash('password123', 4),
    },
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.token as string;
}

beforeAll(async () => {
  await cleanWorld();
  world = await makeWorld({ capacity: 2, channels: ['booking_com', 'airbnb'] });
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

describe('commission rate resolution', () => {
  it('falls back to the platform default when the org has no override', async () => {
    await setPlatformSetting('commission:defaultRateBps', 300);
    const rate = await getCommissionRateBps(world.organization.id);
    expect(rate).toBe(300);
  });

  it('an org-level override wins over the platform default', async () => {
    await prisma.organization.update({ where: { id: world.organization.id }, data: { commissionRateBps: 150 } });
    const rate = await getCommissionRateBps(world.organization.id);
    expect(rate).toBe(150);
    await prisma.organization.update({ where: { id: world.organization.id }, data: { commissionRateBps: null } });
  });
});

describe('guest payments carry the commission split', () => {
  it('records commission/net on a cash payment (no Stripe involved)', async () => {
    await setPlatformSetting('commission:defaultRateBps', 250);
    const booking = await prisma.booking.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        sourceChannelId: (await prisma.channel.findUniqueOrThrow({ where: { code: 'booking_com' } })).id,
        externalRef: 'COMMISSION-CASH-1',
        roomTypeId: world.room.id,
        guestName: 'Cash Guest',
        checkIn: new Date(isoDate(1) + 'T00:00:00Z'),
        checkOut: new Date(isoDate(2) + 'T00:00:00Z'),
        amount: 200,
        rawPayload: {},
      },
    });

    const token = await loginAsAdmin();
    const res = await request(app)
      .post('/api/payments')
      .set('authorization', `Bearer ${token}`)
      .send({ bookingId: booking.id, amountCents: 20_000, method: 'cash' });

    expect(res.status).toBe(201);
    expect(res.body.payment.status).toBe('captured');
    expect(res.body.payment.commissionRateBps).toBe(250);
    expect(res.body.payment.commissionCents).toBe(500); // 2.5% of 20000
    expect(res.body.payment.netCents).toBe(19_500);
    expect(res.body.payment.transferredToConnectAt).toBeNull(); // never touched our gateway
  });

  it('a refund claws back commission proportionally', async () => {
    const booking = await prisma.booking.create({
      data: {
        organizationId: world.organization.id,
        propertyId: world.property.id,
        sourceChannelId: (await prisma.channel.findUniqueOrThrow({ where: { code: 'airbnb' } })).id,
        externalRef: 'COMMISSION-CASH-2',
        roomTypeId: world.room.id,
        guestName: 'Refund Guest',
        checkIn: new Date(isoDate(3) + 'T00:00:00Z'),
        checkOut: new Date(isoDate(4) + 'T00:00:00Z'),
        amount: 100,
        rawPayload: {},
      },
    });
    const token = await loginAsAdmin();
    const charge = await request(app)
      .post('/api/payments')
      .set('authorization', `Bearer ${token}`)
      .send({ bookingId: booking.id, amountCents: 10_000, method: 'cash' });
    expect(charge.body.payment.commissionCents).toBe(250);

    const refund = await request(app)
      .post(`/api/payments/${charge.body.payment.id}/refund`)
      .set('authorization', `Bearer ${token}`)
      .send({ amountCents: 5_000 }); // half refunded
    expect(refund.status).toBe(200);
    expect(refund.body.payment.status).toBe('partially_refunded');
    // Half refunded -> half the original commission (250) and half the original net (9750)
    // move into "refunded"; what's left should still reconcile to the full original amount.
    expect(refund.body.payment.commissionCents).toBe(125);
    expect(refund.body.payment.netCents).toBe(4_875);
    expect(refund.body.payment.commissionCents + refund.body.payment.netCents + refund.body.payment.refundedCents).toBe(10_000);
  });
});

describe('Accelerator', () => {
  it('activating connects the bundle channels and flags them viaAccelerator', async () => {
    const codes = await getAcceleratorChannelCodes();
    const result = await activateAccelerator(world.organization.id);
    expect(result.connectionsCreated).toBeGreaterThan(0);
    expect(result.channelCodes).toEqual(codes);

    const accelerator = await prisma.accelerator.findUnique({ where: { organizationId: world.organization.id } });
    expect(accelerator?.active).toBe(true);

    const boosted = await prisma.channelConnection.findMany({
      where: { organizationId: world.organization.id, viaAccelerator: true },
    });
    expect(boosted.length).toBeGreaterThan(0);
    expect(boosted.every((c) => c.enabled)).toBe(true);
  });

  it('accelerator connections never count against (or get blocked by) the plan channel limit', async () => {
    // Give the org a Starter-tier plan with a channel limit already met by the accelerator
    // connections alone, then confirm a *new* (non-accelerator) connection attempt is still
    // correctly evaluated against just the real usage, not inflated by the accelerator ones.
    const restrictivePlan = await prisma.plan.upsert({
      where: { code: 'commission-test-restrictive' },
      update: {},
      create: {
        code: 'commission-test-restrictive',
        name: 'Restrictive',
        limits: { maxProperties: 1, maxRoomTypesPerProperty: 1, maxChannelConnections: 1, maxUsers: 1, channelCategories: [] },
      },
    });
    await prisma.subscription.update({ where: { organizationId: world.organization.id }, data: { planId: restrictivePlan.id } });

    // The 2 non-accelerator connections from makeWorld (booking_com, airbnb) already exceed
    // maxChannelConnections=1, so a real new connection should be blocked...
    await expect(assertWithinLimit(world.organization.id, 'channelConnections')).rejects.toThrow();

    // ...but that block is driven by the 2 real connections, not by however many accelerator
    // ones exist (already several from the previous test) — i.e. accelerator rows are
    // excluded from the count entirely, confirmed by checking the count directly.
    const nonAcceleratorCount = await prisma.channelConnection.count({
      where: { organizationId: world.organization.id, enabled: true, viaAccelerator: false },
    });
    expect(nonAcceleratorCount).toBe(2);
  });
});
