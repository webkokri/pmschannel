import { Router } from 'express';
import { z } from 'zod';
import { addDays, todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { requireOrg, assertOwned } from '../lib/tenant';
import { requireRole } from '../auth';
import { requirePermission } from '../lib/permissions';
import { applyPricingRules } from '../engine/pricing';

export const rmsRouter = Router();
rmsRouter.use(requireOrg);

rmsRouter.get(
  '/rules',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
    const rules = await prisma.pricingRule.findMany({
      where: { organizationId, propertyId },
      orderBy: { priority: 'asc' },
      include: { roomType: { select: { name: true } } },
    });
    res.json({ rules });
  }),
);

const ruleInput = z.object({
  propertyId: z.string(),
  roomTypeId: z.string().nullish(),
  name: z.string().min(1),
  type: z.enum(['occupancy_based', 'day_of_week', 'lead_time', 'length_of_stay']),
  conditions: z.record(z.any()),
  adjustPct: z.number(),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

rmsRouter.post(
  '/rules',
  requirePermission('rms.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(ruleInput, req.body);
    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property');
    const rule = await prisma.pricingRule.create({ data: { ...body, organizationId } });
    res.status(201).json({ rule });
  }),
);

rmsRouter.patch(
  '/rules/:id',
  requirePermission('rms.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.pricingRule.findUnique({ where: { id: req.params.id } }), organizationId, 'Pricing rule');
    const body = parse(ruleInput.partial().omit({ propertyId: true }), req.body);
    const rule = await prisma.pricingRule.update({ where: { id: req.params.id }, data: body });
    res.json({ rule });
  }),
);

rmsRouter.delete(
  '/rules/:id',
  requirePermission('rms.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.pricingRule.findUnique({ where: { id: req.params.id } }), organizationId, 'Pricing rule');
    await prisma.pricingRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

const applyInput = z.object({
  propertyId: z.string(),
  roomTypeId: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => todayIso()),
  days: z.number().int().min(1).max(365).default(90),
});

rmsRouter.post(
  '/apply',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(applyInput, req.body);
    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property');
    const result = await applyPricingRules(organizationId, body.propertyId, {
      roomTypeId: body.roomTypeId,
      from: body.from,
      to: addDays(body.from, body.days),
    });
    res.json(result);
  }),
);

rmsRouter.get(
  '/log',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const roomTypeId = req.query.roomTypeId ? String(req.query.roomTypeId) : undefined;
    const logs = await prisma.pricingLog.findMany({
      where: { organizationId, roomTypeId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ logs });
  }),
);
