import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, badRequest, notFound, parse } from '../../lib/http';
import { signToken, type AuthUser } from '../../auth';
import { getUsageSummary } from '../../lib/limits';
import { assignSupportManager, reassignSupportManager } from '../../lib/support';
import { audit } from '../../lib/audit';
import { activateAccelerator } from '../../lib/accelerator';
import { getCommissionRateBps } from '../../lib/commission';

/** Super-admin: full control over every tenant organization. */
export const adminOrganizationsRouter = Router();

adminOrganizationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const search = q.search ? String(q.search) : undefined;
    const status = q.status ? String(q.status) : undefined;

    const organizations = await prisma.organization.findMany({
      where: {
        status: status as never,
        OR: search
          ? [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { contactEmail: { contains: search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: { include: { plan: true } },
        supportManager: { select: { id: true, name: true, email: true } },
        _count: { select: { properties: true, users: true, bookings: true } },
      },
    });
    res.json({ organizations });
  }),
);

adminOrganizationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        subscription: { include: { plan: true } },
        supportManager: { select: { id: true, name: true, email: true } },
        users: { select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } },
        properties: { select: { id: true, name: true, code: true, country: true, active: true } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 20 },
        accelerator: true,
      },
    });
    if (!organization) throw notFound('Organization not found');
    const [usage, effectiveCommissionBps, commissionRevenue] = await Promise.all([
      getUsageSummary(organization.id).catch(() => null),
      getCommissionRateBps(organization.id),
      prisma.payment.aggregate({
        where: { organizationId: organization.id, status: { in: ['captured', 'partially_refunded', 'refunded'] } },
        _sum: { commissionCents: true, amountCents: true },
      }),
    ]);
    res.json({
      organization,
      usage,
      effectiveCommissionBps,
      platformRevenue: {
        commissionCents: commissionRevenue._sum.commissionCents ?? 0,
        grossCents: commissionRevenue._sum.amountCents ?? 0,
      },
    });
  }),
);

const statusInput = z.object({
  status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'canceled']),
  suspendedReason: z.string().optional(),
});

adminOrganizationsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const before = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { status: true } });
    const body = parse(statusInput, req.body);
    const organization = await prisma.organization.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        suspendedAt: body.status === 'suspended' ? new Date() : null,
        suspendedReason: body.status === 'suspended' ? (body.suspendedReason ?? '') : '',
      },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.status_changed',
      entity: 'Organization',
      entityId: organization.id,
      before,
      after: { status: organization.status },
    });
    res.json({ organization });
  }),
);

const planInput = z.object({
  planCode: z.string(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'paused']).optional(),
  currentPeriodEnd: z.string().datetime().optional(),
});

/** Super-admin plan override — no payment involved (comp accounts, offline invoicing). */
adminOrganizationsRouter.patch(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    const body = parse(planInput, req.body);
    const plan = await prisma.plan.findUnique({ where: { code: body.planCode } });
    if (!plan) throw badRequest('Unknown plan code');
    const before = await prisma.subscription.findUnique({
      where: { organizationId: req.params.id },
      include: { plan: { select: { code: true } } },
    });

    const subscription = await prisma.subscription.upsert({
      where: { organizationId: req.params.id },
      create: {
        organizationId: req.params.id,
        planId: plan.id,
        status: body.status ?? 'active',
        currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : undefined,
      },
      update: {
        planId: plan.id,
        pendingPlanId: null,
        status: body.status ?? undefined,
        currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : undefined,
      },
      include: { plan: true },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: req.params.id,
      action: 'organization.plan_overridden',
      entity: 'Subscription',
      entityId: subscription.id,
      before: { planCode: before?.plan.code ?? null },
      after: { planCode: plan.code },
    });
    res.json({ subscription });
  }),
);

const commissionInput = z.object({ commissionRateBps: z.number().int().min(0).max(10_000).nullable() });

