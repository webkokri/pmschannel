import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg } from '../lib/tenant';
import { assertWithinLimit } from '../lib/limits';
import { getSettings, updateSettings } from '../lib/settings';

export const usersRouter = Router();
usersRouter.use(requireOrg);

usersRouter.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });
    res.json({ users });
  }),
);

const userInput = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'viewer']),
  password: z.string().min(8).optional(),
  active: z.boolean().optional(),
});

usersRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(userInput.extend({ password: z.string().min(8) }), req.body);
    await assertWithinLimit(organizationId, 'users');
    const user = await prisma.user.create({
      data: {
        organizationId,
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        active: body.active ?? true,
        passwordHash: await bcrypt.hash(body.password, 10),
      },
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    res.status(201).json({ user });
  }),
);

async function assertUserOwned(id: string, organizationId: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.organizationId !== organizationId) throw notFound('User not found');
  return user;
}

usersRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await assertUserOwned(req.params.id, req.user!.organizationId!);
    const body = parse(userInput.partial(), req.body);
    const data: Record<string, unknown> = {};
    if (body.email) data.email = body.email.toLowerCase();
    if (body.name) data.name = body.name;
    if (body.role) data.role = body.role;
    if (body.active !== undefined) data.active = body.active;
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    res.json({ user });
  }),
);

usersRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await assertUserOwned(req.params.id, req.user!.organizationId!);
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Settings (mounted here for convenience) ────────────────────────────────

export const settingsRouter = Router();
settingsRouter.use(requireOrg);

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ settings: await getSettings(req.user!.organizationId!) });
  }),
);

const settingsInput = z
  .object({
    autoProtectOverbooking: z.boolean(),
    detectRateMismatch: z.boolean(),
    rateMismatchAbs: z.number().min(0),
    rateMismatchPct: z.number().min(0).max(1),
    defaultCurrency: z.string().min(3).max(3),
    retryBackoffSec: z.array(z.number().int().min(1)),
    stopSellOnZero: z.boolean(),
  })
  .partial();

settingsRouter.patch(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = parse(settingsInput, req.body);
    res.json({ settings: await updateSettings(req.user!.organizationId!, body) });
  }),
);
