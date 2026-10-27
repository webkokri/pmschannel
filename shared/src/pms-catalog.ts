/**
 * Third-party Property Management Systems (PMS) this channel manager can connect to.
 *
 * A PMS connection reuses exactly the same `Channel` / `ChannelConnection` / `Connector`
 * machinery as an OTA (see `ota-catalog.ts`) — it's configured, tested, room-mapped and
 * synced the same way. The direction of "truth" is just inverted for availability: the
 * property's front desk operates out of the PMS, so walk-ins / phone bookings entered
 * there should flow IN as bookings (closing inventory here and fanning out to every OTA),
 * while this channel manager's OTA-driven availability/rates get pushed OUT to keep the
 * PMS calendar accurate for front-desk staff. `kind: 'both'` reflects that two-way flow.
 *
 * `docsUrl` is the vendor's own site where known; a handful of these products don't have a
 * single canonical public integration spec, so `docsUrl` is left as `'vendor-provided'` —
 * get the current credential format from the property's PMS account rep before going live.
 */
import type { OtaDefinition } from './types';

export const PMS_CATALOG: OtaDefinition[] = [
  {
    code: 'webrezpro',
    name: 'WebRezPro',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings', 'booking_ack'],
    docsUrl: 'https://www.webrezpro.com/',
    notes:
      'Cloud PMS (World Web Technologies) widely used by independent hotels, hostels, B&Bs and vacation rentals across North America. Two-way ARI sync plus reservation delivery.',
  },
  {
    code: 'atlas_pms',
    name: 'Atlas PMS',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA'],
    capabilities: ['availability', 'rates', 'bookings'],
    docsUrl: 'vendor-provided',
    notes: 'Property management system. Confirm the current API/credential format with your Atlas PMS account rep before going live.',
  },
  {
    code: 'autoclerk',
    name: 'AutoClerk',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings'],
    docsUrl: 'https://www.autoclerk.com/',
    notes: 'Cloud/on-prem PMS popular with independent and small-chain hotels. Two-way availability/rate sync and reservation delivery.',
  },
  {
    code: 'jonas_chorum',
    name: 'Jonas Chorum',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings'],
    docsUrl: 'https://www.jonashospitality.com/',
    notes: 'Enterprise PMS from Jonas Hospitality, common in resort, casino and full-service hotel portfolios. Two-way ARI and reservation interface.',
  },
  {
    code: 'cloudbeds_pms',
    name: 'Cloudbeds',
    category: 'pms',
    kind: 'both',
    authType: 'oauth2',
    markets: ['US', 'CA', 'GLOBAL'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings', 'booking_ack'],
    docsUrl: 'https://www.cloudbeds.com/',
    notes: 'All-in-one PMS platform. Connect here to keep this channel manager the single source of truth and avoid double-selling where Cloudbeds also holds distribution.',
  },
  {
    code: 'mews',
    name: 'Mews',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA', 'GLOBAL'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings'],
    docsUrl: 'https://www.mews.com/',
    notes: 'Modern cloud PMS with an open Connector API; common in boutique and lifestyle hotels.',
  },
  {
    code: 'roomkeypms',
    name: 'RoomKeyPMS',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA'],
    capabilities: ['availability', 'rates', 'bookings'],
    docsUrl: 'https://www.roomkeypms.com/',
    notes: 'Cloud PMS used by independent and small-chain North American hotels.',
  },
  {
    code: 'rms_cloud',
    name: 'RMS Cloud',
    category: 'pms',
    kind: 'both',
    authType: 'api_key',
    markets: ['US', 'CA', 'GLOBAL'],
    capabilities: ['availability', 'rates', 'restrictions', 'bookings'],
    docsUrl: 'https://www.rmscloud.com/',
    notes: 'Cloud PMS covering hotels, resorts and vacation rentals, with a published distribution API.',
  },
];

export const PMS_BY_CODE: Record<string, OtaDefinition> = Object.fromEntries(PMS_CATALOG.map((p) => [p.code, p]));
