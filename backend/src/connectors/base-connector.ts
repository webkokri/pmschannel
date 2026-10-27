import type {
  AriPushResult,
  AriUpdate,
  ConnectionTestResult,
  NormalizedBooking,
  OtaDefinition,
} from '@cm/shared';
import { logger } from '../lib/logger';
import { assertPublicHttpUrl } from '../lib/safe-fetch';
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

  /**
   * Thin fetch wrapper with timeout + JSON parsing, for real connectors. Many
   * providers (any PMS with a per-customer or per-region API base URL) take that
   * base URL from the admin-entered credentials rather than a hardcoded constant
   * — validate it the same way regardless of which provider calls this, so a
   * malicious/compromised admin can't point a real connector's requests at
   * internal infrastructure (cloud metadata, admin panels, etc.).
   */
  protected async http<T = unknown>(
    url: string,
    init: NonNullable<Parameters<typeof fetch>[1]> & { timeoutMs?: number } = {},
  ): Promise<{ status: number; body: T }> {
    const { timeoutMs = 15000, redirect, ...rest } = init;
    const safeUrl = await assertPublicHttpUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(safeUrl, { ...rest, redirect: redirect ?? 'error', signal: controller.signal });
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
