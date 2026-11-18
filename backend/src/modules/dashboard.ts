import { Router } from 'express';
import { addDays, nightsBetween, todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { requireOrg, resolvePropertyFilter } from '../lib/tenant';
import { decryptJson } from '../lib/crypto';

export const dashboardRouter = Router();
dashboardRouter.use(requireOrg);

function since(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const propFilter = { organizationId, ...(propertyId ? { propertyId } : {}) };

    const [
      bookings24h,
      bookings7d,
      openConflicts,
      pendingJobs,
      deadJobs,
      channels,
      connectionRows,
      properties,
    ] = await Promise.all([
      prisma.booking.count({ where: { ...propFilter, receivedAt: { gte: since(24) }, status: { not: 'rejected' } } }),
      prisma.booking.count({ where: { ...propFilter, receivedAt: { gte: since(24 * 7) }, status: { not: 'rejected' } } }),
      prisma.conflictAlert.count({
        where: { organizationId, status: 'open', ...(propertyId ? { roomType: { propertyId } } : {}) },
      }),
      prisma.syncJob.count({ where: { organizationId, status: { in: ['pending', 'failed'] } } }),
      prisma.syncJob.count({ where: { organizationId, status: 'dead' } }),
      prisma.channel.count({ where: { active: true } }),
      prisma.channelConnection.findMany({ where: { ...propFilter, enabled: true }, select: { credentials: true } }),
      prisma.property.count({ where: propFilter.propertyId ? { id: propFilter.propertyId } : { organizationId } }),
    ]);
    const connections = connectionRows.length;
    // How many of those connections are actually talking to the real OTA/PMS vs
    // the simulated driver — surfaced prominently so "connected" is never read as
    // "protected" when nothing live is actually wired up yet.
    const liveChannels = connectionRows.filter(
      (c) => decryptJson<Record<string, unknown>>(c.credentials)?.driver === 'real',
    ).length;

    // Revenue + ADR over the last 7 days (by receivedAt).
    const recentBookings = await prisma.booking.findMany({
      where: { ...propFilter, receivedAt: { gte: since(24 * 7) }, status: { in: ['confirmed', 'modified'] } },
      select: { amount: true, checkIn: true, checkOut: true },
    });
    const revenue7d = recentBookings.reduce((s, b) => s + Number(b.amount), 0);
    const roomNights = recentBookings.reduce(
      (s, b) => s + nightsBetween(b.checkIn.toISOString().slice(0, 10), b.checkOut.toISOString().slice(0, 10)).length,
      0,
    );
    const adr = roomNights > 0 ? revenue7d / roomNights : 0;

    // Occupancy for the next 30 days.
    const from = todayIso();
    const to = addDays(from, 30);
    const dateObjs = nightsBetween(from, to).map((d) => new Date(d + 'T00:00:00Z'));
    const rooms = await prisma.roomType.findMany({
      where: { property: propertyId ? { id: propertyId, organizationId } : { organizationId } },
      select: { id: true, totalUnits: true },
    });
    const capacity = rooms.reduce((s, r) => s + r.totalUnits, 0) * dateObjs.length;
    const soldAgg = await prisma.bookingNight.aggregate({
      where: {
        date: { in: dateObjs },
        booking: { ...propFilter, status: { in: ['confirmed', 'modified'] } },
      },
      _sum: { units: true },
    });
    const sold = soldAgg._sum.units ?? 0;
    const occupancy = capacity > 0 ? sold / capacity : 0;

    // 30-day booking trend.
    const trendRows = await prisma.booking.findMany({
      where: { ...propFilter, receivedAt: { gte: since(24 * 30) } },
      select: { receivedAt: true, status: true, amount: true },
    });
    const trendMap = new Map<string, { bookings: number; revenue: number }>();
    for (let i = 29; i >= 0; i--) {
      trendMap.set(addDays(todayIso(), -i), { bookings: 0, revenue: 0 });
    }
    for (const b of trendRows) {
      const key = b.receivedAt.toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      if (bucket && b.status !== 'rejected') {
        bucket.bookings += 1;
        bucket.revenue += Number(b.amount);
      }
    }
    const trend = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));

    // Channel mix (last 30 days).
    const mixRows = await prisma.booking.groupBy({
      by: ['sourceChannelId'],
      where: { ...propFilter, receivedAt: { gte: since(24 * 30) }, status: { not: 'rejected' } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const channelNames = Object.fromEntries(
      (await prisma.channel.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]),
    );
    const channelMix = mixRows
      .map((r) => ({
        channel: channelNames[r.sourceChannelId] ?? 'Unknown',
        bookings: r._count._all,
        revenue: Number(r._sum.amount ?? 0),
      }))
      .sort((a, b) => b.bookings - a.bookings);

    const recent = await prisma.booking.findMany({
      where: propFilter,
      orderBy: { receivedAt: 'desc' },
      take: 8,
      include: {
        sourceChannel: { select: { name: true } },
        property: { select: { name: true } },
        roomType: { select: { name: true } },
      },
    });

    const conflictFeed = await prisma.conflictAlert.findMany({
      where: { organizationId, status: 'open', ...(propertyId ? { roomType: { propertyId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { roomType: { select: { name: true } } },
    });

    res.json({
      kpis: {
        bookings24h,
        bookings7d,
        revenue7d,
        adr,
        occupancy,
        openConflicts,
        pendingJobs,
        deadJobs,
        activeChannels: channels,
        connectedChannels: connections,
        liveChannels,
        properties,
      },
      trend,
      channelMix,
      recentBookings: recent,
      conflicts: conflictFeed,
    });
  }),
);
