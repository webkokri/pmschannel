import { Router } from 'express';
import { nightsBetween, todayIso, addDays } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest } from '../lib/http';
import { requireOrg, resolvePropertyFilter } from '../lib/tenant';

export const reportsRouter = Router();
reportsRouter.use(requireOrg);

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

function respond(req: import('express').Request, res: import('express').Response, filename: string, rows: Record<string, unknown>[]) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows));
  }
  res.json({ rows });
}

function dateRange(req: import('express').Request): { from: string; to: string } {
  const from = req.query.from ? String(req.query.from) : addDays(todayIso(), -30);
  const to = req.query.to ? String(req.query.to) : todayIso();
  if (to < from) throw badRequest('`to` must not be before `from`');
  return { from, to };
}

/** Per room type: nights sold vs. available, occupancy %, over the date range. */
reportsRouter.get(
  '/occupancy',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const { from, to } = dateRange(req);
    const dates = nightsBetween(from, addDays(to, 1));
    const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));

    const rooms = await prisma.roomType.findMany({
      where: { property: { organizationId, id: propertyId } },
      select: { id: true, name: true, totalUnits: true, property: { select: { name: true } } },
    });

    const rows = [];
    for (const room of rooms) {
      const agg = await prisma.bookingNight.aggregate({
        where: { date: { in: dateObjs }, booking: { roomTypeId: room.id, status: { in: ['confirmed', 'modified'] } } },
        _sum: { units: true },
      });
      const soldNights = agg._sum.units ?? 0;
      const availableNights = room.totalUnits * dates.length;
      rows.push({
        property: room.property.name,
        roomType: room.name,
        soldNights,
        availableNights,
        occupancyPct: availableNights > 0 ? Math.round((soldNights / availableNights) * 1000) / 10 : 0,
      });
    }
    respond(req, res, 'occupancy-report', rows);
  }),
);

/** Revenue by channel and by room type over the date range (by receivedAt). */
reportsRouter.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const { from, to } = dateRange(req);

    const bookings = await prisma.booking.findMany({
      where: {
        organizationId,
        propertyId,
        status: { not: 'rejected' },
        receivedAt: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') },
      },
      select: {
        amount: true,
        status: true,
        sourceChannel: { select: { name: true } },
        roomType: { select: { name: true } },
      },
    });

    const byChannel = new Map<string, { source: string; bookings: number; revenue: number }>();
    for (const b of bookings) {
      if (b.status === 'cancelled') continue;
      const key = b.sourceChannel.name;
      const bucket = byChannel.get(key) ?? { source: key, bookings: 0, revenue: 0 };
      bucket.bookings++;
      bucket.revenue += Number(b.amount);
      byChannel.set(key, bucket);
    }
    respond(req, res, 'revenue-report', [...byChannel.values()].sort((a, b) => b.revenue - a.revenue));
  }),
);

/** Booking source / status mix — how many bookings, from where, in what state. */
reportsRouter.get(
  '/booking-source',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const { from, to } = dateRange(req);

    const groups = await prisma.booking.groupBy({
      by: ['sourceChannelId', 'status'],
      where: {
        organizationId,
        propertyId,
        receivedAt: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') },
      },
      _count: { _all: true },
    });
    const channels = Object.fromEntries((await prisma.channel.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const rows = groups.map((g) => ({ channel: channels[g.sourceChannelId] ?? 'Unknown', status: g.status, count: g._count._all }));
    respond(req, res, 'booking-source-report', rows);
  }),
);
