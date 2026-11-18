import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

const app = createApp();
const PREFIX = `portfolio_test_${Date.now().toString(36)}`;

async function createOrg(name: string) {
  return prisma.organization.create({
    data: { name, slug: `${PREFIX}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, contactEmail: 'test@example.com' },
  });
}

/** Creates a user directly (no self-serve signup — the super admin does this now) and
 *  logs in, returning a bearer token. */
async function createUserAndLogin(opts: {
  organizationId?: string | null;
  role?: 'admin' | 'manager' | 'viewer';
  isSuperAdmin?: boolean;
  assignedPropertyId?: string | null;
}) {
  const email = `${PREFIX}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  await prisma.user.create({
    data: {
      organizationId: opts.organizationId ?? null,
      email,
      name: 'Test User',
      role: opts.role ?? 'admin',
      isSuperAdmin: opts.isSuperAdmin ?? false,
      assignedPropertyId: opts.assignedPropertyId ?? null,
      passwordHash: await bcrypt.hash('password123', 4),
    },
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function createProperty(organizationId: string, code: string) {
  return prisma.property.create({
    data: { organizationId, code, name: `Property ${code}`, country: 'US', currency: 'USD' },
  });
}

let superToken: string;
let org: Awaited<ReturnType<typeof createOrg>>;

beforeAll(async () => {
  org = await createOrg(`${PREFIX} Portfolio`);
  superToken = await createUserAndLogin({ isSuperAdmin: true });
});

afterAll(async () => {
  // Admin routes operate on the single global portfolio org (whichever one already
  // exists in this database), not necessarily the org created in beforeAll — so
  // anything created through them is cleaned up by property code, not by org/slug.
  await prisma.property.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('no self-serve signup', () => {
  it('there is no /api/auth/signup route left (falls through to the auth-required gate)', async () => {
    const res = await request(app).post('/api/auth/signup').send({});
    expect(res.status).toBe(401);
  });
});

describe('admin: properties and managers', () => {
  it('a super admin can add properties with no count limit', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/admin/properties')
        .set('authorization', `Bearer ${superToken}`)
        .send({ code: `${PREFIX}-ADD${i}`, name: `Added ${i}` });
      expect(res.status).toBe(201);
    }
  });

  it('a non-admin cannot reach /api/admin routes', async () => {
    const token = await createUserAndLogin({ organizationId: org.id, role: 'admin' });
    const res = await request(app).get('/api/admin/properties').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('assigns a dedicated manager (new account) to a property, hard-scoping it', async () => {
    const property = await createProperty(org.id, `${PREFIX}-ASSIGN1`);
    const email = `${PREFIX}_newmanager@example.com`;
    const res = await request(app)
      .post(`/api/admin/properties/${property.id}/assign-manager`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ email, name: 'New Manager', password: 'password123', role: 'admin' });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.assignedPropertyId).toBe(property.id);
  });

  it('unassigns a manager, restoring portfolio-wide (unscoped) access', async () => {
    const property = await createProperty(org.id, `${PREFIX}-UNASSIGN1`);
    const assign = await request(app)
      .post(`/api/admin/properties/${property.id}/assign-manager`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ email: `${PREFIX}_unassign@example.com`, name: 'Temp Manager', password: 'password123' });
    const userId = assign.body.user.id as string;

    const res = await request(app)
      .post(`/api/admin/properties/${property.id}/unassign-manager/${userId}`)
      .set('authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(204);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.assignedPropertyId).toBeNull();
  });
});

describe('a property-scoped manager is hard-restricted to their own property', () => {
  it('cannot see or touch another property\'s bookings, calendar, or property record', async () => {
    const propertyA = await createProperty(org.id, `${PREFIX}-SCOPE-A`);
    const propertyB = await createProperty(org.id, `${PREFIX}-SCOPE-B`);
    const managerAToken = await createUserAndLogin({ organizationId: org.id, role: 'admin', assignedPropertyId: propertyA.id });

    const readOwn = await request(app).get(`/api/properties/${propertyA.id}`).set('authorization', `Bearer ${managerAToken}`);
    expect(readOwn.status).toBe(200);

    const readOther = await request(app).get(`/api/properties/${propertyB.id}`).set('authorization', `Bearer ${managerAToken}`);
    expect(readOther.status).toBe(404);

    const patchOther = await request(app)
      .patch(`/api/properties/${propertyB.id}`)
      .set('authorization', `Bearer ${managerAToken}`)
      .send({ name: 'Hijacked' });
    expect(patchOther.status).toBe(404);

    const calendarOther = await request(app)
      .get(`/api/calendar?propertyId=${propertyB.id}`)
      .set('authorization', `Bearer ${managerAToken}`);
    expect(calendarOther.status).toBe(404);

    const bookingsOther = await request(app)
      .get(`/api/bookings?propertyId=${propertyB.id}`)
      .set('authorization', `Bearer ${managerAToken}`);
    expect(bookingsOther.status).toBe(404);
  });

  it('list endpoints auto-filter to the scoped manager\'s own property', async () => {
    const propertyA = await createProperty(org.id, `${PREFIX}-FILTER-A`);
    await createProperty(org.id, `${PREFIX}-FILTER-B`);
    const managerToken = await createUserAndLogin({ organizationId: org.id, role: 'admin', assignedPropertyId: propertyA.id });

    const list = await request(app).get('/api/properties').set('authorization', `Bearer ${managerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.properties).toHaveLength(1);
    expect(list.body.properties[0].id).toBe(propertyA.id);

    const bookings = await request(app).get('/api/bookings').set('authorization', `Bearer ${managerToken}`);
    expect(bookings.status).toBe(200);
    expect(bookings.body.bookings.every((b: { propertyId: string }) => b.propertyId === propertyA.id)).toBe(true);
  });

  it('cannot create a new property or manage staff', async () => {
    const property = await createProperty(org.id, `${PREFIX}-NOCREATE`);
    const managerToken = await createUserAndLogin({ organizationId: org.id, role: 'admin', assignedPropertyId: property.id });

    const createAttempt = await request(app)
      .post('/api/properties')
      .set('authorization', `Bearer ${managerToken}`)
      .send({ code: `${PREFIX}-SHOULDFAIL`, name: 'Should fail' });
    expect(createAttempt.status).toBe(403);

    const staffAttempt = await request(app).get('/api/staff').set('authorization', `Bearer ${managerToken}`);
    expect(staffAttempt.status).toBe(403);
  });
});

describe('public booking page — no login required', () => {
  it('a newly created property is published and bookable with zero manual setup', async () => {
    const res = await request(app)
      .post('/api/admin/properties')
      .set('authorization', `Bearer ${superToken}`)
      .send({ code: `${PREFIX}-PUB1`, name: 'Public Test' });
    expect(res.status).toBe(201);

    const publicPage = await request(app).get(`/api/public/properties/${PREFIX}-PUB1`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.property.code).toBe(`${PREFIX}-PUB1`);
  });

  it('an unauthenticated request never gets redirected to a login response', async () => {
    const res = await request(app).get('/api/public/properties/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('tenant isolation (two organizations, an edge case now that there is one by default)', () => {
  it('org A cannot read or modify org B\'s property by id', async () => {
    const orgA = await createOrg(`${PREFIX} Org A`);
    const orgB = await createOrg(`${PREFIX} Org B`);
    const tokenA = await createUserAndLogin({ organizationId: orgA.id, role: 'admin' });
    const tokenB = await createUserAndLogin({ organizationId: orgB.id, role: 'admin' });
    const propertyB = await createProperty(orgB.id, `${PREFIX}-ISO-B`);

    const readAsA = await request(app).get(`/api/properties/${propertyB.id}`).set('authorization', `Bearer ${tokenA}`);
    expect(readAsA.status).toBe(404);

    const patchAsA = await request(app)
      .patch(`/api/properties/${propertyB.id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hijacked' });
    expect(patchAsA.status).toBe(404);

    const readAsB = await request(app).get(`/api/properties/${propertyB.id}`).set('authorization', `Bearer ${tokenB}`);
    expect(readAsB.status).toBe(200);
  });
});

describe('commission is admin-settable from 0% to 100%', () => {
  it('accepts 0 and rejects over 100%', async () => {
    const zero = await request(app)
      .patch('/api/admin/organizations/commission')
      .set('authorization', `Bearer ${superToken}`)
      .send({ commissionRateBps: 0 });
    expect(zero.status).toBe(200);
    expect(zero.body.organization.commissionRateBps).toBe(0);

    const full = await request(app)
      .patch('/api/admin/organizations/commission')
      .set('authorization', `Bearer ${superToken}`)
      .send({ commissionRateBps: 10_000 });
    expect(full.status).toBe(200);
    expect(full.body.organization.commissionRateBps).toBe(10_000);

    const tooHigh = await request(app)
      .patch('/api/admin/organizations/commission')
      .set('authorization', `Bearer ${superToken}`)
      .send({ commissionRateBps: 10_001 });
    expect(tooHigh.status).toBe(400);
  });
});
