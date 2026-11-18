import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler, badRequest, notFound, parse } from '../../lib/http';
import { signToken, type AuthUser } from '../../auth';
import { audit } from '../../lib/audit';
import { getOrCreatePortfolioOrg } from '../../lib/portfolio';

/**
 * Super-admin: list/add every property in the one portfolio and assign each one a
 * dedicated manager/owner — a user whose account is hard-restricted to just that
 * property (see User.assignedPropertyId and lib/tenant.ts). This is the main admin
 * surface now that there's no self-serve organization signup.
 */
export const adminPropertiesRouter = Router();

adminPropertiesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const properties = await prisma.property.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: 'asc' },
      include: {
        assignedManagers: { select: { id: true, name: true, email: true, role: true, active: true } },
        _count: { select: { roomTypes: true, bookings: true } },
      },
    });
    res.json({ properties });
  }),
);

/** Candidate users for "assign an existing user" — portfolio staff not already assigned. */
adminPropertiesRouter.get(
  '/unassigned-users',
  asyncHandler(async (_req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const users = await prisma.user.findMany({
      where: { organizationId: organization.id, assignedPropertyId: null, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    res.json({ users });
  }),
);

const propertyInput = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  address: z.string().default(''),
  city: z.string().default(''),
  region: z.string().default(''),
  country: z.enum(['US', 'CA']).default('US'),
  timezone: z.string().default('America/New_York'),
  currency: z.string().default('USD'),
});

/** Add a property to the portfolio directly — no plan/property-count limit. */
adminPropertiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const organization = await getOrCreatePortfolioOrg();
    const body = parse(propertyInput, req.body);
    const property = await prisma.property.create({ data: { ...body, organizationId: organization.id } });
    await prisma.propertySeo.create({
      data: { propertyId: property.id, metaTitle: property.name, published: true },
    });
    await audit({
      actorId: req.user!.id,
      organizationId: organization.id,
      action: 'property.created',
      entity: 'Property',
      entityId: property.id,
      after: { name: property.name, code: property.code },
    });
    res.status(201).json({ property });
  }),
);

async function assertPortfolioProperty(propertyId: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw notFound('Property not found');
  return property;
}

const assignExistingInput = z.object({ userId: z.string() });
const assignNewInput = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['admin', 'manager', 'viewer']).default('admin'),
});

/**
 * Assign this property's dedicated manager/owner — either an existing unassigned user,
 * or a brand-new account created on the spot. Either way the user ends up with
 * `assignedPropertyId` set to this property, hard-restricting their account to it.
 */
adminPropertiesRouter.post(
  '/:id/assign-manager',
  asyncHandler(async (req, res) => {
    const property = await assertPortfolioProperty(req.params.id);

    let user;
    if (req.body?.userId) {
      const body = parse(assignExistingInput, req.body);
      const existing = await prisma.user.findUnique({ where: { id: body.userId } });
      if (!existing || existing.organizationId !== property.organizationId) throw notFound('User not found');
      if (existing.isSuperAdmin) throw badRequest('Cannot assign a super admin to a property');
      user = await prisma.user.update({ where: { id: existing.id }, data: { assignedPropertyId: property.id } });
    } else {
      const body = parse(assignNewInput, req.body);
      const existingByEmail = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existingByEmail) throw badRequest('An account with that email already exists');
      user = await prisma.user.create({
        data: {
          organizationId: property.organizationId,
          email: body.email.toLowerCase(),
          name: body.name,
          role: body.role,
          passwordHash: await bcrypt.hash(body.password, 10),
          assignedPropertyId: property.id,
        },
      });
    }

    await audit({
      actorId: req.user!.id,
      organizationId: property.organizationId,
      action: 'property.manager_assigned',
      entity: 'Property',
      entityId: property.id,
      after: { userId: user.id, email: user.email },
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
  }),
);

adminPropertiesRouter.post(
  '/:id/unassign-manager/:userId',
  asyncHandler(async (req, res) => {
    const property = await assertPortfolioProperty(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user || user.assignedPropertyId !== property.id) throw notFound('Assigned manager not found');
    await prisma.user.update({ where: { id: user.id }, data: { assignedPropertyId: null } });
    await audit({
      actorId: req.user!.id,
      organizationId: property.organizationId,
      action: 'property.manager_unassigned',
      entity: 'Property',
      entityId: property.id,
      before: { userId: user.id, email: user.email },
    });
    res.status(204).end();
  }),
);

/** Impersonate this property's manager (or, if none assigned, any active org admin), for support. */
adminPropertiesRouter.post(
  '/:id/impersonate',
  asyncHandler(async (req, res) => {
    const property = await assertPortfolioProperty(req.params.id);
    const manager =
      (await prisma.user.findFirst({
        where: { assignedPropertyId: property.id, active: true },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await prisma.user.findFirst({
        where: { organizationId: property.organizationId, role: 'admin', assignedPropertyId: null, active: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!manager) throw notFound('No active user to impersonate for this property');

    const authUser: AuthUser = {
      id: manager.id,
      email: manager.email,
      name: manager.name,
      role: manager.role,
      organizationId: manager.organizationId,
      isSuperAdmin: false,
      assignedPropertyId: manager.assignedPropertyId,
      permissions: manager.permissions,
      impersonated: true,
    };
    await audit({
      actorId: req.user!.id,
      organizationId: property.organizationId,
      action: 'property.impersonated',
      entity: 'User',
      entityId: manager.id,
    });
    res.json({ token: signToken(authUser, { expiresIn: '30m' }), user: authUser });
  }),
);

adminPropertiesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const property = await assertPortfolioProperty(req.params.id);
    await prisma.property.delete({ where: { id: property.id } });
    await audit({
      actorId: req.user!.id,
      organizationId: property.organizationId,
      action: 'property.deleted',
      entity: 'Property',
      entityId: property.id,
      before: { name: property.name, code: property.code },
    });
    res.status(204).end();
  }),
);
