import { Router } from 'express';
import { requireOrg } from '../lib/tenant';
import { requireRole } from '../auth';
import { asyncHandler } from '../lib/http';
import { connectConfigured, refreshConnectStatus, startConnectOnboarding } from '../lib/connect';
import { prisma } from '../db';

/** Stripe Connect payout account — org-scoped. */
export const connectRouter = Router();
connectRouter.use(requireOrg);

connectRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const status = await refreshConnectStatus(organizationId);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { stripeConnectAccountId: true } });
    res.json({ configured: connectConfigured, status, hasAccount: Boolean(org.stripeConnectAccountId) });
  }),
);

connectRouter.post(
  '/onboard',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await startConnectOnboarding(req.user!.organizationId!);
    res.json(result);
  }),
);
