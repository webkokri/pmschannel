import {
  type AriPushResult,
  type AriUpdate,
  type ConnectionTestResult,
  type NormalizedBooking,
  type OtaDefinition,
} from '@cm/shared';
import { OTA_BY_CODE } from '@cm/shared';
import { BaseConnector } from '../base-connector';
import { NotImplementedError, type ConnectorContext } from '../types';

/**
 * Reference skeleton for the Airbnb API (connected software partner).
 *
 * OAuth2 bearer token per host account. Calendar operations
 * (`/v2/calendars/{listingId}/{date}`), pricing settings, and reservations via
 * `/v2/reservations` + a webhook subscription for `reservation` events.
 *
 * Docs: https://www.airbnb.com/partner/api
 */
export class AirbnbProvider extends BaseConnector {
  readonly definition: OtaDefinition = OTA_BY_CODE['airbnb'];
  private baseUrl = 'https://api.airbnb.com';

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const { accessToken } = ctx.credentials as Record<string, string>;
    if (!accessToken) return { ok: false, message: 'Missing OAuth accessToken in credentials.' };
    // Real: GET `${this.baseUrl}/v2/user` (or /v2/listings) with the bearer token.
    void this.baseUrl;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async pushAri(ctx: ConnectorContext, updates: AriUpdate[]): Promise<AriPushResult> {
    // Real: for each update PUT `/v2/calendars/{listingId}/{date}` with
    // { availability, daily_price, min_nights, closed_to_arrival, ... }.
    void ctx;
    void updates;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async fetchBookings(ctx: ConnectorContext, since: Date | null): Promise<NormalizedBooking[]> {
    // Real: GET `/v2/reservations?listing_id=...&updated_at_min=since`.
    void ctx;
    void since;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  parseWebhook(
    ctx: ConnectorContext,
    _headers: Record<string, unknown>,
    _body: unknown,
  ): NormalizedBooking[] {
    void ctx;
    // Real: verify signature header, then map body.reservation -> NormalizedBooking.
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }
}
