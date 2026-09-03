import { prisma } from '../db';

/** Application settings with typed defaults. Stored one row per key in `Setting`. */
export interface AppSettings {
  /** Reject inbound bookings that would oversell; otherwise just raise a conflict. */
  autoProtectOverbooking: boolean;
  /** Also raise a conflict when a booking's price differs materially from the calendar. */
  detectRateMismatch: boolean;
  /** Absolute + relative tolerance before a price delta counts as a mismatch. */
  rateMismatchAbs: number;
  rateMismatchPct: number;
  defaultCurrency: string;
  /** Backoff schedule (seconds) for failed sync jobs, by attempt index. */
  retryBackoffSec: number[];
  /** Close a room on every channel as soon as it hits zero availability. */
  stopSellOnZero: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoProtectOverbooking: true,
  detectRateMismatch: true,
  rateMismatchAbs: 5,
  rateMismatchPct: 0.1,
  defaultCurrency: 'USD',
  retryBackoffSec: [30, 120, 600, 1800, 3600, 7200],
  stopSellOnZero: true,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...(map as Partial<AppSettings>) };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await Promise.all(
    Object.entries(patch).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: value as never },
        update: { value: value as never },
      }),
    ),
  );
  return getSettings();
}
