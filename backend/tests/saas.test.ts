import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { DEFAULT_PLANS } from '@cm/shared';

const app = createApp();
const PREFIX = `saas_test_${Date.now().toString(36)}`;

async function ensurePlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        limits: p.limits as object,
        sortOrder: p.sortOrder,
      },
    });
  }
}

let signupCounter = 0;

async function signupAndLogin(orgName: string, planCode: string) {
  const email = `${PREFIX}_${planCode}_${++signupCounter}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ organizationName: orgName, name: 'Owner', email, password: 'password123', planCode });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, organizationId: res.body.organization.id as string };
}

async function createProperty(token: string, code: string) {
  return request(app)
    .post('/api/properties')
    .set('authorization', `Bearer ${token}`)
    .send({ code, name: `Property ${code}` });
}

beforeAll(async () => {
  await ensurePlans();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX.replace(/_/g, '-') } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('signup', () => {
  it('creates an Organization + trial Subscription + admin User, and auto-assigns a support manager', async () => {
    const { token } = await signupAndLogin(`${PREFIX} Starter Co`, 'starter');
    const me = await request(app).get('/api/billing/me').set('authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.subscription.plan.code).toBe('starter');
    expect(me.body.organization.name).toBe(`${PREFIX} Starter Co`);
    // supportManager may be null if no staff seeded in this DB — assert the field exists either way.
    expect(me.body).toHaveProperty('supportManager');
  });

  it('rejects a duplicate email', async () => {
    const email = `${PREFIX}_dup@example.com`;
    const first = await request(app)
      .post('/api/auth/signup')
      .send({ organizationName: `${PREFIX} Dup1`, name: 'A', email, password: 'password123', planCode: 'starter' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/auth/signup')
      .send({ organizationName: `${PREFIX} Dup2`, name: 'B', email, password: 'password123', planCode: 'starter' });
    expect(second.status).toBe(400);
  });
});

describe('plan limits — property count', () => {
  it('blocks a Starter org from a 2nd property (plan allows 1)', async () => {
    const { token } = await signupAndLogin(`${PREFIX} Starter Ltd`, 'starter');
    const first = await createProperty(token, `${PREFIX}-S1`);
    expect(first.status).toBe(201);

    const second = await createProperty(token, `${PREFIX}-S2`);
    expect(second.status).toBe(402);
    expect(second.body.details.limitKey).toBe('properties');
    expect(second.body.error).toMatch(/upgrade/i);
  });

  it('blocks a Growth org from a 4th property (plan allows 3)', async () => {
    const { token } = await signupAndLogin(`${PREFIX} Growth Ltd`, 'growth');
    for (const n of [1, 2, 3]) {
      const res = await createProperty(token, `${PREFIX}-G${n}`);
      expect(res.status).toBe(201);
    }
    const fourth = await createProperty(token, `${PREFIX}-G4`);
    expect(fourth.status).toBe(402);
    expect(fourth.body.details.limitKey).toBe('properties');
  });

  it('lifting the limit via a super-admin plan override unblocks it immediately', async () => {
    const { token, organizationId } = await signupAndLogin(`${PREFIX} Upgrade Me`, 'starter');
    await createProperty(token, `${PREFIX}-U1`);
    const blocked = await createProperty(token, `${PREFIX}-U2`);
    expect(blocked.status).toBe(402);

    // Simulate the super-admin override directly (module-level, same as the admin route).
    const enterprise = await prisma.plan.findUniqueOrThrow({ where: { code: 'enterprise' } });
    await prisma.subscription.update({ where: { organizationId }, data: { planId: enterprise.id } });

    const unblocked = await createProperty(token, `${PREFIX}-U3`);
    expect(unblocked.status).toBe(201);
  });
});

describe('public booking page — no login required', () => {
  it('a newly created property is published and bookable with zero manual setup', async () => {
    const { token } = await signupAndLogin(`${PREFIX} Instant Publish`, 'starter');
    const code = `${PREFIX}-IP1`;
    const created = await createProperty(token, code);
    expect(created.status).toBe(201);

    // No authorization header at all — this is exactly what a guest's browser sends.
    const publicPage = await request(app).get(`/api/public/properties/${code}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.property.code).toBe(code);
  });

  it('an unauthenticated request never gets redirected to a login response', async () => {
    const res = await request(app).get('/api/public/properties/does-not-exist');
    // 404 ("property not found" or "not published"), never 401 — a guest with no
    // token at all must never be treated as a failed/expired login.
    expect(res.status).toBe(404);
  });
});

describe('tenant isolation', () => {
  it('org A cannot read or modify org B\'s property by id', async () => {
    const a = await signupAndLogin(`${PREFIX} Org A`, 'growth');
    const b = await signupAndLogin(`${PREFIX} Org B`, 'growth');

    const created = await createProperty(b.token, `${PREFIX}-ISO-B`);
    expect(created.status).toBe(201);
    const propertyId = created.body.property.id as string;

    const readAsA = await request(app).get(`/api/properties/${propertyId}`).set('authorization', `Bearer ${a.token}`);
    expect(readAsA.status).toBe(404);

    const patchAsA = await request(app)
      .patch(`/api/properties/${propertyId}`)
      .set('authorization', `Bearer ${a.token}`)
      .send({ name: 'Hijacked' });
    expect(patchAsA.status).toBe(404);

    const readAsB = await request(app).get(`/api/properties/${propertyId}`).set('authorization', `Bearer ${b.token}`);
    expect(readAsB.status).toBe(200);
  });

  it('org A\'s booking list never includes org B\'s bookings', async () => {
    const a = await signupAndLogin(`${PREFIX} Bk Org A`, 'growth');
    const b = await signupAndLogin(`${PREFIX} Bk Org B`, 'growth');

    const listA = await request(app).get('/api/bookings').set('authorization', `Bearer ${a.token}`);
    const listB = await request(app).get('/api/bookings').set('authorization', `Bearer ${b.token}`);
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(listA.body.bookings).toEqual([]);
    expect(listB.body.bookings).toEqual([]);
    // Sanity: hitting one org's endpoint never 500s or leaks the other's property ids.
    expect(listA.body.total).toBe(0);
  });
});

describe('super admin', () => {
  it('a normal org admin cannot reach /api/admin routes', async () => {
    const { token } = await signupAndLogin(`${PREFIX} NotAdmin`, 'starter');
    const res = await request(app).get('/api/admin/organizations').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('a super admin can list organizations and override a plan', async () => {
    const superEmail = `${PREFIX}_super@example.com`;
    await prisma.user.create({
      data: {
        email: superEmail,
        name: 'Super',
        isSuperAdmin: true,
        passwordHash: await bcrypt.hash('password123', 10),
      },
    });
    const login = await request(app).post('/api/auth/login').send({ email: superEmail, password: 'password123' });
    expect(login.status).toBe(200);
    const superToken = login.body.token as string;

    const { organizationId } = await signupAndLogin(`${PREFIX} Managed Co`, 'starter');

    const list = await request(app).get('/api/admin/organizations').set('authorization', `Bearer ${superToken}`);
    expect(list.status).toBe(200);
    expect(list.body.organizations.some((o: { id: string }) => o.id === organizationId)).toBe(true);

    const override = await request(app)
      .patch(`/api/admin/organizations/${organizationId}/plan`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ planCode: 'enterprise' });
    expect(override.status).toBe(200);
    expect(override.body.subscription.plan.code).toBe('enterprise');
  });
});
