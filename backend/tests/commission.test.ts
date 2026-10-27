import { describe, expect, it } from 'vitest';
import { splitCommission } from '../src/lib/commission';

describe('splitCommission', () => {
  it('computes commission and net from a basis-point rate', () => {
    const split = splitCommission(10_000, 250); // $100.00 at 2.5%
    expect(split).toEqual({ rateBps: 250, amountCents: 10_000, commissionCents: 250, netCents: 9_750 });
  });

  it('rounds to the nearest cent rather than truncating', () => {
    // 333 * 250 / 10000 = 8.325 -> rounds to 8
    expect(splitCommission(333, 250).commissionCents).toBe(8);
    // 337 * 250 / 10000 = 8.425 -> rounds to 8
    expect(splitCommission(337, 250).commissionCents).toBe(8);
    // 350 * 250 / 10000 = 8.75 -> rounds to 9
    expect(splitCommission(350, 250).commissionCents).toBe(9);
  });

  it('a zero rate takes no commission', () => {
    expect(splitCommission(50_000, 0)).toEqual({ rateBps: 0, amountCents: 50_000, commissionCents: 0, netCents: 50_000 });
  });

  it('commission + net always reconstitutes the original amount', () => {
    for (const amount of [1, 99, 1000, 123_456, 999_999]) {
      for (const bps of [0, 100, 250, 500, 1000]) {
        const split = splitCommission(amount, bps);
        expect(split.commissionCents + split.netCents).toBe(amount);
      }
    }
  });
});
