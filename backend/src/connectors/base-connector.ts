import type {
  AriPushResult,
  AriUpdate,
  ConnectionTestResult,
  NormalizedBooking,
  OtaDefinition,
} from '@cm/shared';
import { logger } from '../lib/logger';
import { NotImplementedError, type Connector, type ConnectorContext } from './types';

/**
 * Base class for real provider connectors. Provides logging + a small HTTP
 * helper and defaults every method to "not implemented" so a partially-built
 * connector fails loudly and clearly rather than silently doing nothing.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly definition: OtaDefinition;
  protected log = logger('connector');

  async testConnection(_ctx: ConnectorContext): Promise<ConnectionTestResult> {
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async pushAri(_ctx: ConnectorContext, _updates: AriUpdate[]): Promise<AriPushResult> {
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async fetchBookings(_ctx: ConnectorContext, _since: Date | null): Promise<NormalizedBooking[]> {
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  /** Thin fetch wrapper with timeout + JSON parsing, for real connectors. */
  protected async http<T = unknown>(
    url: string,
    init: NonNullable<Parameters<typeof fetch>[1]> & { timeoutMs?: number } = {},
  ): Promise<{ status: number; body: T }> {
    const { timeoutMs = 15000, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep as text */
      }
      return { status: res.status, body: body as T };
    } finally {
      clearTimeout(timer);
    }
  }
}
