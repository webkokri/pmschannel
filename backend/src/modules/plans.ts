import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { getPlatformSetting } from '../lib/platform-settings';

/** Public plan catalogue — used by the signup page, the login page (to decide whether to
 *  show the "create account" link), and the billing tab. No auth required. */
export const plansRouter = Router();

plansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [plans, signupEnabled] = await Promise.all([
      prisma.plan.findMany({ where: { isPublic: true, active: true }, orderBy: { sortOrder: 'asc' } }),
      getPlatformSetting<boolean>('signupEnabled'),
    ]);
    res.json({ plans, signupEnabled: signupEnabled !== false });
  }),
);
