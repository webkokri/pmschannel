import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { assertOwned, assertPropertyInScope, propertyScope, requireOrg, requirePortfolioStaff } from '../lib/tenant';

export const propertiesRouter = Router();
propertiesRouter.use(requireOrg);

const propertyInput = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  address: z.string().default(''),
  city: z.string().default(''),
  region: z.string().default(''),
  country: z.enum(['US', 'CA']).default('US'),
  timezone: z.string().default('America/New_York'),
  currency: z.string().default('USD'),
  active: z.boolean().default(true),
});

propertiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = propertyScope(req);
    const properties = await prisma.property.findMany({
      where: { organizationId: req.user!.organizationId!, ...(scope ? { id: scope } : {}) },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { roomTypes: true, channelConnections: true, bookings: true } },
      },
    });
    res.json({ properties });
  }),
);

propertiesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    assertPropertyInScope(req.params.id, req);
    const property = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: {
        roomTypes: {
          orderBy: { name: 'asc' },
          include: { ratePlans: true, _count: { select: { bookings: true } } },
        },
        channelConnections: { include: { channel: true } },
        seo: true,
      },
    });
    if (!property || property.organizationId !== req.user!.organizationId) throw notFound('Property not found');
    res.json({ property });
  }),
);

propertiesRouter.post(
  '/',
  requireRole('manager'),
  requirePortfolioStaff,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(propertyInput, req.body);
    const property = await prisma.property.create({ data: { ...body, organizationId } });
    // Every property gets a working, published booking page from the moment it's
    // created — no separate "publish" step to remember. Settings → SEO still lets staff
    // customize or unpublish it; this is just the default, not the only way to get there.
    await prisma.propertySeo.create({
      data: { propertyId: property.id, metaTitle: property.name, published: true },
    });
    res.status(201).json({ property });
  }),
);

propertiesRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.property.findUnique({ where: { id: req.params.id } }), organizationId, 'Property', req);
    const body = parse(propertyInput.partial(), req.body);
    const property = await prisma.property.update({ where: { id: req.params.id }, data: body });
    res.json({ property });
  }),
);

propertiesRouter.delete(
  '/:id',
  requireRole('admin'),
  requirePortfolioStaff,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.property.findUnique({ where: { id: req.params.id } }), organizationId, 'Property', req);
    await prisma.property.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Room types ─────────────────────────────────────────────────────────────

const roomTypeInput = z.object({
  propertyId: z.string(),
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  totalUnits: z.number().int().min(0).default(1),
  maxOccupancy: z.number().int().min(1).default(2),
  basePrice: z.number().min(0).default(0),
});

propertiesRouter.post(
  '/room-types',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(roomTypeInput, req.body);
    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property', req);
    const roomType = await prisma.roomType.create({ data: body });
    res.status(201).json({ roomType });
  }),
);

propertiesRouter.patch(
  '/room-types/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.roomType.findUnique({
      where: { id: req.params.id },
      include: { property: { select: { organizationId: true } } },
    });
    if (!existing || existing.property.organizationId !== organizationId) throw notFound('Room type not found');
    assertPropertyInScope(existing.propertyId, req);
    const body = parse(roomTypeInput.partial().omit({ propertyId: true }), req.body);
    const roomType = await prisma.roomType.update({ where: { id: req.params.id }, data: body });
    res.json({ roomType });
  }),
);

propertiesRouter.delete(
  '/room-types/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.roomType.findUnique({
      where: { id: req.params.id },
      include: { property: { select: { organizationId: true } } },
    });
    if (!existing || existing.property.organizationId !== organizationId) throw notFound('Room type not found');
    assertPropertyInScope(existing.propertyId, req);
    await prisma.roomType.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Rate plans ─────────────────────────────────────────────────────────────

const ratePlanInput = z.object({
  roomTypeId: z.string(),
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  mealPlan: z.string().default('room_only'),
  cancellationPolicy: z.string().default('flexible'),
  derivedFromId: z.string().nullish(),
  adjustPct: z.number().default(0),
  adjustFlat: z.number().default(0),
});

async function assertRoomTypeOwned(roomTypeId: string, organizationId: string, req: Request) {
  const room = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    include: { property: { select: { organizationId: true } } },
  });
  if (!room || room.property.organizationId !== organizationId) throw notFound('Room type not found');
  assertPropertyInScope(room.propertyId, req);
  return room;
}

propertiesRouter.post(
  '/rate-plans',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(ratePlanInput, req.body);
    await assertRoomTypeOwned(body.roomTypeId, req.user!.organizationId!, req);
    const ratePlan = await prisma.ratePlan.create({ data: body });
    res.status(201).json({ ratePlan });
  }),
);

propertiesRouter.patch(
  '/rate-plans/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.ratePlan.findUnique({
      where: { id: req.params.id },
      include: { roomType: { include: { property: { select: { organizationId: true } } } } },
    });
    if (!existing || existing.roomType.property.organizationId !== req.user!.organizationId) {
      throw notFound('Rate plan not found');
    }
    assertPropertyInScope(existing.roomType.propertyId, req);
    const body = parse(ratePlanInput.partial().omit({ roomTypeId: true }), req.body);
    const ratePlan = await prisma.ratePlan.update({ where: { id: req.params.id }, data: body });
    res.json({ ratePlan });
  }),
);

propertiesRouter.delete(
  '/rate-plans/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.ratePlan.findUnique({
      where: { id: req.params.id },
      include: { roomType: { include: { property: { select: { organizationId: true } } } } },
    });
    if (!existing || existing.roomType.property.organizationId !== req.user!.organizationId) {
      throw notFound('Rate plan not found');
    }
    assertPropertyInScope(existing.roomType.propertyId, req);
    await prisma.ratePlan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
