export * from './types';
export * from './ota-catalog';
export * from './pms-catalog';
export * from './plan-catalog';
export * from './pricing';

import type { OtaDefinition } from './types';
import { OTA_CATALOG, OTA_BY_CODE } from './ota-catalog';
import { PMS_CATALOG, PMS_BY_CODE } from './pms-catalog';

/** Every distribution channel AND every third-party PMS, combined — the full seed list. */
export const FULL_CHANNEL_CATALOG: OtaDefinition[] = [...OTA_CATALOG, ...PMS_CATALOG];
export const FULL_CHANNEL_BY_CODE: Record<string, OtaDefinition> = { ...OTA_BY_CODE, ...PMS_BY_CODE };

/** Inclusive-start / exclusive-end list of night dates for a stay. */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const d = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
