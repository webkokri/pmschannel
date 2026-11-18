import { Router } from 'express';
import { z } from 'zod';
import { OTA_CATEGORIES } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { assertOwned, assertPropertyInScope, resolvePropertyFilter, requireOrg } from '../lib/tenant';
import { decryptJson, encryptJson, generateSecret, redactCredentials } from '../lib/crypto';
import { resolveConnection } from '../connectors/registry';
import { env } from '../env';

export const channelsRouter = Router();
channelsRouter.use(requireOrg);

// ── Channel catalogue (platform-global; edited only by the super admin) ────

channelsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const scope = resolvePropertyFilter(req);
    const channels = await prisma.channel.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        connections: {
          where: { organizationId, ...(scope ? { propertyId: scope } : {}) },
          select: { id: true, enabled: true, status: true, propertyId: true },
        },
      },
    });
    res.json({
      categories: OTA_CATEGORIES,
      channels: channels.map((c) => ({
        ...c,
        connectedCount: c.connections.filter((x) => x.enabled).length,
      })),
    });
  }),
);

// ── Connections ────────────────────────────────────────────────────────────

const connectionInput = z.object({
  propertyId: z.string(),
  channelId: z.string(),
  enabled: z.boolean().optional(),
  credentials: z.record(z.any()).optional(),
  syncAvailability: z.boolean().optional(),
  syncRates: z.boolean().optional(),
  syncRestrictions: z.boolean().optional(),
  importBookings: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  pullIntervalSec: z.number().int().min(10).max(86400).optional(),
});

async function present(conn: {
  id: string;
  credentials: string;
  webhookSecret: string;
  [k: string]: unknown;
}) {
  const creds = decryptJson<Record<string, unknown>>(conn.credentials) ?? {};
  const channel = (conn as { channel?: { code: string; authType: string } }).channel;
  const property = (conn as { property?: { code: string } }).property;

  // Lazily provision the webhook secret on first view, so every connection — old
  // or new — ends up with one without needing a data migration. The webhook route
  // itself never generates one; it only verifies, and fails closed if it's unset.
  let webhookSecret = conn.webhookSecret;
  if (!webhookSecret) {
    webhookSecret = generateSecret();
    await prisma.channelConnection.update({ where: { id: conn.id }, data: { webhookSecret } });
  }

  return {
    ...conn,
    credentials: redactCredentials(creds),
    driver: creds.driver === 'real' ? 'real' : 'mock',
    webhookSecret,
    webhookUrl:
      `${env.publicApiUrl}/api/webhooks/${channel?.code ?? ''}` +
      `?propertyCode=${encodeURIComponent(property?.code ?? '')}&secret=${webhookSecret}`,
    // Only meaningful for iCal-type connections — the feed the other platform
    // should subscribe to so it learns about bookings made anywhere on this room.
    icalExportUrl: channel?.authType === 'ical_url' ? `${env.publicApiUrl}/api/ical/${conn.id}.ics` : null,
  };
}

async function assertConnectionOwned(id: string, organizationId: string, req: import('express').Request) {
  return assertOwned(() => prisma.channelConnection.findUnique({ where: { id } }), organizationId, 'Connection', req);
}

channelsRouter.get(
  '/connections',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const where = {
      organizationId,
      ...(propertyId ? { propertyId } : {}),
    };
    const connections = await prisma.channelConnection.findMany({
      where,
      include: {
        channel: true,
        property: { select: { id: true, name: true, code: true } },
        _count: { select: { roomMappings: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ connections: await Promise.all(connections.map(present)) });
  }),
);

channelsRouter.get(
  '/connections/:id',
  asyncHandler(async (req, res) => {
    await assertConnectionOwned(req.params.id, req.user!.organizationId!, req);
    const conn = await prisma.channelConnection.findUnique({
      where: { id: req.params.id },
      include: {
        channel: true,
        property: { select: { id: true, name: true, code: true } },
        roomMappings: { include: { roomType: true, ratePlan: true } },
      },
    });
    if (!conn) throw notFound('Connection not found');
    res.json({ connection: await present(conn) });
  }),
);

channelsRouter.post(
  '/connections',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(connectionInput, req.body);
    const { credentials, ...rest } = body;

    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property', req);
    const channel = await prisma.channel.findUnique({ where: { id: body.channelId } });
    if (!channel) throw badRequest('Unknown channel');

    const existing = await prisma.channelConnection.findUnique({
      where: { propertyId_channelId: { propertyId: body.propertyId, channelId: body.channelId } },
    });

    const conn = await prisma.channelConnection.upsert({
      where: { propertyId_channelId: { propertyId: body.propertyId, channelId: body.channelId } },
      create: {
        ...rest,
        organizationId,
        propertyId: body.propertyId,
        channelId: body.channelId,
        credentials: credentials ? encryptJson(credentials) : '',
      },
      update: {
        ...rest,
        ...(credentials ? { credentials: encryptJson(credentials) } : {}),
      },
      include: { channel: true, property: { select: { id: true, name: true, code: true } } },
    });
    res.status(201).json({ connection: await present(conn) });
  }),
);

