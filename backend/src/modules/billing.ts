import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, badRequest, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg } from '../lib/tenant';
import { getUsageSummary } from '../lib/limits';
import { createCheckoutSession, stripeConfigured } from '../lib/stripe';
import { audit } from '../lib/audit';
import { env } from '../env';
import type { PlanLimits } from '@cm/shared';

export const billingRouter = Router();
billingRouter.use(requireOrg);

billingRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const [organization, subscription, usage, supportManager] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } }),
      getUsageSummary(organizationId),
      prisma.organization
        .findUnique({ where: { id: organizationId }, select: { supportManager: { select: { id: true, name: true, email: true } } } })
        .then((o) => o?.supportManager ?? null),
    ]);
    const pendingPlan = subscription?.pendingPlanId
      ? await prisma.plan.findUnique({ where: { id: subscription.pendingPlanId } })
      : null;

    res.json({
      organization,
      subscription,
      pendingPlan,
      usage,
      supportManager,
      stripeConfigured,
    });
  }),
);

const changePlanInput = z.object({
  planCode: z.string(),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
});

/**
 * Self-serve plan change.
 *  - Downgrade (fits within the new plan's limits): applied immediately.
 *  - Upgrade, Stripe configured: returns a Checkout Session URL to complete payment.
 *  - Upgrade, Stripe not configured: recorded as `pendingPlanId` for the org's dedicated
 *    support manager / the super admin to action (comp, manual invoice, etc.).
 */
billingRouter.post(
  '/change-plan',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(changePlanInput, req.body);

    const [organization, subscription, targetPlan, usage] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } }),
      prisma.plan.findUnique({ where: { code: body.planCode } }),
      getUsageSummary(organizationId),
    ]);
    if (!subscription) throw badRequest('No subscription found');
    if (!targetPlan || !targetPlan.active) throw badRequest('Unknown plan');
    if (targetPlan.id === subscription.planId) throw badRequest('Already on this plan');

    const limits = targetPlan.limits as unknown as PlanLimits;
    const fitsNewLimits =
      usage.usage.properties <= limits.maxProperties &&
      usage.usage.channelConnections <= limits.maxChannelConnections &&
      usage.usage.users <= limits.maxUsers;

    const isDowngrade = targetPlan.priceMonthlyCents <= subscription.plan.priceMonthlyCents;

    if (isDowngrade) {
      if (!fitsNewLimits) {
        throw badRequest(
          `Your current usage exceeds the ${targetPlan.name} plan's limits. Remove some properties, ` +
            'channels or team members before downgrading.',
          { limits, usage: usage.usage },
        );
      }
      await prisma.subscription.update({
        where: { organizationId },
        data: { planId: targetPlan.id, billingCycle: body.billingCycle, pendingPlanId: null },
      });
      await audit({
        actorId: req.user!.id,
        organizationId,
        action: 'billing.plan_downgraded',
        entity: 'Subscription',
        entityId: subscription.id,
        before: { planCode: subscription.plan.code },
        after: { planCode: targetPlan.code },
      });
      return res.json({ applied: true, message: `Switched to the ${targetPlan.name} plan.` });
    }

    // Upgrade path.
    if (stripeConfigured) {
      const priceCents =
        body.billingCycle === 'yearly' ? targetPlan.priceYearlyCents : targetPlan.priceMonthlyCents;
      const result = await createCheckoutSession({
        organizationId,
        organizationName: organization.name,
        contactEmail: organization.contactEmail,
        planCode: targetPlan.code,
        priceCents,
        currency: targetPlan.currency,
        billingCycle: body.billingCycle,
        successUrl: `${env.publicAppUrl}/billing?checkout=success`,
        cancelUrl: `${env.publicAppUrl}/billing?checkout=cancelled`,
        existingStripeCustomerId: subscription.stripeCustomerId,
      });
      if (result.ok && result.url) {
        return res.json({ applied: false, checkoutUrl: result.url, message: result.message });
      }
      // fall through to the manual/pending path if Checkout couldn't be created
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: { pendingPlanId: targetPlan.id },
    });
    await audit({
      actorId: req.user!.id,
      organizationId,
      action: 'billing.upgrade_requested',
      entity: 'Subscription',
      entityId: subscription.id,
      before: { planCode: subscription.plan.code },
      after: { requestedPlanCode: targetPlan.code },
    });
    res.json({
      applied: false,
      message:
        `Upgrade to ${targetPlan.name} requested. Your dedicated support manager will follow up to complete billing.`,
    });
  }),
);
