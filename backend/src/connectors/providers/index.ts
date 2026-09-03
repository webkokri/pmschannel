import { OTA_CATALOG } from '@cm/shared';
import type { Connector } from '../types';
import { GenericProviderConnector } from './generic-provider';
import { BookingComProvider } from './booking-com-provider';
import { AirbnbProvider } from './airbnb-provider';

type ProviderFactory = () => Connector;

/**
 * Real-provider connector factories. Anything not listed here falls back to a
 * GenericProviderConnector stub built from its catalogue entry, so every OTA in
 * the catalogue has a real connector object with the correct metadata.
 */
const DEDICATED: Record<string, ProviderFactory> = {
  booking_com: () => new BookingComProvider(),
  booking_com_ca: () => new BookingComProvider(),
  airbnb: () => new AirbnbProvider(),
};

export const PROVIDER_FACTORIES: Record<string, ProviderFactory> = Object.fromEntries(
  OTA_CATALOG.map((def) => [
    def.code,
    DEDICATED[def.code] ?? (() => new GenericProviderConnector(def)),
  ]),
);
