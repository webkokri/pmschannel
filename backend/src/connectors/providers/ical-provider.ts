import { OTA_BY_CODE, type AriPushResult, type AriUpdate, type ConnectionTestResult, type NormalizedBooking, type OtaDefinition } from '@cm/shared';
import { prisma } from '../../db';
import { assertPublicHttpUrl, UnsafeUrlError } from '../../lib/safe-fetch';
import { BaseConnector } from '../base-connector';
import type { ConnectorContext } from '../types';
import { parseIcs } from './ical-format';

/**
 * Real, working iCal sync — the one "channel" every booking platform supports
 * without a partner API agreement (Airbnb, Vrbo, and most small OTAs publish a
 * calendar export URL even where no deeper API access exists). Pulling it is
 * exactly as real-time as that platform's own feed refresh, which is typically
 * minutes, not seconds — treat it as a safety net underneath the push-based
 * channels, not a replacement for them.
 *
 * One connection = one calendar = one room (set the room mapping's
 * `externalRoomId` to anything stable; it only needs to be consistent across
 * polls of this connection).
 *
 * This platform's own availability is exposed the same way, outbound, at
 * `GET /api/ical/:connectionId.ics` (see `modules/ical-export.ts`) — point the
 * other platform's "import a calendar" field at that URL to close the loop.
 */
export class IcalProvider extends BaseConnector {
  readonly definition: OtaDefinition = OTA_BY_CODE['ical_generic'];

  async testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const { icalUrl } = ctx.credentials as Record<string, string>;
    if (!icalUrl) return { ok: false, message: 'Missing icalUrl in credentials — paste the feed URL from the other platform.' };

    const start = Date.now();
    try {
      const url = await assertPublicHttpUrl(icalUrl);
      // `redirect: 'error'` refuses to silently follow a 3xx to a different host —
      // otherwise a feed could pass this check then redirect the server to an
      // internal address on the actual fetch, bypassing the validation above.
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!res.ok) return { ok: false, message: `Feed returned HTTP ${res.status}.`, latencyMs: Date.now() - start };
      const events = parseIcs(await res.text());
      return { ok: true, latencyMs: Date.now() - start, message: `Fetched the feed and parsed ${events.length} event(s).` };
    } catch (err) {
      if (err instanceof UnsafeUrlError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async pushAri(_ctx: ConnectorContext, _updates: AriUpdate[]): Promise<AriPushResult> {
    // This platform's availability is exposed as an outbound .ics feed (pulled by
    // the other side on its own schedule) rather than pushed — see module docblock.
    return { ok: true, accepted: 0, rejected: 0, message: 'iCal is export-only on this side — see the "your feed URL" link on this connection.' };
  }

  async fetchBookings(ctx: ConnectorContext, _since: Date | null): Promise<NormalizedBooking[]> {
    const { icalUrl } = ctx.credentials as Record<string, string>;
    if (!icalUrl) throw new Error('Missing icalUrl in credentials.');

    const url = await assertPublicHttpUrl(icalUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!res.ok) throw new Error(`iCal feed returned HTTP ${res.status}`);
    const events = parseIcs(await res.text());
    const externalRoomId = ctx.roomMap[0]?.externalRoomId ?? 'ical';
    const currentUids = new Set(events.map((e) => e.uid));

    const out: NormalizedBooking[] = events.map((e) => ({
      externalRef: e.uid,
      status: 'confirmed',
      channelCode: 'ical_generic',
      propertyCode: ctx.propertyCode,
      externalRoomId,
      externalRatePlanId: null,
      guestName: e.summary || 'iCal booking',
      guestEmail: null,
      checkIn: e.start,
      checkOut: e.end,
      units: 1,
      currency: 'USD',
      amount: 0,
      raw: { source: 'ical', uid: e.uid },
    }));

    // Reconcile: a UID we previously ingested from this feed that's no longer
    // present has been removed upstream (cancelled, dates changed) — release the
    // inventory here too rather than leaving it blocked forever.
    const stillActive = await prisma.booking.findMany({
      where: {
        sourceChannel: { code: 'ical_generic' },
        propertyId: ctx.propertyId,
        externalRoomId,
        status: { in: ['confirmed', 'modified'] },
      },
      select: { externalRef: true, checkIn: true, checkOut: true },
    });
    for (const b of stillActive) {
      if (currentUids.has(b.externalRef)) continue;
      out.push({
        externalRef: b.externalRef,
        status: 'cancelled',
        channelCode: 'ical_generic',
        propertyCode: ctx.propertyCode,
        externalRoomId,
        externalRatePlanId: null,
        guestName: 'iCal booking',
        guestEmail: null,
        checkIn: b.checkIn.toISOString().slice(0, 10),
        checkOut: b.checkOut.toISOString().slice(0, 10),
        units: 1,
        currency: 'USD',
        amount: 0,
        raw: { source: 'ical', uid: b.externalRef, reconciled: 'removed-from-feed' },
      });
    }

    return out;
  }
}
