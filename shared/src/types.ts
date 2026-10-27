/**
 * Cross-cutting types shared by the backend engine, the connector framework and
 * the admin frontend. Kept dependency-free on purpose.
 */

export type IsoDate = string; // 'YYYY-MM-DD'

export type ChannelCategory = 'global' | 'north_america' | 'direct_misc' | 'pms';

/** How a channel exchanges data with us. */
export type ChannelKind = 'push' | 'pull' | 'both';

export type AuthType =
  | 'none'
  | 'api_key'
  | 'basic'
  | 'oauth2'
  | 'hotel_id_password'
  | 'ical_url'
  | 'gds_pseudo_city';

export type ChannelCapability =
  | 'availability'
  | 'rates'
  | 'restrictions'
  | 'bookings'
  | 'booking_ack'
  | 'content';

export interface OtaDefinition {
  code: string;
  name: string;
  category: ChannelCategory;
  kind: ChannelKind;
  authType: AuthType;
  /** Markets where the OTA is relevant for this product. */
  markets: Array<'US' | 'CA' | 'GLOBAL'>;
  capabilities: ChannelCapability[];
  docsUrl: string;
  /** Short note describing the integration surface / protocol. */
  notes: string;
}

/** A normalized booking produced by a connector's `parseBooking`. */
export interface NormalizedBooking {
  /** Stable id from the OTA. Unique per channel. */
  externalRef: string;
  status: BookingStatus;
  channelCode: string;
  propertyCode: string;
  /** Connector's room identifier — resolved to a RoomType via RoomMapping. */
  externalRoomId: string;
  externalRatePlanId?: string | null;
  guestName: string;
  guestEmail?: string | null;
  checkIn: IsoDate;
  checkOut: IsoDate;
  units: number;
  currency: string;
  amount: number;
  /** Untouched original payload, stored for audit / debugging. */
  raw: unknown;
  bookedAt?: string;
}

export type BookingStatus =
  | 'confirmed'
  | 'modified'
  | 'cancelled'
  | 'rejected';

/** One field of Availability / Rates / Inventory to push out to a channel. */
export interface AriUpdate {
  externalRoomId: string;
  externalRatePlanId?: string | null;
  date: IsoDate;
  availability?: number;
  price?: number;
  minStay?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
}

export interface AriPushResult {
  ok: boolean;
  accepted: number;
  rejected: number;
  message?: string;
  /** Raw provider response, for the sync log. */
  response?: unknown;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export type ConflictType =
  | 'overbooking'
  | 'double_booking'
  | 'rate_mismatch'
  | 'orphan_mapping';

export type ConflictStatus = 'open' | 'acknowledged' | 'resolved';

export type SyncJobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead';

export type SyncEntity =
  | 'availability'
  | 'rates'
  | 'restrictions'
  | 'booking_ack';

export type UserRole = 'admin' | 'manager' | 'viewer';

// ── SaaS: organizations, plans, subscriptions ──────────────────────────────

export type OrganizationStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';

export type BillingCycle = 'monthly' | 'yearly';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

/** Limits carried on `Plan.limits` (JSON) — the primary axis is property count. */
export interface PlanLimits {
  maxProperties: number;
  maxRoomTypesPerProperty: number;
  maxChannelConnections: number;
  maxUsers: number;
  /** Which OTA catalogue categories this plan may connect. */
  channelCategories: ChannelCategory[];
}

/** Resource keys `assertWithinLimit` can check against a plan's limits. */
export type LimitKey = 'properties' | 'roomTypesPerProperty' | 'channelConnections' | 'users';
