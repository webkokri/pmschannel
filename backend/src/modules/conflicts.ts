import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { sweepConflicts } from '../engine/conflict';

export const conflictsRouter = Router();

conflictsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const conflicts = await prisma.conflictAlert.findMany({
      where: {
        status: status as never,
        type: type ?? undefined,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { roomType: { select: { name: true, property: { select: { name: true } } } } },
      take: 200,
    });

    const bookingIds = [...new Set(conflicts.flatMap((c) => c.bookingIds))];
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: {
        id: true,
        externalRef: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        status: true,
        sourceChannel: { select: { name: true } },
      },
    });
    const bookingMap = Object.fromEntries(bookings.map((b) => [b.id, b]));

    res.json({
      conflicts: conflicts.map((c) => ({
        ...c,
        bookings: c.bookingIds.map((id) => bookingMap[id]).filter(Boolean),
      })),
    });
  }),
);

const resolveInput = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
  resolutionNote: z.string().optional(),
});

conflictsRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(resolveInput, req.body);
    const conflict = await prisma.conflictAlert.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        resolutionNote: body.resolutionNote ?? undefined,
        resolvedAt: body.status === 'resolved' ? new Date() : null,
      },
    });
    if (!conflict) throw notFound('Conflict not found');
    res.json({ conflict });
  }),
);

conflictsRouter.post(
  '/sweep',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const propertyId = req.body?.propertyId ? String(req.body.propertyId) : undefined;
    const result = await sweepConflicts(propertyId);
    res.json(result);
  }),
);
