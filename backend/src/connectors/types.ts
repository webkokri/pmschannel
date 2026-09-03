import type {
  AriPushResult,
  AriUpdate,
  ConnectionTestResult,
  NormalizedBooking,
  OtaDefinition,
} from '@cm/shared';

/** Runtime context handed to a connector for one property connection. */
export interface ConnectorContext {
  connectionId: string;
  propertyId: string;
  propertyCode: string;
  channelCode: string;
  /** Decrypted credential map, connector-specific shape. */
  credentials: Record<string, unknown>;
  /** local roomTypeId -> external ids, from RoomMapping. */
  roomMap: Array<{
    roomTypeId: string;
    ratePlanId: string | null;
    externalRoomId: string;
    externalRatePlanId: string;
  }>;
}

/**
 * Every OTA integration implements this. `MockConnector` fully implements it for
 * development; real providers extend `BaseConnector` and fill in the HTTP calls.
 */
export interface Connector {
  readonly definition: OtaDefinition;

  /** Verify credentials / reachability. */
  testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult>;

  /** Push availability / rates / restrictions. Grouped AriUpdates per call. */
  pushAri(ctx: ConnectorContext, updates: AriUpdate[]): Promise<AriPushResult>;

  /**
   * Pull bookings created/modified since `since`. For pure push channels this
   * returns []. Webhook-driven channels also implement `parseWebhook`.
   */
  fetchBookings(ctx: ConnectorContext, since: Date | null): Promise<NormalizedBooking[]>;

  /** Acknowledge a booking back to the OTA (confirm receipt / accept). */
  acknowledgeBooking?(ctx: ConnectorContext, externalRef: string): Promise<void>;

  /** Convert a raw inbound webhook body to normalized bookings. */
  parseWebhook?(ctx: ConnectorContext, headers: Record<string, unknown>, body: unknown): NormalizedBooking[];
}

export class NotImplementedError extends Error {
  constructor(channelCode: string, docsUrl: string) {
    super(
      `Connector for "${channelCode}" is a stub. Real integration requires partner ` +
        `credentials and endpoint work — see ${docsUrl}. In development the MockConnector ` +
        `backs this channel; set the connection to use the mock driver to exercise it.`,
    );
    this.name = 'NotImplementedError';
  }
}
