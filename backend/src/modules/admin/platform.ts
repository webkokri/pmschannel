import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, badRequest, parse } from '../../lib/http';

/** Super-admin: platform-wide analytics, settings, staff, audit log and OTA catalogue. */
export const adminPlatformRouter = Router();

function since(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}

adminPlatformRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [
      totalOrgs,
      byStatus,
      subscriptions,
      signups30d,
      pastDue,
      pendingUpgrades,
      totalProperties,
      totalBookings30d,
      commissionRevenue30d,
      commissionRevenueAllTime,
      acceleratorActiveCount,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.subscription.findMany({ include: { plan: true, organization: { select: { name: true } } } }),
      prisma.organization.count({ where: { createdAt: { gte: since(24 * 30) } } }),
      prisma.organization.findMany({
        where: { status: 'past_due' },
        select: { id: true, name: true, contactEmail: true },
        take: 20,
      }),
      prisma.subscription.findMany({
        where: { pendingPlanId: { not: null } },
        include: { organization: { select: { id: true, name: true } } },
      }),
      prisma.property.count(),
      prisma.booking.count({ where: { receivedAt: { gte: since(24 * 30) } } }),
      prisma.payment.aggregate({
        where: { status: { in: ['captured', 'partially_refunded', 'refunded'] }, createdAt: { gte: since(24 * 30) } },
        _sum: { commissionCents: true },
      }),
      prisma.payment.aggregate({
        where: { status: { in: ['captured', 'partially_refunded', 'refunded'] } },
        _sum: { commissionCents: true },
      }),
      prisma.accelerator.count({ where: { active: true } }),
    ]);

    // Rough MRR: monthly-equivalent price of every active/trialing subscription.
    const mrrCents = subscriptions
      .filter((s) => s.status === 'active' || s.status === 'trialing')
      .reduce((sum, s) => {
        const monthly = s.billingCycle === 'yearly' ? s.plan.priceYearlyCents / 12 : s.plan.priceMonthlyCents;
        return sum + monthly;
      }, 0);

    const planBreakdown = Object.entries(
      subscriptions.reduce<Record<string, number>>((acc, s) => {
        acc[s.plan.name] = (acc[s.plan.name] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([plan, count]) => ({ plan, count }));

    // Signup trend, last 30 days.
    const orgs = await prisma.organization.findMany({
      where: { createdAt: { gte: since(24 * 30) } },
      select: { createdAt: true },
    });
    const trendMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const o of orgs) {
      const key = o.createdAt.toISOString().slice(0, 10);
      if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
    }
    const signupTrend = [...trendMap.entries()].map(([date, count]) => ({ date, count }));

    res.json({
      totalOrgs,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      mrrCents,
      planBreakdown,
      signups30d,
      signupTrend,
      pastDue,
      pendingUpgrades: await Promise.all(
        pendingUpgrades.map(async (s) => ({
          organization: s.organization,
          requestedPlan: (await prisma.plan.findUnique({ where: { id: s.pendingPlanId! } }))?.name ?? 'Unknown plan',
        })),
      ),
      totalProperties,
      totalBookings30d,
      commissionRevenue30dCents: commissionRevenue30d._sum.commissionCents ?? 0,
      commissionRevenueAllTimeCents: commissionRevenueAllTime._sum.commissionCents ?? 0,
      acceleratorActiveCount,
    });
  }),
);

// ── Platform settings ───────────────────────────────────────────────────────

adminPlatformRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.platformSetting.findMany();
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }),
);

adminPlatformRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const patch = parse(z.record(z.any()), req.body);
    await Promise.all(
      Object.entries(patch).map(([key, value]) =>
        prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
      ),
    );
    const rows = await prisma.platformSetting.findMany();
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }),
);

// ── Platform-wide audit log ─────────────────────────────────────────────────

adminPlatformRouter.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const take = Math.min(200, Number(req.query.take ?? 100));
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
    });
    res.json({ logs });
  }),
);

// ── OTA catalogue (platform-global) ─────────────────────────────────────────

adminPlatformRouter.get(
  '/channels',
  asyncHandler(async (_req, res) => {
    const channels = await prisma.channel.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { connections: true } } },
    });
    res.json({ channels });
  }),
);

const channelPatch = z.object({
  active: z.boolean().optional(),
  name: z.string().optional(),
  docsUrl: z.string().optional(),
  notes: z.string().optional(),
});

adminPlatformRouter.patch(
  '/channels/:id',
  asyncHandler(async (req, res) => {
    const body = parse(channelPatch, req.body);
    const channel = await prisma.channel.update({ where: { id: req.params.id }, data: body });
    res.json({ channel });
  }),
);

// ── Support manager staff pool ──────────────────────────────────────────────

adminPlatformRouter.get(
  '/support-managers',
  asyncHandler(async (_req, res) => {
    const staff = await prisma.user.findMany({
      where: { isSupportManager: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, active: true, createdAt: true },
    });
    const loads = await prisma.organization.groupBy({
      by: ['supportManagerId'],
      where: { supportManagerId: { not: null } },
      _count: { _all: true },
    });
    const loadById = new Map(loads.map((l) => [l.supportManagerId, l._count._all]));
    res.json({ staff: staff.map((s) => ({ ...s, assignedOrgs: loadById.get(s.id) ?? 0 })) });
  }),
);

const staffInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

adminPlatformRouter.post(
  '/support-managers',
  asyncHandler(async (req, res) => {
    const body = parse(staffInput, req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw badRequest('An account with that email already exists');
    const staff = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 10),
        isSupportManager: true,
        organizationId: null,
        role: 'viewer',
      },
      select: { id: true, name: true, email: true, active: true },
    });
    res.status(201).json({ staff });
  }),
);

adminPlatformRouter.patch(
  '/support-managers/:id',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ active: z.boolean().optional(), name: z.string().optional() }), req.body);
    const staff = await prisma.user.update({
      where: { id: req.params.id },
      data: body,
      select: { id: true, name: true, email: true, active: true },
    });
    res.json({ staff });
  }),
);
