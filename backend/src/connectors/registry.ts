import { prisma } from '../db';
import { decryptJson } from '../lib/crypto';
import { logger } from '../lib/logger';
import { MockConnector } from './mock/mock-connector';
import { PROVIDER_FACTORIES } from './providers';
import type { Connector, ConnectorContext } from './types';

const log = logger('connector-registry');

export type DriverName = 'mock' | 'real';

/**
 * Resolve the connector for a channel code + driver.
 *  - `mock` (default in dev): the in-repo MockConnector — no external calls.
 *  - `real`: the provider implementation (stub until built).
 */
export function getConnector(channelCode: string, driver: DriverName = 'mock'): Connector {
  if (driver === 'real') {
    const factory = PROVIDER_FACTORIES[channelCode];
    if (!factory) throw new Error(`No real connector registered for "${channelCode}"`);
    return factory();
  }
  return new MockConnector(channelCode);
}

export interface ResolvedConnection {
  connector: Connector;
  ctx: ConnectorContext;
  driver: DriverName;
}

/** Build the runtime context for a ChannelConnection, including decrypted creds. */
export async function resolveConnection(connectionId: string): Promise<ResolvedConnection> {
  const conn = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    include: {
      channel: true,
      property: true,
      roomMappings: { where: { active: true } },
    },
  });
  if (!conn) throw new Error(`ChannelConnection ${connectionId} not found`);

  const credentials = (decryptJson<Record<string, unknown>>(conn.credentials) ?? {}) as Record<string, unknown>;
  const driver: DriverName = credentials.driver === 'real' ? 'real' : 'mock';

  const ctx: ConnectorContext = {
    connectionId: conn.id,
    propertyId: conn.propertyId,
    propertyCode: conn.property.code,
    channelCode: conn.channel.code,
    credentials,
    roomMap: conn.roomMappings.map((m) => ({
      roomTypeId: m.roomTypeId,
      ratePlanId: m.ratePlanId,
      externalRoomId: m.externalRoomId,
      externalRatePlanId: m.externalRatePlanId,
    })),
  };

  return { connector: getConnector(conn.channel.code, driver), ctx, driver };
}

export function isImplementedError(err: unknown): boolean {
  return !(err instanceof Error && err.name === 'NotImplementedError');
}

export { log as registryLog };
