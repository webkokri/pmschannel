import { Router } from 'express';
import { z } from 'zod';
import { OTA_CATEGORIES } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { decryptJson, encryptJson, redactCredentials } from '../lib/crypto';
import { resolveConnection } from '../connectors/registry';
import { env } from '../env';

export const channelsRouter = Router();

// ── Channel catalogue ──────────────────────────────────────────────────────

channelsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const channels = await prisma.channel.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { connections: true } },
        connections: { select: { id: true, enabled: true, status: true, propertyId: true } },
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

function present(conn: {
  id: string;
  credentials: string;
  [k: string]: unknown;
}) {
  const creds = decryptJson<Record<string, unknown>>(conn.credentials) ?? {};
  return {
    ...conn,
    credentials: redactCredentials(creds),
    driver: creds.driver === 'real' ? 'real' : 'mock',
    webhookUrl: `${env.publicApiUrl}/api/webhooks/${(conn as { channel?: { code: string } }).channel?.code ?? ''}`,
  };
}

channelsRouter.get(
  '/connections',
  asyncHandler(async (req, res) => {
    const where = req.query.propertyId ? { propertyId: String(req.query.propertyId) } : {};
    const connections = await prisma.channelConnection.findMany({
      where,
      include: {
        channel: true,
        property: { select: { id: true, name: true, code: true } },
        _count: { select: { roomMappings: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ connections: connections.map(present) });
  }),
);

channelsRouter.get(
  '/connections/:id',
  asyncHandler(async (req, res) => {
    const conn = await prisma.channelConnection.findUnique({
      where: { id: req.params.id },
      include: {
        channel: true,
        property: { select: { id: true, name: true, code: true } },
        roomMappings: { include: { roomType: true, ratePlan: true } },
      },
    });
    if (!conn) throw notFound('Connection not found');
    res.json({ connection: present(conn) });
  }),
);

channelsRouter.post(
  '/connections',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(connectionInput, req.body);
    const { credentials, ...rest } = body;
    const conn = await prisma.channelConnection.upsert({
      where: { propertyId_channelId: { propertyId: body.propertyId, channelId: body.channelId } },
      create: {
        ...rest,
        credentials: credentials ? encryptJson(credentials) : '',
      },
      update: {
        ...rest,
        ...(credentials ? { credentials: encryptJson(credentials) } : {}),
      },
      include: { channel: true, property: { select: { id: true, name: true, code: true } } },
    });
    res.status(201).json({ connection: present(conn) });
  }),
);

channelsRouter.patch(
  '/connections/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(connectionInput.partial().omit({ propertyId: true, channelId: true }), req.body);
    const { credentials, ...rest } = body;

    // Merge credential patches onto the existing blob so partial updates keep secrets.
    let credentialsBlob: string | undefined;
    if (credentials) {
      const existing = await prisma.channelConnection.findUniqueOrThrow({ where: { id: req.params.id } });
      const current = decryptJson<Record<string, unknown>>(existing.credentials) ?? {};
      credentialsBlob = encryptJson({ ...current, ...credentials });
    }

    const conn = await prisma.channelConnection.update({
      where: { id: req.params.id },
      data: { ...rest, ...(credentialsBlob ? { credentials: credentialsBlob } : {}) },
      include: { channel: true, property: { select: { id: true, name: true, code: true } } },
    });
    res.json({ connection: present(conn) });
  }),
);

channelsRouter.delete(
  '/connections/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await prisma.channelConnection.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

channelsRouter.post(
  '/connections/:id/test',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
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

channelsRouter.post(
  '/mappings',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(mappingInput, req.body);
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
    await prisma.roomMapping.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

channelsRouter.get(
  '/mappings',
  asyncHandler(async (req, res) => {
    const connectionId = req.query.connectionId ? String(req.query.connectionId) : undefined;
    if (!connectionId) throw badRequest('connectionId is required');
    const mappings = await prisma.roomMapping.findMany({
      where: { channelConnectionId: connectionId },
      include: { roomType: true, ratePlan: true },
    });
    res.json({ mappings });
  }),
);
