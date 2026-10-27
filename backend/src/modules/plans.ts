import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';

/** Public plan catalogue — used by the signup page and the billing tab. No auth required. */
export const plansRouter = Router();

plansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      where: { isPublic: true, active: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ plans });
  }),
);
