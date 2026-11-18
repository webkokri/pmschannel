import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { assertOwned, requireOrg, resolvePropertyFilter } from '../lib/tenant';
import { requireRole } from '../auth';

export const packagesRouter = Router();
packagesRouter.use(requireOrg);

packagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = resolvePropertyFilter(req, req.query.propertyId ? String(req.query.propertyId) : undefined);
    const packages = await prisma.package.findMany({
      where: { organizationId, propertyId },
      orderBy: { createdAt: 'desc' },
      include: { roomType: { select: { name: true } } },
    });
    res.json({ packages });
  }),
);

const packageInput = z.object({
  propertyId: z.string(),
  roomTypeId: z.string().nullish(),
  name: z.string().min(1),
  description: z.string().default(''),
  priceAdjustType: z.enum(['flat', 'pct']).default('flat'),
  priceValue: z.number(),
  includedAddons: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

packagesRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(packageInput, req.body);
    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property', req);
    const pkg = await prisma.package.create({ data: { ...body, organizationId } });
    res.status(201).json({ package: pkg });
  }),
);

packagesRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.package.findUnique({ where: { id: req.params.id } }), organizationId, 'Package', req);
    const body = parse(packageInput.partial().omit({ propertyId: true }), req.body);
    const pkg = await prisma.package.update({ where: { id: req.params.id }, data: body });
    res.json({ package: pkg });
  }),
);

packagesRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.package.findUnique({ where: { id: req.params.id } }), organizationId, 'Package', req);
    await prisma.package.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
