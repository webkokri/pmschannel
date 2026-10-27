import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, parse } from '../../lib/http';

/** Super-admin: manage the subscription package catalogue. */
export const adminPlansRouter = Router();

adminPlansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { subscriptions: true } } },
    });
    res.json({ plans });
  }),
);

const limitsInput = z.object({
  maxProperties: z.number().int().min(0),
  maxRoomTypesPerProperty: z.number().int().min(0),
  maxChannelConnections: z.number().int().min(0),
  maxUsers: z.number().int().min(0),
  channelCategories: z.array(z.enum(['global', 'north_america', 'direct_misc', 'pms'])),
});

const planInput = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(1),
  description: z.string().default(''),
  priceMonthlyCents: z.number().int().min(0),
  priceYearlyCents: z.number().int().min(0),
  currency: z.string().default('USD'),
  limits: limitsInput,
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

adminPlansRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(planInput, req.body);
    const plan = await prisma.plan.create({ data: body });
    res.status(201).json({ plan });
  }),
);

adminPlansRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parse(planInput.partial(), req.body);
    const plan = await prisma.plan.update({ where: { id: req.params.id }, data: body });
    res.json({ plan });
  }),
);

adminPlansRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const inUse = await prisma.subscription.count({ where: { planId: req.params.id } });
    if (inUse > 0) {
      // Soft-delete instead of breaking existing subscriptions.
      const plan = await prisma.plan.update({ where: { id: req.params.id }, data: { active: false, isPublic: false } });
      return res.json({ plan, softDeleted: true });
    }
    await prisma.plan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