channelsRouter.patch(
  '/connections/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await assertConnectionOwned(req.params.id, organizationId, req);
    const body = parse(connectionInput.partial().omit({ propertyId: true, channelId: true }), req.body);
    const { credentials, ...rest } = body;

    // Merge credential patches onto the existing blob so partial updates keep secrets.
    let credentialsBlob: string | undefined;
    if (credentials) {
      const current = decryptJson<Record<string, unknown>>(existing.credentials) ?? {};
      credentialsBlob = encryptJson({ ...current, ...credentials });
    }

    const conn = await prisma.channelConnection.update({
      where: { id: req.params.id },
      data: { ...rest, ...(credentialsBlob ? { credentials: credentialsBlob } : {}) },
      include: { channel: true, property: { select: { id: true, name: true, code: true } } },
    });
    res.json({ connection: await present(conn) });
  }),
);

channelsRouter.delete(
  '/connections/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await assertConnectionOwned(req.params.id, req.user!.organizationId!, req);
    await prisma.channelConnection.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

channelsRouter.post(
  '/connections/:id/webhook-secret/rotate',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    await assertConnectionOwned(req.params.id, req.user!.organizationId!, req);
    const conn = await prisma.channelConnection.update({
      where: { id: req.params.id },
      data: { webhookSecret: generateSecret() },
      include: { channel: true, property: { select: { id: true, name: true, code: true } } },
    });
    res.json({ connection: await present(conn) });
  }),
);

channelsRouter.post(
  '/connections/:id/test',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    await assertConnectionOwned(req.params.id, req.user!.organizationId!, req);
    const { connector, ctx, driver } = await resolveConnection(req.params.id);
    try {
      const result = await connector.testConnection(ctx);
      await prisma.channelConnection.update({
        where: { id: req.params.id },
        data: {
          status: result.ok ? 'connected' : 'error',
          lastError: result.ok ? null : result.message,
        },
      });
      res.json({ driver, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.channelConnection.update({
        where: { id: req.params.id },
        data: { status: 'error', lastError: message },
      });
      res.json({ driver, result: { ok: false, message } });
    }
  }),
);

// ── Room mappings ──────────────────────────────────────────────────────────

const mappingInput = z.object({
  channelConnectionId: z.string(),
  roomTypeId: z.string(),
  ratePlanId: z.string().nullish(),
  externalRoomId: z.string().min(1),
  externalRatePlanId: z.string().default(''),
  active: z.boolean().default(true),
});

async function assertMappingInputOwned(
  body: { channelConnectionId: string; roomTypeId: string },
  organizationId: string,
  req: import('express').Request,
) {
  await assertConnectionOwned(body.channelConnectionId, organizationId, req);
  const room = await prisma.roomType.findUnique({
    where: { id: body.roomTypeId },
    include: { property: { select: { organizationId: true } } },
  });
  if (!room || room.property.organizationId !== organizationId) throw notFound('Room type not found');
  assertPropertyInScope(room.propertyId, req);
}

channelsRouter.post(
  '/mappings',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(mappingInput, req.body);
    await assertMappingInputOwned(body, req.user!.organizationId!, req);
    const mapping = await prisma.roomMapping.upsert({
      where: {
        channelConnectionId_externalRoomId_externalRatePlanId: {
          channelConnectionId: body.channelConnectionId,
          externalRoomId: body.externalRoomId,
          externalRatePlanId: body.externalRatePlanId,
        },
      },
      create: body,
      update: body,
      include: { roomType: true, ratePlan: true },
    });
    res.status(201).json({ mapping });
  }),
);

channelsRouter.patch(
  '/mappings/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.roomMapping.findUnique({
      where: { id: req.params.id },
      include: { channelConnection: { select: { organizationId: true, propertyId: true } } },
    });
    if (!existing || existing.channelConnection.organizationId !== organizationId) throw notFound('Mapping not found');
    assertPropertyInScope(existing.channelConnection.propertyId, req);
    const body = parse(mappingInput.partial().omit({ channelConnectionId: true }), req.body);
    const mapping = await prisma.roomMapping.update({
      where: { id: req.params.id },
      data: body,
      include: { roomType: true, ratePlan: true },
    });
    res.json({ mapping });
  }),
);

channelsRouter.delete(
  '/mappings/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.roomMapping.findUnique({
      where: { id: req.params.id },
      include: { channelConnection: { select: { organizationId: true, propertyId: true } } },
    });
    if (!existing || existing.channelConnection.organizationId !== organizationId) throw notFound('Mapping not found');
    assertPropertyInScope(existing.channelConnection.propertyId, req);
    await prisma.roomMapping.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

channelsRouter.get(
  '/mappings',
  asyncHandler(async (req, res) => {
    const connectionId = req.query.connectionId ? String(req.query.connectionId) : undefined;
    if (!connectionId) throw badRequest('connectionId is required');
    await assertConnectionOwned(connectionId, req.user!.organizationId!, req);
    const mappings = await prisma.roomMapping.findMany({
      where: { channelConnectionId: connectionId },
      include: { roomType: true, ratePlan: true },
    });
    res.json({ mappings });
  }),
);
