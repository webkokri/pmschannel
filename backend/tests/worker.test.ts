import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from '../src/connectors/types';

const h = vi.hoisted(() => ({
  ROOM_ID: { value: '' },
  state: {
    pushImpl: async (_ctx: unknown, updates: { length: number }) => ({
      ok: true,
      accepted: updates.length,
      rejected: 0,
    }),
  } as { pushImpl: Connector['pushAri'] },
}));
const ROOM_ID = h.ROOM_ID;
const state = h.state;

// Controllable fake connector for every connection the worker resolves.
vi.mock('../src/connectors/registry', () => ({
  resolveConnection: vi.fn(async (connectionId: string) => ({
    driver: 'mock' as const,
    ctx: {
      connectionId,
      propertyId: 'p',
      propertyCode: 'P',
      channelCode: 'fake',
      credentials: {},
      roomMap: [{ roomTypeId: h.ROOM_ID.value, ratePlanId: null, externalRoomId: 'fake-R1', externalRatePlanId: '' }],
    },
    connector: {
      definition: {},
      testConnection: async () => ({ ok: true, message: 'ok' }),
      pushAri: (ctx: unknown, updates: unknown) => h.state.pushImpl(ctx as never, updates as never),
      fetchBookings: async () => [],
      acknowledgeBooking: async () => undefined,
    },
  })),
}));

import { prisma } from '../src/db';
import { cleanWorld, isoDate, makeWorld } from './helpers';
import { runDueJobs } from '../src/worker/job-runner';
import { enqueueAvailabilityFanout, recomputeAvailability } from '../src/engine/ari';

let world: Awaited<ReturnType<typeof makeWorld>>;
let target: string; // airbnb connection id — the one we assert on
let other: string; // booking_com connection id — excluded from fan-out

beforeAll(async () => {
  await cleanWorld();
  world = await makeWorld({ capacity: 3, channels: ['booking_com', 'airbnb'] });
  ROOM_ID.value = world.room.id;
  target = world.connections.airbnb;
  other = world.connections.booking_com;
});

afterAll(async () => {
  await cleanWorld();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // The worker drains jobs globally; clear everything for this suite's property
  // plus any pending jobs left by other suites, so counters stay deterministic.
  await prisma.syncLog.deleteMany({ where: { channelConnection: { propertyId: world.property.id } } });
  await prisma.syncJob.deleteMany({ where: { channelConnection: { propertyId: world.property.id } } });
  await prisma.syncJob.deleteMany({ where: { status: { in: ['pending', 'failed', 'running'] } } });
  await prisma.conflictAlert.deleteMany({ where: { roomTypeId: world.room.id } });
  h.state.pushImpl = async (_ctx: unknown, updates: { length: number }) => ({
    ok: true,
    accepted: updates.length,
    rejected: 0,
  });
});

async function queueOne(dates: string[]) {
  await recomputeAvailability(world.room.id, dates);
  await enqueueAvailabilityFanout(world.room.id, dates, { reason: 'test', excludeConnectionId: other });
  return prisma.syncJob.findFirstOrThrow({ where: { channelConnectionId: target } });
}

describe('sync worker', () => {
  it('pushes availability, marks the job succeeded and writes a log', async () => {
    const queued = await queueOne([isoDate(2), isoDate(3)]);
    await runDueJobs(50);

    const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(job.status).toBe('succeeded');
    expect(job.dedupeKey).toBeNull();

    // exactly one job existed for our (excluded-peer) fan-out target
    const jobCount = await prisma.syncJob.count({ where: { channelConnectionId: target } });
    expect(jobCount).toBe(1);
    const otherCount = await prisma.syncJob.count({ where: { channelConnectionId: other } });
    expect(otherCount).toBe(0);

    const log = await prisma.syncLog.findFirst({
      where: { channelConnectionId: target },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.ok).toBe(true);
  });

  it('coalesces repeated edits into one job via dedupeKey', async () => {
    await queueOne([isoDate(2)]);
    await enqueueAvailabilityFanout(world.room.id, [isoDate(3), isoDate(4)], { reason: 'test', excludeConnectionId: other });
    const jobs = await prisma.syncJob.findMany({ where: { channelConnectionId: target } });
    expect(jobs.length).toBe(1);
    expect((jobs[0].payload as { dates: string[] }).dates).toEqual([isoDate(2), isoDate(3), isoDate(4)]);
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    let calls = 0;
    state.pushImpl = async (_ctx, updates) => {
      calls++;
      if (calls === 1) return { ok: false, accepted: 0, rejected: updates.length, message: '503 transient' };
      return { ok: true, accepted: updates.length, rejected: 0 };
    };

    const job = await queueOne([isoDate(5)]);
    await runDueJobs(50);

    const failed = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(1);
    expect(failed.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.syncJob.update({ where: { id: job.id }, data: { nextRunAt: new Date(0) } });
    await runDueJobs(50);
    const done = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('succeeded');
    expect(calls).toBe(2);
  });

  it('moves a job to dead after maxAttempts and raises an alert', async () => {
    state.pushImpl = async () => ({ ok: false, accepted: 0, rejected: 1, message: 'permanent' });

    const job = await queueOne([isoDate(7)]);
    await prisma.syncJob.update({ where: { id: job.id }, data: { maxAttempts: 2 } });

    await runDueJobs(10); // attempt 1 → failed
    await prisma.syncJob.update({ where: { id: job.id }, data: { nextRunAt: new Date(0) } });
    await runDueJobs(10); // attempt 2 → dead

    const dead = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(dead.status).toBe('dead');

    const alert = await prisma.conflictAlert.findFirst({
      where: { type: 'orphan_mapping', details: { path: ['jobId'], equals: job.id } },
    });
    expect(alert).toBeTruthy();
  });
});
