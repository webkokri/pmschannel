import { prisma } from '../db';
import { getPlatformSetting } from './platform-settings';

/** Platform default, in basis points (100 bps = 1%). Overridable per org and from
 *  the super admin's Platform Settings screen (`PlatformSetting["commission:defaultRateBps"]`). */
export const FALLBACK_COMMISSION_RATE_BPS = 250; // 2.5%

/** The rate that actually applies to a given organization right now. */
export async function getCommissionRateBps(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { commissionRateBps: true },
  });
  if (org?.commissionRateBps != null) return org.commissionRateBps;
  const platformDefault = await getPlatformSetting<number>('commission:defaultRateBps');
  return platformDefault ?? FALLBACK_COMMISSION_RATE_BPS;
}

export interface CommissionSplit {
  rateBps: number;
  amountCents: number;
  commissionCents: number;
  netCents: number;
}

/** Pure math, no I/O — kept separate from `getCommissionRateBps` so it's trivially
 *  unit-testable and so callers that already captured a rate (e.g. reading it back off a
 *  historical `Payment` row) can reuse the exact same rounding rule. */
export function splitCommission(amountCents: number, rateBps: number): CommissionSplit {
  const commissionCents = Math.round((amountCents * rateBps) / 10_000);
  return { rateBps, amountCents, commissionCents, netCents: amountCents - commissionCents };
}

export async function computeCommission(organizationId: string, amountCents: number): Promise<CommissionSplit> {
  const rateBps = await getCommissionRateBps(organizationId);
  return splitCommission(amountCents, rateBps);
}

export function formatBpsAsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
