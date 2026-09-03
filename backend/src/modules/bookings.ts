import { Router } from 'express';
import { z } from 'zod';
import { nightsBetween } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { recomputeAvailability, enqueueAvailabilityFanout } from '../engine/ari';
import { evaluateBooking } from '../engine/conflict';

export const bookingsRouter = Router();

bookingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));

    const where = {
      propertyId: q.propertyId ? String(q.propertyId) : undefined,
      sourceChannelId: q.channelId ? String(q.channelId) : undefined,
      status: q.status ? (String(q.status) as never) : undefined,
      unmapped: q.unmapped === 'true' ? true : undefined,
      OR: q.search
        ? [
            { guestName: { contains: String(q.search), mode: 'insensitive' as const } },
            { externalRef: { contains: String(q.search), mode: 'insensitive' as const } },
          ]
        : undefined,
    };

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sourceChannel: { select: { name: true, code: true } },
          property: { select: { name: true, code: true } },
          roomType: { select: { name: true } },
        },
      }),
    ]);

    res.json({ total, page, pageSize, bookings });
  }),
);

bookingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        sourceChannel: true,
        property: true,
        roomType: true,
        ratePlan: true,
        nights: { orderBy: { date: 'asc' } },
      },
    });
    if (!booking) throw notFound('Booking not found');

    const conflicts = await prisma.conflictAlert.findMany({
      where: { bookingIds: { has: booking.id } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ booking, conflicts });
  }),
);

const statusInput = z.object({
  status: z.enum(['confirmed', 'modified', 'cancelled', 'rejected']),
  note: z.string().optional(),
});

bookingsRouter.patch(
  '/:id/status',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = parse(statusInput, req.body);
    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: body.status },
    });

    if (booking.roomTypeId) {
      const dates = nightsBetween(
        booking.checkIn.toISOString().slice(0, 10),
        booking.checkOut.toISOString().slice(0, 10),
      );
      await recomputeAvailability(booking.roomTypeId, dates);
      await enqueueAvailabilityFanout(booking.roomTypeId, dates, { reason: 'manual-status-change' });
      if (body.status === 'confirmed' || body.status === 'modified') {
        await evaluateBooking(booking);
      }
    }
    res.json({ booking });
  }),
);

bookingsRouter.post(
  '/:id/repush',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!booking) throw notFound('Booking not found');
    if (!booking.roomTypeId) throw notFound('Booking has no mapped room type');
    const dates = nightsBetween(
      booking.checkIn.toISOString().slice(0, 10),
      booking.checkOut.toISOString().slice(0, 10),
    );
    await recomputeAvailability(booking.roomTypeId, dates);
    const count = await enqueueAvailabilityFanout(booking.roomTypeId, dates, { reason: 'manual-repush' });
    res.json({ jobsQueued: count, dates });
  }),
);
