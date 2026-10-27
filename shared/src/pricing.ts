/**
 * How a rate plan's price derives from a base rate — shared so the backend (when
 * pushing rates out to every connected OTA) and the frontend (previewing the price
 * before saving) compute the exact same number.
 */
export interface RateAdjustment {
  adjustPct: number;
  adjustFlat: number;
}

/** price = base * (1 + adjustPct/100) + adjustFlat, floored at 0, rounded to cents. */
export function applyRateAdjustment(basePrice: number, adj: RateAdjustment): number {
  const value = basePrice * (1 + adj.adjustPct / 100) + Number(adj.adjustFlat);
  return Math.max(0, Math.round(value * 100) / 100);
}
