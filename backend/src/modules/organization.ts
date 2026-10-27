import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg } from '../lib/tenant';

/** Org profile — "General Settings": branding, tax info, locale, invoice footer. */
export const organizationRouter = Router();
organizationRouter.use(requireOrg);

organizationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.organizationId! } });
    res.json({ organization });
  }),
);

const profileInput = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  taxId: z.string().optional(),
  invoiceFooter: z.string().optional(),
  locale: z.string().optional(),
  contactEmail: z.string().email().optional(),
});

organizationRouter.patch(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = parse(profileInput, req.body);
    const organization = await prisma.organization.update({
      where: { id: req.user!.organizationId! },
      data: body,
    });
    res.json({ organization });
  }),
);