/** Super-admin per-org commission override (null clears it back to the platform default). */
adminOrganizationsRouter.patch(
  '/:id/commission',
  asyncHandler(async (req, res) => {
    const body = parse(commissionInput, req.body);
    const before = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { commissionRateBps: true } });
    const organization = await prisma.organization.update({
      where: { id: req.params.id },
      data: { commissionRateBps: body.commissionRateBps },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.commission_rate_overridden',
      entity: 'Organization',
      entityId: organization.id,
      before,
      after: { commissionRateBps: organization.commissionRateBps },
    });
    res.json({ organization });
  }),
);

/** Super-admin comp: activate the Accelerator for free (no Stripe charge). */
adminOrganizationsRouter.post(
  '/:id/accelerator/comp',
  asyncHandler(async (req, res) => {
    const result = await activateAccelerator(req.params.id);
    await audit({
      actorId: req.user!.id,
      organizationId: req.params.id,
      action: 'accelerator.comped',
      entity: 'Accelerator',
      entityId: req.params.id,
      after: result,
    });
    res.json(result);
  }),
);

adminOrganizationsRouter.post(
  '/:id/accelerator/deactivate',
  asyncHandler(async (req, res) => {
    const accelerator = await prisma.accelerator.update({
      where: { organizationId: req.params.id },
      data: { active: false, deactivatedAt: new Date() },
    });
    await prisma.channelConnection.updateMany({
      where: { organizationId: req.params.id, viaAccelerator: true },
      data: { enabled: false },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: req.params.id,
      action: 'accelerator.deactivated',
      entity: 'Accelerator',
      entityId: req.params.id,
    });
    res.json({ accelerator });
  }),
);

const reassignInput = z.object({ supportManagerId: z.string().nullable() });

adminOrganizationsRouter.patch(
  '/:id/support-manager',
  asyncHandler(async (req, res) => {
    const body = parse(reassignInput, req.body);
    await reassignSupportManager(req.params.id, body.supportManagerId);
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { supportManager: { select: { id: true, name: true, email: true } } },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.support_manager_reassigned',
      entity: 'Organization',
      entityId: organization.id,
      after: { supportManagerId: body.supportManagerId },
    });
    res.json({ organization });
  }),
);

/** Re-run auto-assignment (e.g. after a new support manager joins or one left). */
adminOrganizationsRouter.post(
  '/:id/support-manager/auto-assign',
  asyncHandler(async (req, res) => {
    const manager = await assignSupportManager(req.params.id);
    res.json({ supportManager: manager });
  }),
);

/**
 * Impersonate: issue a short-lived token scoped to this organization, signed in as its
 * first active admin, for support purposes. The token is flagged `impersonated`.
 */
adminOrganizationsRouter.post(
  '/:id/impersonate',
  asyncHandler(async (req, res) => {
    const orgAdmin = await prisma.user.findFirst({
      where: { organizationId: req.params.id, role: 'admin', active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!orgAdmin) throw notFound('This organization has no active admin user to impersonate');

    const authUser: AuthUser = {
      id: orgAdmin.id,
      email: orgAdmin.email,
      name: orgAdmin.name,
      role: orgAdmin.role,
      organizationId: orgAdmin.organizationId,
      isSuperAdmin: false,
      permissions: orgAdmin.permissions,
      impersonated: true,
    };
    await audit({
      actorId: req.user!.id,
      organizationId: req.params.id,
      action: 'organization.impersonated',
      entity: 'User',
      entityId: orgAdmin.id,
    });
    res.json({ token: signToken(authUser, { expiresIn: '30m' }), user: authUser });
  }),
);

adminOrganizationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { name: true } });
    await prisma.organization.delete({ where: { id: req.params.id } });
    await audit({
      actorId: req.user!.id,
      action: 'organization.deleted',
      entity: 'Organization',
      entityId: req.params.id,
      before: organization,
    });
    res.status(204).end();
  }),
);
