import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../lib/http';
import { buildIcs } from '../connectors/providers/ical-format';

/**
 * Public (unauthenticated) outbound calendar feed — the other half of iCal sync.
 * Point Airbnb's / Vrbo's / any platform's "import an external calendar" field at
 * this URL and every confirmed booking on the mapped room, from ANY source (OTA,
 * PMS, or this platform's own direct-booking portal), shows up there as a blocked
 * date — no guest details, just the date range, matching standard iCal privacy
 * practice. The connection id is an unguessable cuid, so the URL itself is the
 * access control, the same model Google Calendar's "secret address" uses.
 */
export const icalExportRouter = Router();

icalExportRouter.get(
  '/:connectionId.ics',
  asyncHandler(async (req, res) => {
    const connection = await prisma.channelConnection.findUnique({
      where: { id: req.params.connectionId },
      include: {
        property: { select: { name: true } },
        roomMappings: { where: { active: true }, select: { roomTypeId: true } },
      },
    });
    if (!connection) throw notFound('Unknown calendar');

    const roomTypeIds = [...new Set(connection.roomMappings.map((m) => m.roomTypeId))];
    const bookings = roomTypeIds.length
      ? await prisma.booking.findMany({
          where: { roomTypeId: { in: roomTypeIds }, status: { in: ['confirmed', 'modified'] } },
          select: { id: true, checkIn: true, checkOut: true },
        })
      : [];

    const ics = buildIcs(
      `${connection.property.name} availability`,
      bookings.map((b) => ({
        uid: `cm-${b.id}@channelmanager`,
        start: b.checkIn.toISOString().slice(0, 10),
        end: b.checkOut.toISOString().slice(0, 10),
        summary: 'Booked',
      })),
    );

    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.send(ics);
  }),
);
