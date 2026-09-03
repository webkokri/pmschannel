import { prisma } from '../src/db';
import { OTA_CATALOG } from '@cm/shared';

export const PREFIX = `test_${Date.now().toString(36)}`;

/** Minimal world: 1 property, 1 room (capacity configurable), 2 mock channels
 *  each mapped to the room, calendar seeded for 30 days. */
export async function makeWorld(opts: { capacity?: number; channels?: string[] } = {}) {
  const capacity = opts.capacity ?? 2;
  const channelCodes = opts.channels ?? ['booking_com', 'airbnb'];

  // Channels come from the catalogue — upsert the ones we need.
  for (const code of channelCodes) {
    const def = OTA_CATALOG.find((o) => o.code === code)!;
    await prisma.channel.upsert({
      where: { code },
      update: {},
      create: {
        code,
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

  const property = await prisma.property.create({
    data: { code: `${PREFIX}_P`, name: `${PREFIX} Property`, country: 'US', currency: 'USD' },
  });
  const room = await prisma.roomType.create({
    data: { propertyId: property.id, code: 'R1', name: 'Test Room', totalUnits: capacity, basePrice: 100 },
  });

  const connections: Record<string, string> = {};
  for (const code of channelCodes) {
    const channel = await prisma.channel.findUniqueOrThrow({ where: { code } });
    const conn = await prisma.channelConnection.create({
      data: { propertyId: property.id, channelId: channel.id, enabled: true, credentials: '' },
    });
    await prisma.roomMapping.create({
      data: {
        channelConnectionId: conn.id,
        roomTypeId: room.id,
        externalRoomId: `${code}-R1`,
        externalRatePlanId: `${code}-R1-BAR`,
      },
    });
    connections[code] = conn.id;
  }

  // 30 days of calendar at price 100.
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
    await prisma.calendarDay.create({
      data: { roomTypeId: room.id, date: d, price: 100, availableUnits: capacity },
    });
  }

  return { property, room, connections };
}

export async function cleanWorld() {
  // FK cascades from Property handle most of it.
  await prisma.conflictAlert.deleteMany({ where: { roomType: { property: { code: { startsWith: PREFIX } } } } });
  await prisma.property.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.syncJob.deleteMany({ where: { payload: { path: ['reason'], equals: 'test' } } });
}

export function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
