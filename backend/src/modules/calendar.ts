import { Router } from 'express';
import { z } from 'zod';
import { addDays, nightsBetween, todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg, assertOwned } from '../lib/tenant';
import { enqueueAriForEdit } from '../engine/ari';

export const calendarRouter = Router();
calendarRouter.use(requireOrg);

/**
 * ARI grid for a property: one row per room type, one cell per date.
 *   GET /api/calendar?propertyId=...&from=YYYY-MM-DD&days=30
 */
calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const propertyId = String(req.query.propertyId ?? '');
    if (!propertyId) throw badRequest('propertyId is required');
    await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), req.user!.organizationId!, 'Property');
    const from = String(req.query.from ?? todayIso());
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    const to = addDays(from, days);
    const dates = nightsBetween(from, to);
    const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));

    const rooms = await prisma.roomType.findMany({
      where: { propertyId },
      orderBy: { name: 'asc' },
      include: {
        calendarDays: { where: { date: { in: dateObjs } } },
      },
    });

    // Pending pushes per room, so cells can show a "syncing" badge.
    const pendingJobs = await prisma.syncJob.findMany({
      where: {
        status: { in: ['pending', 'running', 'failed'] },
        channelConnection: { propertyId },
      },
      select: { entityType: true, payload: true, status: true },
    });

    const grid = rooms.map((room) => {
      const byDate = new Map(room.calendarDays.map((d) => [d.date.toISOString().slice(0, 10), d]));
      const pendingForRoom = pendingJobs.filter(
        (j) => (j.payload as { roomTypeId?: string })?.roomTypeId === room.id,
      );
      return {
        roomTypeId: room.id,
        name: room.name,
        code: room.code,
        totalUnits: room.totalUnits,
        basePrice: Number(room.basePrice),
        pendingSync: pendingForRoom.map((j) => j.entityType),
        cells: dates.map((date) => {
          const d = byDate.get(date);
          return {
            date,
            price: d ? Number(d.price) : Number(room.basePrice),
            availableUnits: d ? d.availableUnits : room.totalUnits,
            minStay: d?.minStay ?? 1,
            maxStay: d?.maxStay ?? 0,
            closedToArrival: d?.closedToArrival ?? false,
            closedToDeparture: d?.closedToDeparture ?? false,
            stopSell: d?.stopSell ?? false,
            exists: Boolean(d),
          };
        }),
      };
    });

    res.json({ from, to, days, dates, rooms: grid });
  }),
);

const bulkUpdate = z.object({
  roomTypeId: z.string(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // any subset of fields to apply to every day in the range
  price: z.number().min(0).optional(),
  availableUnits: z.number().int().min(0).optional(),
  minStay: z.number().int().min(1).optional(),
  maxStay: z.number().int().min(0).optional(),
  closedToArrival: z.boolean().optional(),
  closedToDeparture: z.boolean().optional(),
  stopSell: z.boolean().optional(),
  // limit the pushes to specific weekdays (0=Sun..6=Sat); default all
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

calendarRouter.patch(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(bulkUpdate, req.body);
    if (body.to <= body.from) throw badRequest('`to` must be after `from`');

    const room = await prisma.roomType.findUnique({
      where: { id: body.roomTypeId },
      include: { property: { select: { organizationId: true } } },
    });
    if (!room || room.property.organizationId !== req.user!.organizationId) throw notFound('Room type not found');

    const allDates = nightsBetween(body.from, body.to);
    const dates = body.weekdays
      ? allDates.filter((d) => body.weekdays!.includes(new Date(d + 'T00:00:00Z').getUTCDay()))
      : allDates;

    const fields: Record<string, unknown> = {};
    for (const k of ['price', 'availableUnits', 'minStay', 'maxStay', 'closedToArrival', 'closedToDeparture', 'stopSell'] as const) {
      if (body[k] !== undefined) fields[k] = body[k];
    }
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    for (const date of dates) {
      await prisma.calendarDay.upsert({
        where: { roomTypeId_date: { roomTypeId: body.roomTypeId, date: new Date(date + 'T00:00:00Z') } },
        create: {
          roomTypeId: body.roomTypeId,
          date: new Date(date + 'T00:00:00Z'),
          price: (fields.price as number) ?? Number(room.basePrice),
          availableUnits: (fields.availableUnits as number) ?? room.totalUnits,
          minStay: (fields.minStay as number) ?? 1,
          maxStay: (fields.maxStay as number) ?? 0,
          closedToArrival: (fields.closedToArrival as boolean) ?? false,
          closedToDeparture: (fields.closedToDeparture as boolean) ?? false,
          stopSell: (fields.stopSell as boolean) ?? false,
        },
        update: fields,
      });
    }

    const entityTypes: Array<'availability' | 'rates' | 'restrictions'> = [];
    if (fields.price !== undefined) entityTypes.push('rates');
    if (fields.availableUnits !== undefined || fields.stopSell !== undefined) entityTypes.push('availability');
    if (
      fields.minStay !== undefined ||
      fields.maxStay !== undefined ||
      fields.closedToArrival !== undefined ||
      fields.closedToDeparture !== undefined
    ) {
      entityTypes.push('restrictions');
    }

    const queued = entityTypes.length ? await enqueueAriForEdit(body.roomTypeId, dates, entityTypes) : 0;
    res.json({ updatedDays: dates.length, entityTypes, jobsQueued: queued });
  }),
);
