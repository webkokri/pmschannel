import {
  nightsBetween,
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
 * Reference skeleton for the Booking.com Connectivity APIs.
 *
 * Booking.com uses machine-account credentials (hotel_id + username/password),
 * OTA_HotelAvailNotifRQ / OTA_HotelRateAmountNotifRQ style messages for ARI, and
 * OTA_HotelResNotif / the Reservations API for inbound bookings, plus an explicit
 * confirmation call. Fill in the endpoints + XML/JSON marshalling below; the
 * shapes and control flow the engine expects are already wired.
 *
 * Docs: https://connect.booking.com/
 */
export class BookingComProvider extends BaseConnector {
  readonly definition: OtaDefinition = OTA_BY_CODE['booking_com'];

  private baseUrl = 'https://supply-xml.booking.com'; // placeholder host

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const { hotelId, username, password } = ctx.credentials as Record<string, string>;
    if (!hotelId || !username || !password) {
      return { ok: false, message: 'Missing hotelId / username / password in credentials.' };
    }
    // Real: call a lightweight endpoint (e.g. OTA_HotelDescriptiveInfoRQ) and check the response.
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async pushAri(ctx: ConnectorContext, updates: AriUpdate[]): Promise<AriPushResult> {
    // Real: group by externalRoomId + externalRatePlanId, build an
    // OTA_HotelAvailNotifRQ (availability/restrictions) and
    // OTA_HotelRateAmountNotifRQ (rates), POST to `${this.baseUrl}/hotels/xml/...`
    // with basic auth, then parse OTA_HotelAvailNotifRS for per-row errors.
    void ctx;
    void updates;
    void this.baseUrl;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async fetchBookings(ctx: ConnectorContext, since: Date | null): Promise<NormalizedBooking[]> {
    // Real: poll the Reservations API (`/reservations`) with `last_change` >= since,
    // map each reservation to NormalizedBooking, then call acknowledgeBooking.
    void ctx;
    void since;
    void nightsBetween;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }

  async acknowledgeBooking(ctx: ConnectorContext, externalRef: string): Promise<void> {
    void ctx;
    void externalRef;
    throw new NotImplementedError(this.definition.code, this.definition.docsUrl);
  }
}
