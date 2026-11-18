import { DEFAULT_ACCELERATOR_CHANNEL_CODES } from '@cm/shared';
import { prisma } from '../db';
import { logger } from './logger';
import { getPlatformSetting } from './platform-settings';

const log = logger('accelerator');

export async function getAcceleratorChannelCodes(): Promise<string[]> {
  return (await getPlatformSetting<string[]>('accelerator:channelCodes')) ?? DEFAULT_ACCELERATOR_CHANNEL_CODES;
}

/**
 * Activates the Accelerator for an organization: marks it active and, for every property,
 * enables a `ChannelConnection` (flagged `viaAccelerator`) for every bundle channel not
 * already connected. Room mappings still need the owner's external room IDs — this is
 * "get listed everywhere," not "auto-configure everywhere," since we have no real
 * credentials to map against; the org sees a "needs mapping" prompt in Channels for each
 * one, same as any other new connection. Free, admin-triggered — no payment involved.
 */
export async function activateAccelerator(
  organizationId: string,
): Promise<{ connectionsCreated: number; channelCodes: string[] }> {
  const channelCodes = await getAcceleratorChannelCodes();
  const channels = await prisma.channel.findMany({ where: { code: { in: channelCodes }, active: true } });
  const properties = await prisma.property.findMany({ where: { organizationId, active: true } });

  let connectionsCreated = 0;
  for (const property of properties) {
    for (const channel of channels) {
      const existing = await prisma.channelConnection.findUnique({
        where: { propertyId_channelId: { propertyId: property.id, channelId: channel.id } },
      });
      if (existing) {
        if (!existing.enabled) {
          await prisma.channelConnection.update({ where: { id: existing.id }, data: { enabled: true, viaAccelerator: true } });
          connectionsCreated++;
        }
        continue;
      }
      await prisma.channelConnection.create({
        data: {
          organizationId,
          propertyId: property.id,
          channelId: channel.id,
          enabled: true,
          status: 'connected',
          credentials: '',
          viaAccelerator: true,
        },
      });
      connectionsCreated++;
    }
  }

  await prisma.accelerator.upsert({
    where: { organizationId },
    create: {
      organizationId,
      active: true,
      activatedAt: new Date(),
      boostedChannelCodes: channelCodes,
    },
    update: {
      active: true,
      activatedAt: new Date(),
      deactivatedAt: null,
      boostedChannelCodes: channelCodes,
    },
  });

  log.info(`Accelerator activated for org ${organizationId}: ${connectionsCreated} connection(s) across ${properties.length} propert(y/ies)`);
  return { connectionsCreated, channelCodes };
}
