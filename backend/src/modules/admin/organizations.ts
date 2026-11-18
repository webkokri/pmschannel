import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, notFound, parse } from '../../lib/http';
import { signToken, type AuthUser } from '../../auth';
import { audit } from '../../lib/audit';
import { activateAccelerator } from '../../lib/accelerator';
import { getCommissionRateBps } from '../../lib/commission';
import { getOrCreatePortfolioOrg } from '../../lib/portfolio';

/** Super-admin: the single portfolio's own settings (commission, accelerator, profile). */
export const adminOrganizationsRouter = Router();

adminOrganizationsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const [propertyCount, userCount, bookingCount, effectiveCommissionBps, commissionRevenue, accelerator] =
      await Promise.all([
        prisma.property.count({ where: { organizationId: organization.id } }),
        prisma.user.count({ where: { organizationId: organization.id } }),
        prisma.booking.count({ where: { organizationId: organization.id } }),
        getCommissionRateBps(organization.id),
        prisma.payment.aggregate({
          where: { organizationId: organization.id, status: { in: ['captured', 'partially_refunded', 'refunded'] } },
          _sum: { commissionCents: true, amountCents: true },
        }),
        prisma.accelerator.findUnique({ where: { organizationId: organization.id } }),
      ]);
    res.json({
      organization,
      usage: { properties: propertyCount, users: userCount, bookings: bookingCount },
      effectiveCommissionBps,
      platformRevenue: {
        commissionCents: commissionRevenue._sum.commissionCents ?? 0,
        grossCents: commissionRevenue._sum.amountCents ?? 0,
      },
      accelerator,
    });
  }),
);

const activeInput = z.object({ active: z.boolean() });

/** Portfolio-wide on/off switch (e.g. maintenance mode). */
adminOrganizationsRouter.patch(
  '/active',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const body = parse(activeInput, req.body);
    const updated = await prisma.organization.update({ where: { id: organization.id }, data: { active: body.active } });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.active_changed',
      entity: 'Organization',
      entityId: organization.id,
      before: { active: organization.active },
      after: { active: updated.active },
    });
    res.json({ organization: updated });
  }),
);

const commissionInput = z.object({ commissionRateBps: z.number().int().min(0).max(10_000).nullable() });

/** Admin-settable commission on every booking payment — 0% to 100%, in-house. */
adminOrganizationsRouter.patch(
  '/commission',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const body = parse(commissionInput, req.body);
    const updated = await prisma.organization.update({
      where: { id: organization.id },
      data: { commissionRateBps: body.commissionRateBps },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.commission_rate_changed',
      entity: 'Organization',
      entityId: organization.id,
      before: { commissionRateBps: organization.commissionRateBps },
      after: { commissionRateBps: updated.commissionRateBps },
    });
    res.json({ organization: updated });
  }),
);

/** Activate the Accelerator for the whole portfolio — free, admin-triggered. */
adminOrganizationsRouter.post(
  '/accelerator/comp',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const result = await activateAccelerator(organization.id);
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'accelerator.activated',
      entity: 'Accelerator',
      entityId: organization.id,
      after: result,
    });
    res.json(result);
  }),
);

adminOrganizationsRouter.post(
  '/accelerator/deactivate',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const accelerator = await prisma.accelerator.update({
      where: { organizationId: organization.id },
      data: { active: false, deactivatedAt: new Date() },
    });
    await prisma.channelConnection.updateMany({
      where: { organizationId: organization.id, viaAccelerator: true },
      data: { enabled: false },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'accelerator.deactivated',
      entity: 'Accelerator',
      entityId: organization.id,
    });
    res.json({ accelerator });
  }),
);

/**
 * Impersonate: issue a short-lived token signed in as the portfolio's first active
 * portfolio-wide admin, for support purposes. The token is flagged `impersonated`. To
 * impersonate a specific property's manager, use POST /api/admin/properties/:id/impersonate.
 */
adminOrganizationsRouter.post(
  '/impersonate',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const admin = await prisma.user.findFirst({
      where: { organizationId: organization.id, role: 'admin', assignedPropertyId: null, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw notFound('No active portfolio-wide admin user to impersonate');

    const authUser: AuthUser = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      organizationId: admin.organizationId,
      isSuperAdmin: false,
      assignedPropertyId: null,
      permissions: admin.permissions,
      impersonated: true,
    };
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'organization.impersonated',
      entity: 'User',
      entityId: admin.id,
    });
    res.json({ token: signToken(authUser, { expiresIn: '30m' }), user: authUser });
  }),
);
