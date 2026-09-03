import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { OTA_CATALOG, addDays, nightsBetween, todayIso } from '@cm/shared';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@channelmanager.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

const FIRST = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Devon', 'Priya', 'Wei', 'Noah', 'Emma'];
const LAST = ['Nguyen', 'Patel', 'Smith', 'Tremblay', 'Garcia', 'Kim', 'Brown', 'Roy', 'Wilson', 'Martin', 'Lee', 'Cote', 'Singh', 'Dubois'];
const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  console.log('Seeding channel manager…');

  // ── Users ────────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL.toLowerCase() },
    update: {},
    create: {
      email: ADMIN_EMAIL.toLowerCase(),
      name: 'Admin',
      role: 'admin',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    },
  });
  await prisma.user.upsert({
    where: { email: 'manager@channelmanager.local' },
    update: {},
    create: {
      email: 'manager@channelmanager.local',
      name: 'Property Manager',
      role: 'manager',
      passwordHash: await bcrypt.hash('manager12345', 10),
    },
  });

  // ── Channels (from the shared catalogue) ─────────────────────────────────
  for (const def of OTA_CATALOG) {
    await prisma.channel.upsert({
      where: { code: def.code },
      update: {
        name: def.name,
        category: def.category,
        kind: def.kind,
        authType: def.authType,
        markets: def.markets,
        capabilities: def.capabilities,
        docsUrl: def.docsUrl,
        notes: def.notes,
      },
      create: {
        code: def.code,
        name: def.name,
        category: def.category,
        kind: def.kind,
        authType: def.authType,
        markets: def.markets,
        capabilities: def.capabilities,
        docsUrl: def.docsUrl,
        notes: def.notes,
      },
    });
  }
  const channels = await prisma.channel.findMany();
  const channelByCode = Object.fromEntries(channels.map((c) => [c.code, c]));

  // ── Properties + rooms + rate plans ─────────────────────────────────────
  const propertySpecs = [
    {
      code: 'SEASIDE',
      name: 'Seaside Boutique Hotel',
      city: 'San Diego',
      region: 'CA',
      country: 'US',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
      rooms: [
        { code: 'KING', name: 'King Room', totalUnits: 6, base: 189 },
        { code: 'QUEEN2', name: 'Double Queen', totalUnits: 5, base: 209 },
        { code: 'SUITE', name: 'Ocean Suite', totalUnits: 2, base: 349 },
      ],
    },
    {
      code: 'ALPINE',
      name: 'Alpine Lodge & Cabins',
      city: 'Banff',
      region: 'AB',
      country: 'CA',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      rooms: [
        { code: 'LODGE-Q', name: 'Lodge Queen', totalUnits: 8, base: 165 },
        { code: 'CABIN-2BR', name: '2-Bedroom Cabin', totalUnits: 4, base: 295 },
        { code: 'CABIN-LOFT', name: 'Loft Cabin', totalUnits: 1, base: 259 },
      ],
    },
    {
      code: 'DOWNTOWN',
      name: 'Downtown Serviced Apartments',
      city: 'Austin',
      region: 'TX',
      country: 'US',
      timezone: 'America/Chicago',
      currency: 'USD',
      rooms: [
        { code: 'STUDIO', name: 'Studio Apartment', totalUnits: 10, base: 149 },
        { code: '1BR', name: 'One-Bedroom Apartment', totalUnits: 7, base: 199 },
      ],
    },
  ];

  const createdRooms: { id: string; propertyId: string; propertyCode: string; code: string; base: number; totalUnits: number }[] = [];

  for (const spec of propertySpecs) {
    const property = await prisma.property.upsert({
      where: { code: spec.code },
      update: { name: spec.name },
      create: {
        code: spec.code,
        name: spec.name,
        address: '100 Main St',
        city: spec.city,
        region: spec.region,
        country: spec.country,
        timezone: spec.timezone,
        currency: spec.currency,
      },
    });

    for (const r of spec.rooms) {
      const room = await prisma.roomType.upsert({
        where: { propertyId_code: { propertyId: property.id, code: r.code } },
        update: { name: r.name, totalUnits: r.totalUnits, basePrice: r.base },
        create: {
          propertyId: property.id,
          code: r.code,
          name: r.name,
          totalUnits: r.totalUnits,
          basePrice: r.base,
          maxOccupancy: r.code.includes('SUITE') || r.code.includes('CABIN') ? 4 : 2,
        },
      });
      for (const rp of [
        { code: 'BAR', name: 'Best Available Rate', meal: 'room_only', pct: 0 },
        { code: 'BB', name: 'Bed & Breakfast', meal: 'breakfast', pct: 12 },
        { code: 'NR', name: 'Non-Refundable', meal: 'room_only', pct: -10 },
      ]) {
        await prisma.ratePlan.upsert({
          where: { roomTypeId_code: { roomTypeId: room.id, code: rp.code } },
          update: {},
          create: {
            roomTypeId: room.id,
            code: rp.code,
            name: rp.name,
            mealPlan: rp.meal,
            cancellationPolicy: rp.code === 'NR' ? 'non_refundable' : 'flexible',
            adjustPct: rp.pct,
          },
        });
      }
      createdRooms.push({
        id: room.id,
        propertyId: property.id,
        propertyCode: property.code,
        code: r.code,
        base: r.base,
        totalUnits: r.totalUnits,
      });
    }
  }

  // ── Calendar: 120 days of availability + rates ──────────────────────────
  const horizon = 120;
  const start = todayIso();
  for (const room of createdRooms) {
    const days = nightsBetween(start, addDays(start, horizon));
    for (const date of days) {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 5 || dow === 6;
      const price = Math.round(room.base * (weekend ? 1.25 : 1) * (0.95 + Math.random() * 0.15));
      await prisma.calendarDay.upsert({
        where: { roomTypeId_date: { roomTypeId: room.id, date: new Date(date + 'T00:00:00Z') } },
        update: { price, availableUnits: room.totalUnits },
        create: {
          roomTypeId: room.id,
          date: new Date(date + 'T00:00:00Z'),
          price,
          availableUnits: room.totalUnits,
          minStay: weekend ? 2 : 1,
        },
      });
    }
  }

  // ── Connections + room mappings for a handful of channels ───────────────
  const connectedCodes = ['booking_com', 'expedia', 'airbnb', 'direct_web', 'vrbo'];
  const properties = await prisma.property.findMany({ include: { roomTypes: true } });

  for (const property of properties) {
    for (const code of connectedCodes) {
      const channel = channelByCode[code];
      if (!channel) continue;
      const connection = await prisma.channelConnection.upsert({
        where: { propertyId_channelId: { propertyId: property.id, channelId: channel.id } },
        update: { enabled: true, status: 'connected' },
        create: {
          propertyId: property.id,
          channelId: channel.id,
          enabled: true,
          status: 'connected',
          credentials: '', // mock driver — no secrets needed
          pullIntervalSec: 60,
        },
      });
      for (const room of property.roomTypes) {
        await prisma.roomMapping.upsert({
          where: {
            channelConnectionId_externalRoomId_externalRatePlanId: {
              channelConnectionId: connection.id,
              externalRoomId: `${code}-${room.code}`,
              externalRatePlanId: `${code}-${room.code}-BAR`,
            },
          },
          update: { roomTypeId: room.id },
          create: {
            channelConnectionId: connection.id,
            roomTypeId: room.id,
            externalRoomId: `${code}-${room.code}`,
            externalRatePlanId: `${code}-${room.code}-BAR`,
          },
        });
      }
    }
  }

  // ── Historical bookings (spread over the last 30 days / next 90) ────────
  const bookingChannels = connectedCodes.map((c) => channelByCode[c]).filter(Boolean);
  let made = 0;
  for (let i = 0; i < 45; i++) {
    const room = rand(createdRooms);
    const channel = rand(bookingChannels);
    const checkIn = addDays(start, randInt(-25, 80));
    const stay = randInt(1, 6);
    const checkOut = addDays(checkIn, stay);
    const nights = nightsBetween(checkIn, checkOut);
    const nightly = room.base + randInt(-20, 60);
    const guest = `${rand(FIRST)} ${rand(LAST)}`;
    const externalRef = `${channel.code.toUpperCase()}-SEED-${i}`;

    try {
      const booking = await prisma.booking.create({
        data: {
          propertyId: room.propertyId,
          sourceChannelId: channel.id,
          roomTypeId: room.id,
          externalRef,
          status: Math.random() < 0.08 ? 'cancelled' : 'confirmed',
          guestName: guest,
          guestEmail: `${guest.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
          checkIn: new Date(checkIn + 'T00:00:00Z'),
          checkOut: new Date(checkOut + 'T00:00:00Z'),
          unitsBooked: 1,
          currency: 'USD',
          amount: nightly * nights.length,
          externalRoomId: `${channel.code}-${room.code}`,
          receivedAt: new Date(Date.now() - randInt(0, 30) * 86_400_000),
          rawPayload: { source: 'seed', channel: channel.code },
          nights: {
            create: nights.map((d) => ({ date: new Date(d + 'T00:00:00Z'), units: 1 })),
          },
        },
      });
      made++;

      // Decrement availability for confirmed bookings.
      if (booking.status === 'confirmed') {
        for (const d of nights) {
          await prisma.calendarDay.updateMany({
            where: { roomTypeId: room.id, date: new Date(d + 'T00:00:00Z') },
            data: { availableUnits: { decrement: 1 } },
          });
        }
      }
    } catch {
      /* dup externalRef — skip */
    }
  }

  // ── One deliberate overbooking for the demo ─────────────────────────────
  const loft = createdRooms.find((r) => r.code === 'CABIN-LOFT');
  if (loft) {
    const ci = addDays(start, 10);
    const co = addDays(ci, 2);
    const nights = nightsBetween(ci, co);
    const [chA, chB] = [channelByCode['booking_com'], channelByCode['airbnb']];
    for (const [idx, ch] of [chA, chB].entries()) {
      await prisma.booking
        .create({
          data: {
            propertyId: loft.propertyId,
            sourceChannelId: ch.id,
            roomTypeId: loft.id,
            externalRef: `${ch.code.toUpperCase()}-DEMO-OVERBOOK-${idx}`,
            status: 'confirmed',
            guestName: idx === 0 ? 'Dana Fitzgerald' : 'Chris Vandenberg',
            guestEmail: 'demo@example.com',
            checkIn: new Date(ci + 'T00:00:00Z'),
            checkOut: new Date(co + 'T00:00:00Z'),
            unitsBooked: 1,
            currency: 'USD',
            amount: loft.base * nights.length,
            externalRoomId: `${ch.code}-${loft.code}`,
            rawPayload: { source: 'seed', scenario: 'overbooking' },
            nights: { create: nights.map((d) => ({ date: new Date(d + 'T00:00:00Z'), units: 1 })) },
          },
        })
        .catch(() => undefined);
    }
    await prisma.calendarDay.updateMany({
      where: { roomTypeId: loft.id, date: { in: nights.map((d) => new Date(d + 'T00:00:00Z')) } },
      data: { availableUnits: 0, stopSell: true },
    });
    await prisma.conflictAlert.create({
      data: {
        type: 'double_booking',
        severity: 'critical',
        roomTypeId: loft.id,
        fromDate: new Date(ci + 'T00:00:00Z'),
        toDate: new Date(co + 'T00:00:00Z'),
        bookingIds: [],
        details: {
          message: `Loft Cabin (capacity 1) has 2 confirmed reservations for ${ci} → ${co} from Booking.com and Airbnb.`,
          oversoldDates: nights.map((d) => ({ date: d, demand: 2, capacity: 1 })),
        },
      },
    });
  }

  // ── Default settings + autopilot off ───────────────────────────────────
  await prisma.setting.upsert({
    where: { key: 'mock:autopilot' },
    update: {},
    create: { key: 'mock:autopilot', value: { enabled: false, lambdaByChannel: {}, horizonDays: 45, avgStayNights: 2 } },
  });

  console.log(`Done. ${made} historical bookings, ${createdRooms.length} room types, ${channels.length} channels.`);
  console.log(`Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
