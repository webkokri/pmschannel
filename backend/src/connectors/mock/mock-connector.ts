import {
  addDays,
  nightsBetween,
  todayIso,
  type AriPushResult,
  type AriUpdate,
  type ConnectionTestResult,
  type NormalizedBooking,
  type OtaDefinition,
} from '@cm/shared';
import { OTA_BY_CODE } from '@cm/shared';
import { prisma } from '../../db';
import { logger } from '../../lib/logger';
import type { Connector, ConnectorContext } from '../types';

const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Devon', 'Parker'];
const LAST_NAMES = ['Nguyen', 'Patel', 'Smith', 'Tremblay', 'Garcia', 'Kim', 'Brown', 'Roy', 'Wilson', 'Martin', 'Lee', 'Cote'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Poisson sample (Knuth) for "how many bookings arrived this poll". */
function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

interface AutopilotSetting {
  enabled: boolean;
  lambdaByChannel: Record<string, number>;
  horizonDays: number;
  avgStayNights: number;
}

/**
 * A fully working stand-in for a real OTA.
 *
 *  - `pushAri`   accepts updates, adds latency, and occasionally fails
 *                transiently so the retry/backoff path is exercised.
 *  - `fetchBookings` invents bookings on each poll according to the
 *                `mock:autopilot` setting (driven from the Simulator screen).
 *  - `parseWebhook` accepts the shape the Simulator posts for push channels.
 */
export class MockConnector implements Connector {
  readonly definition: OtaDefinition;
  private log = logger('mock-connector');

  constructor(channelCode: string) {
    const def = OTA_BY_CODE[channelCode];
    if (!def) throw new Error(`Unknown channel code for mock connector: ${channelCode}`);
    this.definition = def;
  }

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const start = Date.now();
    await this.delay(120, 400);
    const mapped = ctx.roomMap.length;
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message:
        `Mock connection OK for ${this.definition.name}. ` +
        `${mapped} room mapping(s) recognised. Using the in-repo mock driver (no external API calls).`,
    };
  }

  async pushAri(ctx: ConnectorContext, updates: AriUpdate[]): Promise<AriPushResult> {
    await this.delay(80, 350);

    // ~4% transient failure to exercise retry/backoff.
    if (Math.random() < 0.04) {
      return { ok: false, accepted: 0, rejected: updates.length, message: 'Mock upstream 503 (transient)' };
    }

    // Reject clearly invalid rows (unknown external room id).
    const known = new Set(ctx.roomMap.map((m) => m.externalRoomId));
    const rejected = updates.filter((u) => !known.has(u.externalRoomId)).length;
    const accepted = updates.length - rejected;

    return {
      ok: rejected === 0,
      accepted,
      rejected,
      message:
        rejected === 0
          ? `Accepted ${accepted} ARI row(s)`
          : `Accepted ${accepted}, rejected ${rejected} (unmapped room id)`,
      response: { echo: updates.slice(0, 3), acceptedAt: new Date().toISOString() },
    };
  }

  async fetchBookings(ctx: ConnectorContext, _since: Date | null): Promise<NormalizedBooking[]> {
    const setting = (await prisma.setting.findUnique({ where: { key: 'mock:autopilot' } }))?.value as
      | AutopilotSetting
      | undefined;
    if (!setting?.enabled) return [];

    const lambda = setting.lambdaByChannel[this.definition.code] ?? setting.lambdaByChannel['*'] ?? 0;
    const count = poisson(lambda);
    if (count === 0 || ctx.roomMap.length === 0) return [];

    const out: NormalizedBooking[] = [];
    for (let i = 0; i < count; i++) {
      out.push(
        await this.inventBooking(ctx, {
          horizonDays: setting.horizonDays ?? 45,
          avgStayNights: setting.avgStayNights ?? 2,
        }),
      );
    }
    this.log.info(`${this.definition.code}: autopilot generated ${out.length} booking(s)`);
    return out;
  }

  async acknowledgeBooking(_ctx: ConnectorContext, externalRef: string): Promise<void> {
    await this.delay(50, 150);
    this.log.debug(`${this.definition.code}: acknowledged ${externalRef}`);
  }

  parseWebhook(
    ctx: ConnectorContext,
    _headers: Record<string, unknown>,
    body: unknown,
  ): NormalizedBooking[] {
    const arr = Array.isArray(body) ? body : [body];
    return arr.map((b) => this.coerce(ctx, b as Record<string, unknown>));
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  invent(
    ctx: ConnectorContext,
    opts?: { horizonDays?: number; avgStayNights?: number },
  ): Promise<NormalizedBooking> {
    return this.inventBooking(ctx, { horizonDays: opts?.horizonDays ?? 45, avgStayNights: opts?.avgStayNights ?? 2 });
  }

  private async inventBooking(
    ctx: ConnectorContext,
    opts: { horizonDays: number; avgStayNights: number },
  ): Promise<NormalizedBooking> {
    const mapping = rand(ctx.roomMap);
    const startOffset = Math.floor(Math.random() * opts.horizonDays);
    const stay = Math.max(1, Math.round(opts.avgStayNights + (Math.random() * 2 - 1) * 2));
    const checkIn = addDays(todayIso(), startOffset);
    const checkOut = addDays(checkIn, stay);
    const stayNights = nightsBetween(checkIn, checkOut);
    const guest = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;

    // Price the stay from the live calendar (± up to 3% "OTA rounding") so
    // simulated bookings normally match — a real mismatch stays meaningful.
    const days = await prisma.calendarDay.findMany({
      where: {
        roomTypeId: mapping.roomTypeId,
        date: { in: stayNights.map((d) => new Date(d + 'T00:00:00Z')) },
      },
      select: { price: true },
    });
    const calendarTotal = days.reduce((s, d) => s + Number(d.price), 0);
    const fallbackNightly = 120 + Math.floor(Math.random() * 120);
    const base = calendarTotal > 0 ? calendarTotal : fallbackNightly * stayNights.length;
    const amount = Math.round(base * (0.985 + Math.random() * 0.03));

    return {
      externalRef: `${this.definition.code.toUpperCase()}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,
      status: 'confirmed',
      channelCode: this.definition.code,
      propertyCode: ctx.propertyCode,
      externalRoomId: mapping.externalRoomId,
      externalRatePlanId: mapping.externalRatePlanId,
      guestName: guest,
      guestEmail: `${guest.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      checkIn,
      checkOut,
      units: 1,
      currency: 'USD',
      amount,
      bookedAt: new Date().toISOString(),
      raw: { source: 'mock-autopilot', channel: this.definition.code },
    };
  }

  private coerce(ctx: ConnectorContext, b: Record<string, unknown>): NormalizedBooking {
    const checkIn = String(b.checkIn ?? b.arrival ?? todayIso());
    const checkOut = String(b.checkOut ?? b.departure ?? addDays(checkIn, 1));
    const nights = nightsBetween(checkIn, checkOut).length || 1;
    return {
      externalRef: String(b.externalRef ?? b.id ?? `${this.definition.code}-${Date.now()}`),
      status: (b.status as NormalizedBooking['status']) ?? 'confirmed',
      channelCode: this.definition.code,
      propertyCode: String(b.propertyCode ?? ctx.propertyCode),
      externalRoomId: String(b.externalRoomId ?? b.roomId ?? ctx.roomMap[0]?.externalRoomId ?? ''),
      externalRatePlanId: (b.externalRatePlanId as string) ?? null,
      guestName: String(b.guestName ?? b.guest ?? 'Guest'),
      guestEmail: (b.guestEmail as string) ?? null,
      checkIn,
      checkOut,
      units: Number(b.units ?? 1),
      currency: String(b.currency ?? 'USD'),
      amount: Number(b.amount ?? (Number(b.nightlyRate ?? 150) * nights)),
      bookedAt: (b.bookedAt as string) ?? new Date().toISOString(),
      raw: b,
    };
  }

  private delay(min: number, max: number) {
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }
}
