import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_PLANS, FULL_CHANNEL_CATALOG, addDays, nightsBetween, todayIso } from '@cm/shared';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@channelmanager.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@channelmanager.local';
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'superadmin12345';

const FIRST = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Devon', 'Priya', 'Wei', 'Noah', 'Emma'];
const LAST = ['Nguyen', 'Patel', 'Smith', 'Tremblay', 'Garcia', 'Kim', 'Brown', 'Roy', 'Wilson', 'Martin', 'Lee', 'Cote', 'Singh', 'Dubois'];
const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  console.log('Seeding channel manager…');

  // ── Platform: plans ──────────────────────────────────────────────────────
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        limits: p.limits as object,
        sortOrder: p.sortOrder,
      },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        limits: p.limits as object,
        sortOrder: p.sortOrder,
      },
    });
  }
  const enterprisePlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'enterprise' } });

  // ── Platform: super admin ────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL.toLowerCase() },
    update: {},
    create: {
      email: SUPERADMIN_EMAIL.toLowerCase(),
      name: 'Platform Super Admin',
      role: 'admin',
      isSuperAdmin: true,
      passwordHash: await bcrypt.hash(SUPERADMIN_PASSWORD, 10),
    },
  });

  // ── Platform: dedicated support manager pool ────────────────────────────
  const supportStaff = [
    { email: 'priya.support@channelmanager.local', name: 'Priya Chandran' },
    { email: 'marcus.support@channelmanager.local', name: 'Marcus Bell' },
  ];
  for (const s of supportStaff) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        email: s.email,
        name: s.name,
        role: 'viewer',
        isSupportManager: true,
        passwordHash: await bcrypt.hash('support12345', 10),
      },
    });
  }
  const firstSupportManager = await prisma.user.findUniqueOrThrow({ where: { email: supportStaff[0].email } });

  // ── Tenant: "Demo Hotels" organization ───────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-hotels' },
    update: {},
    create: {
      name: 'Demo Hotels',
      slug: 'demo-hotels',
      contactEmail: ADMIN_EMAIL.toLowerCase(),
      country: 'US',
      currency: 'USD',
      status: 'active',
      supportManagerId: firstSupportManager.id,
      supportManagerAssignedAt: new Date(),
    },
  });
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: { planId: enterprisePlan.id, status: 'active' },
    create: {
      organizationId: org.id,
      planId: enterprisePlan.id,
      status: 'active',
      currentPeriodEnd: new Date(addDays(todayIso(), 365) + 'T00:00:00Z'),
    },
  });

  // ── Tenant users ─────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL.toLowerCase() },
    update: { organizationId: org.id },
    create: {
      organizationId: org.id,
      email: ADMIN_EMAIL.toLowerCase(),
      name: 'Admin',
      role: 'admin',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    },
  });
  await prisma.user.upsert({
    where: { email: 'manager@channelmanager.local' },
    update: { organizationId: org.id },
    create: {
      organizationId: org.id,
      email: 'manager@channelmanager.local',
      name: 'Property Manager',
      role: 'manager',
      passwordHash: await bcrypt.hash('manager12345', 10),
    },
  });

  // ── Channels + PMS integrations (platform-global catalogue) ──────────────
  for (const def of FULL_CHANNEL_CATALOG) {
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

  // ── Properties + rooms + rate plans (all owned by "Demo Hotels") ─────────
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
        { code: 'KING', name: 'King Room', totalUnits: 6, base: 189, category: 'standard' as const },
        { code: 'QUEEN2', name: 'Double Queen', totalUnits: 5, base: 209, category: 'deluxe' as const },
        { code: 'SUITE', name: 'Ocean Suite', totalUnits: 2, base: 349, category: 'suite' as const },
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
        { code: 'LODGE-Q', name: 'Lodge Queen', totalUnits: 8, base: 165, category: 'standard' as const },
        { code: 'CABIN-2BR', name: '2-Bedroom Cabin', totalUnits: 4, base: 295, category: 'family' as const },
        { code: 'CABIN-LOFT', name: 'Loft Cabin', totalUnits: 1, base: 259, category: 'suite' as const },
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
        { code: 'STUDIO', name: 'Studio Apartment', totalUnits: 10, base: 149, category: 'standard' as const },
        { code: '1BR', name: 'One-Bedroom Apartment', totalUnits: 7, base: 199, category: 'deluxe' as const },
      ],
    },
  ];

  const createdRooms: { id: string; propertyId: string; propertyCode: string; code: string; base: number; totalUnits: number }[] = [];

  for (const spec of propertySpecs) {
    const property = await prisma.property.upsert({
      where: { code: spec.code },
      update: { name: spec.name, organizationId: org.id },
      create: {
        organizationId: org.id,
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

    // Every property gets a working, published booking page by default (matches
    // what property creation does outside the seed too) — the Seaside-specific block
    // below overrides this with richer SEO content for that one property.
    await prisma.propertySeo.upsert({
      where: { propertyId: property.id },
      update: {},
      create: { propertyId: property.id, metaTitle: property.name, published: true },
    });

    for (const r of spec.rooms) {
      const room = await prisma.roomType.upsert({
        where: { propertyId_code: { propertyId: property.id, code: r.code } },
        update: { name: r.name, totalUnits: r.totalUnits, basePrice: r.base, category: r.category },
        create: {
          propertyId: property.id,
          code: r.code,
          name: r.name,
          category: r.category,
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
  const commissionByCode: Record<string, number> = {
    booking_com: 15,
    expedia: 18,
    airbnb: 14,
    vrbo: 8,
    direct_web: 0,
  };
  const properties = await prisma.property.findMany({ where: { organizationId: org.id }, include: { roomTypes: true } });

  for (const property of properties) {
    for (const code of connectedCodes) {
      const channel = channelByCode[code];
      if (!channel) continue;
      const connection = await prisma.channelConnection.upsert({
        where: { propertyId_channelId: { propertyId: property.id, channelId: channel.id } },
        update: { enabled: true, status: 'connected', commissionPct: commissionByCode[code] ?? 0 },
        create: {
          organizationId: org.id,
          propertyId: property.id,
          channelId: channel.id,
          enabled: true,
          status: 'connected',
          credentials: '', // mock driver — no secrets needed
          pullIntervalSec: 60,
          commissionPct: commissionByCode[code] ?? 0,
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
          organizationId: org.id,
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
            organizationId: org.id,
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
        organizationId: org.id,
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

  // ── Room units (PMS) — a few physical units per room type at Seaside ────
  const seaside = properties.find((p) => p.code === 'SEASIDE')!;
  for (const room of seaside.roomTypes) {
    for (let i = 1; i <= Math.min(3, room.totalUnits); i++) {
      await prisma.roomUnit.upsert({
        where: { roomTypeId_unitNumber: { roomTypeId: room.id, unitNumber: `${room.code}-${100 + i}` } },
        update: {},
        create: {
          roomTypeId: room.id,
          unitNumber: `${room.code}-${100 + i}`,
          housekeepingStatus: i === 1 ? 'dirty' : 'clean',
        },
      });
    }
  }

  // ── Finance: a few sample expenses at Seaside ───────────────────────────
  const existingExpenses = await prisma.expense.count({ where: { propertyId: seaside.id } });
  if (existingExpenses === 0) {
    await prisma.expense.createMany({
      data: [
        { organizationId: org.id, propertyId: seaside.id, category: 'utilities', amountCents: 42000, incurredAt: new Date(addDays(start, -10) + 'T00:00:00Z'), vendor: 'City Power & Water', note: 'Monthly utilities' },
        { organizationId: org.id, propertyId: seaside.id, category: 'payroll', amountCents: 850000, incurredAt: new Date(addDays(start, -7) + 'T00:00:00Z'), vendor: 'Payroll', note: 'Front desk + housekeeping' },
        { organizationId: org.id, propertyId: seaside.id, category: 'maintenance', amountCents: 18500, incurredAt: new Date(addDays(start, -3) + 'T00:00:00Z'), vendor: 'Ace Repairs', note: 'HVAC service' },
      ],
    });
  }

  // ── A guest-facing package ───────────────────────────────────────────────
  const oceanSuite = seaside.roomTypes.find((r) => r.code === 'SUITE');
  if (oceanSuite) {
    const existingPackage = await prisma.package.findFirst({ where: { propertyId: seaside.id, name: 'Honeymoon Package' } });
    if (!existingPackage) {
      await prisma.package.create({
        data: {
          organizationId: org.id,
          propertyId: seaside.id,
          roomTypeId: oceanSuite.id,
          name: 'Honeymoon Package',
          description: 'Ocean Suite + champagne, breakfast in bed, and a late 2pm checkout.',
          priceAdjustType: 'flat',
          priceValue: 75,
          includedAddons: ['Champagne on arrival', 'Breakfast in bed', 'Late checkout (2pm)'],
        },
      });
    }
  }

  // ── RMS: a couple of pricing rules for Seaside ───────────────────────────
  const existingRules = await prisma.pricingRule.count({ where: { propertyId: seaside.id } });
  if (existingRules === 0) {
    await prisma.pricingRule.createMany({
      data: [
        {
          organizationId: org.id,
          propertyId: seaside.id,
          name: 'Weekend premium',
          type: 'day_of_week',
          conditions: { weekdays: [5, 6] },
          adjustPct: 15,
          priority: 1,
        },
        {
          organizationId: org.id,
          propertyId: seaside.id,
          name: 'High demand surcharge',
          type: 'occupancy_based',
          conditions: { minOccupancyPct: 80, maxOccupancyPct: 100 },
          adjustPct: 10,
          priority: 2,
        },
        {
          organizationId: org.id,
          propertyId: seaside.id,
          name: 'Last-minute discount',
          type: 'lead_time',
          conditions: { maxDaysOut: 2, minDaysOut: 0 },
          adjustPct: -10,
          priority: 3,
        },
      ],
    });
  }

  // ── SEO / GEO / AEO — richer SEO content for Seaside's public microsite, overriding
  // the generic default every property already got above ──────────────────
  await prisma.propertySeo.upsert({
    where: { propertyId: seaside.id },
    update: {
      metaTitle: 'Seaside Boutique Hotel — San Diego Ocean-View Rooms',
      metaDescription: 'Book direct at Seaside Boutique Hotel in San Diego — ocean-view rooms and suites, best-rate guarantee, free cancellation.',
      keywords: ['san diego hotel', 'ocean view hotel san diego', 'boutique hotel california'],
      published: true,
    },
    create: {
      propertyId: seaside.id,
      metaTitle: 'Seaside Boutique Hotel — San Diego Ocean-View Rooms',
      metaDescription: 'Book direct at Seaside Boutique Hotel in San Diego — ocean-view rooms and suites, best-rate guarantee, free cancellation.',
      keywords: ['san diego hotel', 'ocean view hotel san diego', 'boutique hotel california'],
      published: true,
    },
  });
  const faqCount = await prisma.propertyFaq.count({ where: { propertyId: seaside.id } });
  if (faqCount === 0) {
    await prisma.propertyFaq.createMany({
      data: [
        { propertyId: seaside.id, question: 'What time is check-in and check-out?', answer: 'Check-in is from 3:00 PM and check-out is by 11:00 AM. Late checkout may be available on request.', sortOrder: 1 },
        { propertyId: seaside.id, question: 'Is parking available?', answer: 'Yes, complimentary self-parking is available for all overnight guests.', sortOrder: 2 },
        { propertyId: seaside.id, question: 'Do you allow pets?', answer: 'We welcome dogs under 50 lbs in select rooms for a nightly pet fee — please let us know in advance.', sortOrder: 3 },
      ],
    });
  }

  // ── Staff: give the seeded manager finance + notifications permissions ──
  await prisma.user.updateMany({
    where: { organizationId: org.id, email: 'manager@channelmanager.local' },
    data: { permissions: ['finance.manage', 'notifications.manage'], title: 'Operations Manager', department: 'Operations' },
  });

  // ── Default settings + autopilot off ───────────────────────────────────
  await prisma.setting.upsert({
    where: { organizationId_key: { organizationId: org.id, key: 'mock:autopilot' } },
    update: {},
    create: {
      organizationId: org.id,
      key: 'mock:autopilot',
      value: { enabled: false, lambdaByChannel: {}, horizonDays: 45, avgStayNights: 2 },
    },
  });

  console.log(`Done. ${made} historical bookings, ${createdRooms.length} room types, ${channels.length} channels.`);
  console.log(`Org admin login:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Super admin login: ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
