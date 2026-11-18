import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, parse } from '../../lib/http';

/** Super-admin: platform-wide analytics, settings, audit log and OTA catalogue. */
export const adminPlatformRouter = Router();

function since(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}

adminPlatformRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [
      totalProperties,
      assignedPropertyCount,
      totalBookings30d,
      commissionRevenue30d,
      commissionRevenueAllTime,
      acceleratorActiveCount,
      bookingTrendRows,
    ] = await Promise.all([
      prisma.property.count(),
      prisma.property.count({ where: { assignedManagers: { some: {} } } }),
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
      prisma.booking.findMany({
        where: { receivedAt: { gte: since(24 * 30) } },
        select: { receivedAt: true },
      }),
    ]);

    const trendMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const b of bookingTrendRows) {
      const key = b.receivedAt.toISOString().slice(0, 10);
      if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
    }
    const bookingTrend = [...trendMap.entries()].map(([date, count]) => ({ date, count }));

    res.json({
      totalProperties,
      assignedPropertyCount,
      unassignedPropertyCount: totalProperties - assignedPropertyCount,
      totalBookings30d,
      bookingTrend,
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
