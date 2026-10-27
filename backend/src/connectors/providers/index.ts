import { FULL_CHANNEL_CATALOG } from '@cm/shared';
import type { Connector } from '../types';
import { GenericProviderConnector } from './generic-provider';
import { BookingComProvider } from './booking-com-provider';
import { AirbnbProvider } from './airbnb-provider';
import { IcalProvider } from './ical-provider';

type ProviderFactory = () => Connector;

/**
 * Real-provider connector factories. Anything not listed here falls back to a
 * GenericProviderConnector stub built from its catalogue entry, so every OTA and
 * PMS in the combined catalogue has a real connector object with the correct
 * metadata.
 *
 * `ical_generic` is the one entry here that's actually fully implemented against
 * a live external endpoint rather than a stub — see `ical-provider.ts`. Every OTA
 * API (booking_com, airbnb, etc.) requires a signed partner agreement this
 * environment doesn't have credentials for, so those stay honest stubs until real
 * credentials are supplied.
 */
const DEDICATED: Record<string, ProviderFactory> = {
  booking_com: () => new BookingComProvider(),
  booking_com_ca: () => new BookingComProvider(),
  airbnb: () => new AirbnbProvider(),
  ical_generic: () => new IcalProvider(),
};

export const PROVIDER_FACTORIES: Record<string, ProviderFactory> = Object.fromEntries(
  FULL_CHANNEL_CATALOG.map((def) => [
    def.code,
    DEDICATED[def.code] ?? (() => new GenericProviderConnector(def)),
  ]),
);
