import type { AriUpdate } from '@cm/shared';
import type { SyncJob } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { getSettings } from '../lib/settings';
import { resolveConnection } from '../connectors/registry';
import { ingestBooking } from '../engine/ingest';

const log = logger('worker');

/** Claim and process up to `limit` due sync jobs. Returns a small summary. */
export async function runDueJobs(limit = 20): Promise<{ processed: number; ok: number; failed: number }> {
  const now = new Date();
  const due = await prisma.syncJob.findMany({
    where: { status: { in: ['pending', 'failed'] }, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
  });

  let ok = 0;
  let failed = 0;
  for (const job of due) {
    // optimistic claim
    const claimed = await prisma.syncJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: 'running', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const fresh = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    const success = await processJob(fresh);
    if (success) ok++;
    else failed++;
  }

  return { processed: ok + failed, ok, failed };
}

async function processJob(job: SyncJob): Promise<boolean> {
  const started = Date.now();
  let request: unknown = null;
  let response: unknown = null;
  let message = '';
  let success = false;

  try {
    const { connector, ctx } = await resolveConnection(job.channelConnectionId);

    if (job.entityType === 'booking_ack') {
      const payload = job.payload as { externalRef: string };
      request = payload;
      if (connector.acknowledgeBooking) {
        await connector.acknowledgeBooking(ctx, payload.externalRef);
      }
      message = `Acknowledged ${payload.externalRef}`;
      success = true;
    } else {
      const updates = await buildAriUpdates(job);
      request = { entityType: job.entityType, rows: updates.length, sample: updates.slice(0, 3) };
      if (updates.length === 0) {
        message = 'No mapped rows to push';
        success = true;
      } else {
        const result = await connector.pushAri(ctx, updates);
        response = result.response ?? { accepted: result.accepted, rejected: result.rejected };
        message = result.message ?? `accepted ${result.accepted}, rejected ${result.rejected}`;
        success = result.ok;
      }
    }
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    success = false;
  }

  const durationMs = Date.now() - started;
  await prisma.syncLog.create({
    data: {
      syncJobId: job.id,
      channelConnectionId: job.channelConnectionId,
      direction: job.direction,
      entityType: job.entityType,
      ok: success,
      attempt: job.attempts,
      request: request as object,
      response: response as object,
      message,
      durationMs,
    },
  });

  if (success) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'succeeded', lastError: null, dedupeKey: null },
    });
    await prisma.channelConnection.update({
      where: { id: job.channelConnectionId },
      data: { lastPushAt: new Date(), lastError: null, status: 'connected' },
    }).catch(() => undefined);
    return true;
  }

  const settings = await getSettings();
  const backoff = settings.retryBackoffSec;
  const attempt = job.attempts; // already incremented on claim
  if (attempt >= job.maxAttempts) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'dead', lastError: message, dedupeKey: null },
    });
    await prisma.conflictAlert.create({
      data: {
        type: 'orphan_mapping',
        severity: 'medium',
        bookingIds: [],
        details: {
          message: `Sync job ${job.id} (${job.entityType}) failed permanently after ${attempt} attempts: ${message}`,
          jobId: job.id,
          channelConnectionId: job.channelConnectionId,
        },
      },
    });
    await prisma.channelConnection.update({
      where: { id: job.channelConnectionId },
      data: { lastError: message, status: 'error' },
    }).catch(() => undefined);
    log.error(`job ${job.id} dead: ${message}`);
    return false;
  }

  const delaySec = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 3600;
  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status: 'failed',
      lastError: message,
      nextRunAt: new Date(Date.now() + delaySec * 1000),
    },
  });
  log.warn(`job ${job.id} failed (attempt ${attempt}/${job.maxAttempts}), retry in ${delaySec}s: ${message}`);
  return false;
}

/** Turn a {roomTypeId, dates[]} payload into per-channel AriUpdate rows. */
async function buildAriUpdates(job: SyncJob): Promise<AriUpdate[]> {
  const payload = job.payload as { roomTypeId: string; dates: string[] };
  if (!payload?.roomTypeId || !payload.dates?.length) return [];

  const mappings = await prisma.roomMapping.findMany({
    where: { channelConnectionId: job.channelConnectionId, roomTypeId: payload.roomTypeId, active: true },
  });
  if (mappings.length === 0) return [];

  const dateObjs = payload.dates.map((d) => new Date(d + 'T00:00:00Z'));
  const days = await prisma.calendarDay.findMany({
    where: { roomTypeId: payload.roomTypeId, date: { in: dateObjs } },
  });
  const byDate = new Map(days.map((d) => [d.date.toISOString().slice(0, 10), d]));

  const updates: AriUpdate[] = [];
  for (const m of mappings) {
    for (const date of payload.dates) {
      const day = byDate.get(date);
      if (!day) continue;
      const row: AriUpdate = { externalRoomId: m.externalRoomId, externalRatePlanId: m.externalRatePlanId, date };
      if (job.entityType === 'availability') {
        row.availability = day.availableUnits;
        row.stopSell = day.stopSell || day.availableUnits === 0;
      } else if (job.entityType === 'rates') {
        row.price = Number(day.price);
      } else if (job.entityType === 'restrictions') {
        row.minStay = day.minStay;
        row.maxStay = day.maxStay || undefined;
        row.closedToArrival = day.closedToArrival;
        row.closedToDeparture = day.closedToDeparture;
        row.stopSell = day.stopSell;
      }
      updates.push(row);
    }
  }
  return updates;
}

/** Poll pull/both channels whose interval has elapsed and ingest new bookings. */
export async function pollPullChannels(): Promise<{ polled: number; ingested: number }> {
  const connections = await prisma.channelConnection.findMany({
    where: {
      enabled: true,
      importBookings: true,
      channel: { kind: { in: ['pull', 'both'] } },
    },
    include: { channel: true },
  });

  const now = Date.now();
  let polled = 0;
  let ingested = 0;

  for (const conn of connections) {
    const dueAt = conn.lastPolledAt ? conn.lastPolledAt.getTime() + conn.pullIntervalSec * 1000 : 0;
    if (now < dueAt) continue;

    try {
      const { connector, ctx } = await resolveConnection(conn.id);
      const bookings = await connector.fetchBookings(ctx, conn.lastPolledAt);
      for (const b of bookings) {
        await ingestBooking(conn.channel.code, b, { sourceConnectionId: conn.id });
        ingested++;
      }
      await prisma.channelConnection.update({
        where: { id: conn.id },
        data: { lastPolledAt: new Date(), lastError: null, status: 'connected' },
      });
      polled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Stub connectors throw NotImplementedError — record it but don't spam.
      await prisma.channelConnection.update({
        where: { id: conn.id },
        data: { lastPolledAt: new Date(), lastError: message, status: 'error' },
      });
      log.warn(`poll ${conn.channel.code} failed: ${message}`);
    }
  }

  return { polled, ingested };
}
