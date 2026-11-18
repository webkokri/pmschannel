import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { cleanWorld, makeWorld } from './helpers';

const app = createApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let adminToken: string;
let managerToken: string;

beforeAll(async () => {
  await cleanWorld();
  world = await makeWorld({ channels: ['booking_com'] });

  const adminEmail = `page-builder-admin-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      organizationId: world.organization.id,
      email: adminEmail,
      name: 'Org Admin',
      role: 'admin',
      passwordHash: await (await import('bcryptjs')).default.hash('password123', 4),
    },
  });
  adminToken = (await request(app).post('/api/auth/login').send({ email: adminEmail, password: 'password123' })).body.token;

  const managerEmail = `page-builder-manager-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      organizationId: world.organization.id,
      email: managerEmail,
      name: 'Org Manager',
      role: 'manager',
      passwordHash: await (await import('bcryptjs')).default.hash('password123', 4),
    },
  });
  managerToken = (await request(app).post('/api/auth/login').send({ email: managerEmail, password: 'password123' })).body.token;
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

describe('page builder — admin-only design', () => {
  it('a manager can read the page content but not save changes to it', async () => {
    const get = await request(app)
      .get(`/api/page-builder/${world.property.id}`)
      .set('authorization', `Bearer ${managerToken}`);
    expect(get.status).toBe(200);
    expect(get.body.content.heroHeadline).toBe('');

    const put = await request(app)
      .put(`/api/page-builder/${world.property.id}`)
      .set('authorization', `Bearer ${managerToken}`)
      .send({ heroHeadline: 'Hacked by a manager' });
    expect(put.status).toBe(403);

    const after = await request(app)
      .get(`/api/page-builder/${world.property.id}`)
      .set('authorization', `Bearer ${adminToken}`);
    expect(after.body.content.heroHeadline).toBe('');
  });

  it('an admin can design the page, and it renders on the public booking page', async () => {
    const put = await request(app)
      .put(`/api/page-builder/${world.property.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        heroHeadline: 'Welcome to Test Lodge',
        heroSubheadline: 'Right by the lake',
        heroImageUrl: 'https://example.com/hero.jpg',
        primaryColor: '#ff5500',
        aboutText: 'A cozy lodge with mountain views.',
        amenities: ['Free WiFi', 'Pool'],
        galleryImageUrls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        sections: [{ id: 'a1', heading: 'Nearby attractions', body: 'The lake is 5 minutes away.' }],
      });
    expect(put.status).toBe(200);
    expect(put.body.content.heroHeadline).toBe('Welcome to Test Lodge');
    expect(put.body.content.sections[0].heading).toBe('Nearby attractions');

    await prisma.propertySeo.upsert({
      where: { propertyId: world.property.id },
      create: { propertyId: world.property.id, published: true },
      update: { published: true },
    });

    const publicPage = await request(app).get(`/api/public/properties/${world.property.code}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.pageContent.heroHeadline).toBe('Welcome to Test Lodge');
    expect(publicPage.body.pageContent.amenities).toEqual(['Free WiFi', 'Pool']);
    expect(publicPage.body.pageContent.sections[0].body).toBe('The lake is 5 minutes away.');
  });

  it('rejects an invalid color value', async () => {
    const res = await request(app)
      .put(`/api/page-builder/${world.property.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ primaryColor: 'not-a-color' });
    expect(res.status).toBe(400);
  });
});

describe('embeddable widget script', () => {
  it('serves a generic, cacheable JS loader', async () => {
    const res = await request(app).get('/api/public/widget.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toMatch(/data-cm-booking-widget/);
    expect(res.text).toMatch(/cm-resize/);
  });
});
