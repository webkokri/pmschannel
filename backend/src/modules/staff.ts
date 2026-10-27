import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, notFound, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg } from '../lib/tenant';
import { assertWithinLimit } from '../lib/limits';
import { PERMISSIONS } from '../lib/permissions';

/**
 * Staff directory — supersedes the user-facing half of modules/users.ts with the richer
 * profile fields (title/department/phone) and the granular permission overlay. Mounted
 * alongside `usersRouter` at a different path; `usersRouter` is kept for compatibility.
 */
export const staffRouter = Router();
staffRouter.use(requireOrg);

staffRouter.get(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const staff = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        title: true,
        department: true,
        phone: true,
        permissions: true,
        createdAt: true,
      },
    });
    res.json({ staff, availablePermissions: PERMISSIONS });
  }),
);

const staffInput = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'viewer']),
  title: z.string().default(''),
  department: z.string().default(''),
  phone: z.string().default(''),
  password: z.string().min(8).optional(),
  active: z.boolean().optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

staffRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(staffInput.extend({ password: z.string().min(8) }), req.body);
    await assertWithinLimit(organizationId, 'users');
    const member = await prisma.user.create({
      data: {
        organizationId,
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        title: body.title,
        department: body.department,
        phone: body.phone,
        active: body.active ?? true,
        permissions: body.permissions ?? [],
        passwordHash: await bcrypt.hash(body.password, 10),
      },
      select: { id: true, email: true, name: true, role: true, active: true, title: true, department: true, phone: true, permissions: true },
    });
    res.status(201).json({ staff: member });
  }),
);

async function assertStaffOwned(id: string, organizationId: string) {
  const member = await prisma.user.findUnique({ where: { id } });
  if (!member || member.organizationId !== organizationId) throw notFound('Staff member not found');
  return member;
}

staffRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await assertStaffOwned(req.params.id, req.user!.organizationId!);
    const body = parse(staffInput.partial(), req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.email) data.email = body.email.toLowerCase();
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
    delete data.password;
    const member = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true, title: true, department: true, phone: true, permissions: true },
    });
    res.json({ staff: member });
  }),
);

/** Toggle a single permission on/off — a lighter-weight action than the full PATCH. */
staffRouter.post(
  '/:id/permissions/:key',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const member = await assertStaffOwned(req.params.id, req.user!.organizationId!);
    const key = req.params.key;
    const enabled = req.body?.enabled !== false;
    const permissions = new Set(member.permissions);
    if (enabled) permissions.add(key);
    else permissions.delete(key);
    const updated = await prisma.user.update({
      where: { id: member.id },
      data: { permissions: [...permissions] },
      select: { id: true, permissions: true },
    });
    res.json({ staff: updated });
  }),
);

staffRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await assertStaffOwned(req.params.id, req.user!.organizationId!);
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
