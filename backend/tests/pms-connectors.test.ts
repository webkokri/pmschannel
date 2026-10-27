import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { DEFAULT_PLANS, FULL_CHANNEL_CATALOG } from '@cm/shared';

const app = createApp();
const PREFIX = `pms_test_${Date.now().toString(36)}`;

async function ensurePlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: { limits: p.limits as object },
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

async function ensureChannel(code: string) {
  const def = FULL_CHANNEL_CATALOG.find((c) => c.code === code)!;
  return prisma.channel.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name: def.name,
      category: def.category,
      kind: def.kind,
      authType: def.authType,
      markets: def.markets,
      capabilities: def.capabilities,
      docsUrl: def.docsUrl,
      notes: def.notes,
    },
  });
}

let signupCounter = 0;
async function signupAndLogin(planCode: string) {
  const email = `${PREFIX}_${planCode}_${++signupCounter}@example.com`;
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ organizationName: `${PREFIX} ${planCode} ${signupCounter}`, name: 'Owner', email, password: 'password123', planCode });
  expect(res.status).toBe(201);
  const token = res.body.token as string;
  const property = await request(app)
    .post('/api/properties')
    .set('authorization', `Bearer ${token}`)
    .send({ code: `${PREFIX}-${signupCounter}`, name: 'Test Property' });
  expect(property.status).toBe(201);
  return { token, propertyId: property.body.property.id as string };
}

beforeAll(async () => {
  await ensurePlans();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('third-party PMS connectors (WebRezPro, AutoClerk, Jonas Chorum, etc.)', () => {
  it('are seeded under the "pms" channel category', async () => {
    const webrezpro = await ensureChannel('webrezpro');
    expect(webrezpro.category).toBe('pms');
    expect(webrezpro.authType).toBe('api_key');
  });

  it('a Starter org is blocked from connecting a PMS integration (plan gate)', async () => {
    const channel = await ensureChannel('webrezpro');
    const { token, propertyId } = await signupAndLogin('starter');
    const res = await request(app)
      .post('/api/channels/connections')
      .set('authorization', `Bearer ${token}`)
      .send({ propertyId, channelId: channel.id, enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/property management/i);
  });

  it('a Growth org can connect, configure credentials, and test a PMS connection', async () => {
    const channel = await ensureChannel('autoclerk');
    const { token, propertyId } = await signupAndLogin('growth');

    const connect = await request(app)
      .post('/api/channels/connections')
      .set('authorization', `Bearer ${token}`)
      .send({ propertyId, channelId: channel.id, enabled: true });
    expect(connect.status).toBe(201);
    const connectionId = connect.body.connection.id as string;
    expect(connect.body.connection.driver).toBe('mock');

    const withCreds = await request(app)
      .patch(`/api/channels/connections/${connectionId}`)
      .set('authorization', `Bearer ${token}`)
      .send({ credentials: { apiKey: 'super-secret-key-0001', propertyId: 'AC-9981' } });
    expect(withCreds.status).toBe(200);
    // Credentials come back redacted, never in plaintext.
    expect(withCreds.body.connection.credentials.apiKey).not.toBe('super-secret-key-0001');
    expect(withCreds.body.connection.credentials.apiKey).toMatch(/•/);

    const tested = await request(app)
      .post(`/api/channels/connections/${connectionId}/test`)
      .set('authorization', `Bearer ${token}`);
    expect(tested.status).toBe(200);
    expect(tested.body.driver).toBe('mock');
    expect(tested.body.result.ok).toBe(true);
    expect(tested.body.result.message).toMatch(/AutoClerk/);
  });

  it('accelerator-style bulk connections are unaffected — PMS connections count as normal channel usage', async () => {
    const channel = await ensureChannel('mews');
    const { token, propertyId } = await signupAndLogin('growth');
    const connect = await request(app)
      .post('/api/channels/connections')
      .set('authorization', `Bearer ${token}`)
      .send({ propertyId, channelId: channel.id, enabled: true });
    expect(connect.status).toBe(201);

    const count = await prisma.channelConnection.count({
      where: { id: connect.body.connection.id, viaAccelerator: false, enabled: true },
    });
    expect(count).toBe(1);
  });
});
