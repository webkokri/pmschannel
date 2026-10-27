import { addDays, nightsBetween, todayIso } from '@cm/shared';
import type { PricingRuleType } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { enqueueAriForEdit } from './ari';

const log = logger('engine:pricing');

interface RuleConditions {
  minOccupancyPct?: number;
  maxOccupancyPct?: number;
  weekdays?: number[]; // 0=Sun..6=Sat
  maxDaysOut?: number;
  minDaysOut?: number;
  minNights?: number;
}

function ruleMatches(
  type: PricingRuleType,
  conditions: RuleConditions,
  ctx: { occupancyPct: number; weekday: number; daysOut: number; minStay: number },
): boolean {
  switch (type) {
    case 'occupancy_based':
      return ctx.occupancyPct >= (conditions.minOccupancyPct ?? 0) && ctx.occupancyPct <= (conditions.maxOccupancyPct ?? 100);
    case 'day_of_week':
      return (conditions.weekdays ?? []).includes(ctx.weekday);
    case 'lead_time':
      return ctx.daysOut <= (conditions.maxDaysOut ?? 9999) && ctx.daysOut >= (conditions.minDaysOut ?? 0);
    case 'length_of_stay':
      // Ties the rule to an actual per-date field (the minimum-stay policy already on the
      // calendar) rather than a real per-booking length, which isn't a per-date property.
      return ctx.minStay >= (conditions.minNights ?? 1);
  }
}

export interface ApplyRulesResult {
  roomsScanned: number;
  datesChanged: number;
}

/**
 * Recomputes price for every date in [from, to) where at least one active pricing rule
 * matches, always from the room's stable `basePrice` (never compounding on the previous
 * run's output) — so re-running is idempotent and dates with no matching rule are left
 * untouched (manual edits elsewhere on the calendar are preserved). Changes are logged to
 * `PricingLog` and fanned out to channels exactly like a manual calendar edit.
 */
export async function applyPricingRules(
  organizationId: string,
  propertyId: string,
  opts: { roomTypeId?: string; from: string; to: string },
): Promise<ApplyRulesResult> {
  const rooms = await prisma.roomType.findMany({ where: { propertyId, id: opts.roomTypeId } });
  const dates = nightsBetween(opts.from, opts.to);
  const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));
  const todayObj = new Date(todayIso() + 'T00:00:00Z');

  let datesChanged = 0;

  for (const room of rooms) {
    const rules = await prisma.pricingRule.findMany({
      where: { organizationId, propertyId, active: true, OR: [{ roomTypeId: room.id }, { roomTypeId: null }] },
      orderBy: { priority: 'asc' },
    });
    if (rules.length === 0) continue;

    const days = await prisma.calendarDay.findMany({ where: { roomTypeId: room.id, date: { in: dateObjs } } });
    const dayMap = new Map(days.map((d) => [d.date.toISOString().slice(0, 10), d]));

    const nightsAgg = await prisma.bookingNight.groupBy({
      by: ['date'],
      where: { date: { in: dateObjs }, booking: { roomTypeId: room.id, status: { in: ['confirmed', 'modified'] } } },
      _sum: { units: true },
    });
    const bookedMap = new Map(nightsAgg.map((n) => [n.date.toISOString().slice(0, 10), n._sum.units ?? 0]));

    const changedDates: string[] = [];

    for (const date of dates) {
      const dateObj = new Date(date + 'T00:00:00Z');
      const day = dayMap.get(date);
      const occupancyPct = room.totalUnits > 0 ? ((bookedMap.get(date) ?? 0) / room.totalUnits) * 100 : 0;
      const ctx = {
        occupancyPct,
        weekday: dateObj.getUTCDay(),
        daysOut: Math.round((dateObj.getTime() - todayObj.getTime()) / 86_400_000),
        minStay: day?.minStay ?? 1,
      };

      let totalPct = 0;
      const matchedNames: string[] = [];
      let lastMatchedRuleId: string | null = null;
      for (const rule of rules) {
        if (ruleMatches(rule.type, rule.conditions as RuleConditions, ctx)) {
          totalPct += rule.adjustPct;
          matchedNames.push(rule.name);
          lastMatchedRuleId = rule.id;
        }
      }
      if (matchedNames.length === 0) continue;

      const newPrice = Math.max(0, Math.round(Number(room.basePrice) * (1 + totalPct / 100)));
      const previousPrice = day ? Number(day.price) : Number(room.basePrice);
      if (newPrice === previousPrice) continue;

      await prisma.calendarDay.upsert({
        where: { roomTypeId_date: { roomTypeId: room.id, date: dateObj } },
        update: { price: newPrice },
        create: { roomTypeId: room.id, date: dateObj, price: newPrice, availableUnits: room.totalUnits },
      });
      await prisma.pricingLog.create({
        data: {
          organizationId,
          roomTypeId: room.id,
          date: dateObj,
          ruleId: lastMatchedRuleId,
          ruleName: matchedNames.join(', '),
          previousPrice,
          newPrice,
          reason: `${matchedNames.length} rule(s) matched (${totalPct >= 0 ? '+' : ''}${totalPct}%)`,
        },
      });
      changedDates.push(date);
      datesChanged++;
    }

    if (changedDates.length > 0) {
      await enqueueAriForEdit(room.id, changedDates, ['rates']);
      log.info(`RMS: ${changedDates.length} date(s) repriced for room ${room.id}`);
    }
  }

  return { roomsScanned: rooms.length, datesChanged };
}

/** Nightly run — every property/room with at least one active rule, next 90 days. */
export async function runNightlyPricing(): Promise<void> {
  const properties = await prisma.property.findMany({
    where: { pricingRules: { some: { active: true } } },
    select: { id: true, organizationId: true },
  });
  const from = todayIso();
  const horizon = addDays(from, 90);
  for (const property of properties) {
    try {
      await applyPricingRules(property.organizationId, property.id, { from, to: horizon });
    } catch (err) {
      log.error(`nightly pricing failed for property ${property.id}`, err);
    }
  }
}
