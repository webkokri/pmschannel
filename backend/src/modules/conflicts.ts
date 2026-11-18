import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { assertOwned, propertyScope, requireOrg, resolvePropertyFilter } from '../lib/tenant';
import { sweepConflicts } from '../engine/conflict';

export const conflictsRouter = Router();
conflictsRouter.use(requireOrg);

conflictsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const status = req.query.status ? String(req.query.status) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const scope = propertyScope(req);
    const conflicts = await prisma.conflictAlert.findMany({
      where: {
        organizationId,
        status: status as never,
        type: type ?? undefined,
        // A scoped manager only sees conflicts attributable to their property — one
        // with no roomType (can't be attributed) is excluded rather than shown.
        ...(scope ? { roomType: { propertyId: scope } } : {}),
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
    const existing = await prisma.conflictAlert.findUnique({
      where: { id: req.params.id },
      include: { roomType: { select: { propertyId: true } } },
    });
    if (!existing || existing.organizationId !== req.user!.organizationId) throw notFound('Conflict not found');
    const scope = propertyScope(req);
    if (scope && existing.roomType?.propertyId !== scope) throw notFound('Conflict not found');
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
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.body?.propertyId ? String(req.body.propertyId) : undefined);
    if (propertyId) {
      await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), organizationId, 'Property', req);
    }
    const result = await sweepConflicts(organizationId, propertyId);
    res.json(result);
  }),
);
