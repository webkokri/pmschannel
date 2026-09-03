import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, notFound } from '../lib/http';
import { requireRole } from '../auth';
import { pollPullChannels, runDueJobs } from '../worker/job-runner';

export const syncRouter = Router();

syncRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status).split(',') : undefined;
    const jobs = await prisma.syncJob.findMany({
      where: { status: status ? { in: status as never[] } : undefined },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        channelConnection: {
          select: { channel: { select: { name: true, code: true } }, property: { select: { name: true } } },
        },
      },
    });
    res.json({ jobs });
  }),
);

syncRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const where = {
      ok: q.ok === undefined ? undefined : q.ok === 'true',
      direction: q.direction ? String(q.direction) : undefined,
      entityType: q.entityType ? String(q.entityType) : undefined,
      channelConnectionId: q.connectionId ? String(q.connectionId) : undefined,
    };
    const [total, logs] = await Promise.all([
      prisma.syncLog.count({ where }),
      prisma.syncLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channelConnection: {
            select: { channel: { select: { name: true, code: true } }, property: { select: { name: true } } },
          },
        },
      }),
    ]);
    res.json({ total, page, pageSize, logs });
  }),
);

syncRouter.post(
  '/jobs/:id/retry',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const job = await prisma.syncJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound('Job not found');
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'pending', nextRunAt: new Date(), attempts: 0, lastError: null },
    });
    const result = await runDueJobs(1);
    res.json({ retried: true, result });
  }),
);

/** Manually kick the worker loop (handy in dev / demos). */
syncRouter.post(
  '/run',
  requireRole('manager'),
  asyncHandler(async (_req, res) => {
    const jobs = await runDueJobs(100);
    const poll = await pollPullChannels();
    res.json({ jobs, poll });
  }),
);

syncRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [pending, failed, dead, succeeded24h, failed24h] = await Promise.all([
      prisma.syncJob.count({ where: { status: 'pending' } }),
      prisma.syncJob.count({ where: { status: 'failed' } }),
      prisma.syncJob.count({ where: { status: 'dead' } }),
      prisma.syncLog.count({ where: { ok: true, createdAt: { gte: since(24) } } }),
      prisma.syncLog.count({ where: { ok: false, createdAt: { gte: since(24) } } }),
    ]);
    res.json({ pending, failed, dead, succeeded24h, failed24h });
  }),
);

function since(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}
