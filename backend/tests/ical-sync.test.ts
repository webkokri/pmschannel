import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { encryptJson } from '../src/lib/crypto';
import { resolveConnection } from '../src/connectors/registry';
import { ingestBooking } from '../src/engine/ingest';
import { parseIcs, buildIcs } from '../src/connectors/providers/ical-format';
import { cleanWorld, isoDate, makeWorld } from './helpers';

const app = createApp();

/** A tiny stand-in for "the other platform's calendar export URL" — real HTTP,
 *  real parsing, nothing mocked. The body served is swapped mid-test to prove
 *  the reconciliation (a UID disappearing) actually releases inventory. */
let feedBody = '';
let server: http.Server;
let feedUrl: string;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end(feedBody);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  feedUrl = `http://127.0.0.1:${port}/feed.ics`;
});

afterAll(async () => {
  await cleanWorld();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('iCal connector — real HTTP round trip', () => {
  it('pulls a booking from an external .ics feed, decrements availability, and releases it on reconciliation', async () => {
    await cleanWorld();
    const world = await makeWorld({ capacity: 1, channels: ['ical_generic'] });
    const connectionId = world.connections.ical_generic;
    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: { credentials: encryptJson({ icalUrl: feedUrl, driver: 'real' }) },
    });

    const checkIn = isoDate(2);
    const checkOut = isoDate(4);
    feedBody = buildIcs('External calendar', [{ uid: 'EXT-UID-1', start: checkIn, end: checkOut, summary: 'Reserved' }]);

    const { connector, ctx } = await resolveConnection(connectionId);

    const test = await connector.testConnection(ctx);
    expect(test.ok).toBe(true);
    expect(test.message).toMatch(/1 event/);

    const pulled = await connector.fetchBookings(ctx, null);
    expect(pulled.length).toBe(1);
    expect(pulled[0].externalRef).toBe('EXT-UID-1');

    for (const b of pulled) {
      await ingestBooking('ical_generic', b, { sourceConnectionId: connectionId });
    }

    const booking = await prisma.booking.findFirstOrThrow({ where: { externalRef: 'EXT-UID-1' } });
    expect(booking.status).toBe('confirmed');

    const day = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(checkIn + 'T00:00:00Z') },
    });
    expect(day?.availableUnits).toBe(0);

    // The upstream feed drops the event (guest cancelled on the other platform).
    feedBody = buildIcs('External calendar', []);
    const reconciled = await connector.fetchBookings(ctx, null);
    expect(reconciled.length).toBe(1);
    expect(reconciled[0].status).toBe('cancelled');
    expect(reconciled[0].externalRef).toBe('EXT-UID-1');

    for (const b of reconciled) {
      await ingestBooking('ical_generic', b, { sourceConnectionId: connectionId });
    }

    const after = await prisma.booking.findFirstOrThrow({ where: { externalRef: 'EXT-UID-1' } });
    expect(after.status).toBe('cancelled');

    const dayAfter = await prisma.calendarDay.findFirst({
      where: { roomTypeId: world.room.id, date: new Date(checkIn + 'T00:00:00Z') },
    });
    expect(dayAfter?.availableUnits).toBe(1);
  });

  it('exposes a real outbound .ics feed at /api/ical/:connectionId.ics reflecting bookings from ANY channel', async () => {
    await cleanWorld();
    const world = await makeWorld({ capacity: 2, channels: ['ical_generic', 'booking_com'] });

    // A booking that arrives via Booking.com must still show up on the iCal
    // export for this room — the export reflects the room, not just this channel.
    await ingestBooking(
      'booking_com',
      {
        externalRef: 'BDC-EXPORT-1',
        status: 'confirmed',
        channelCode: 'booking_com',
        propertyCode: world.property.code,
        externalRoomId: 'booking_com-R1',
        externalRatePlanId: null,
        guestName: 'Export Test Guest',
        guestEmail: null,
        checkIn: isoDate(6),
        checkOut: isoDate(7),
        units: 1,
        currency: 'USD',
        amount: 100,
        raw: {},
      },
      { sourceConnectionId: world.connections.booking_com },
    );

    const res = await request(app).get(`/api/ical/${world.connections.ical_generic}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);

    const events = parseIcs(res.text);
    expect(events.some((e) => e.start === isoDate(6) && e.end === isoDate(7))).toBe(true);
    // No guest PII leaks into the exported feed.
    expect(res.text).not.toMatch(/Export Test Guest/);
  });
});
