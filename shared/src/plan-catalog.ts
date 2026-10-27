/**
 * Default subscription packages, seeded once as `Plan` rows. The super admin can edit
 * prices/limits/names afterwards from the admin console — this is just the starting
 * catalogue, not a hardcoded source of truth at runtime.
 *
 * Property count is the primary axis: 1 property fits Starter, up to 3 needs Growth,
 * more needs Enterprise.
 */
import type { PlanLimits } from './types';

export interface DefaultPlan {
  code: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  sortOrder: number;
  limits: PlanLimits;
}

export const DEFAULT_PLANS: DefaultPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a single independent property getting started with channel management.',
    priceMonthlyCents: 4900,
    priceYearlyCents: 4900 * 10, // ~2 months free
    sortOrder: 1,
    limits: {
      maxProperties: 1,
      maxRoomTypesPerProperty: 10,
      maxChannelConnections: 3,
      maxUsers: 2,
      channelCategories: ['direct_misc', 'global'],
    },
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For small groups running up to three properties across more channels.',
    priceMonthlyCents: 14900,
    priceYearlyCents: 14900 * 10,
    sortOrder: 2,
    limits: {
      maxProperties: 3,
      maxRoomTypesPerProperty: 25,
      maxChannelConnections: 10,
      maxUsers: 5,
      channelCategories: ['direct_misc', 'global', 'north_america', 'pms'],
    },
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'For multi-property portfolios needing every channel, including GDS.',
    priceMonthlyCents: 39900,
    priceYearlyCents: 39900 * 10,
    sortOrder: 3,
    limits: {
      maxProperties: 25,
      maxRoomTypesPerProperty: 999,
      maxChannelConnections: 999,
      maxUsers: 20,
      channelCategories: ['direct_misc', 'global', 'north_america', 'pms'],
    },
  },
];

export const DEFAULT_TRIAL_PLAN_CODE = 'starter';

/**
 * The "Accelerator" — a paid add-on (not part of any plan) that fans a property out to
 * more OTA channels in one purchase, bypassing the plan's channel-connection limit. This
 * is the default bundle and price; the super admin can change both from Platform Settings
 * (`PlatformSetting["accelerator:channelCodes"]` / `["accelerator:priceCents"]`).
 */
export const DEFAULT_ACCELERATOR_CHANNEL_CODES = ['agoda', 'hopper', 'tripadvisor', 'redawning', 'travelnest', 'google_hotel_ads'];
export const DEFAULT_ACCELERATOR_PRICE_CENTS = 19900; // $199 one-time
export const DEFAULT_TRIAL_DAYS = 14;
