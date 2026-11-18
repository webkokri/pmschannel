import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { requireRole } from '../auth';
import { requireOrg, assertOwned } from '../lib/tenant';

/**
 * The public booking page's designer-editable content blocks (hero, about, amenities,
 * gallery, custom sections) — a structured page builder, not freeform HTML. Reading is
 * open to any org role (managers/viewers should be able to see what's live); writing is
 * restricted to the organization's `admin` role specifically, per the product requirement
 * that only the admin team designs the customer-facing page — unlike `seo.manage`, this is
 * a hard role gate, not a grantable permission.
 */
export const pageBuilderRouter = Router();
pageBuilderRouter.use(requireOrg);

const DEFAULT_CONTENT = {
  heroHeadline: '',
  heroSubheadline: '',
  heroImageUrl: '',
  primaryColor: '#356ef4',
  aboutText: '',
  amenities: [] as string[],
  galleryImageUrls: [] as string[],
  sections: [] as { id: string; heading: string; body: string }[],
};

pageBuilderRouter.get(
  '/:propertyId',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.property.findUnique({ where: { id: req.params.propertyId } }), organizationId, 'Property');
    const content = await prisma.propertyPageContent.findUnique({ where: { propertyId: req.params.propertyId } });
    res.json({
      content: content
        ? { ...content, sections: content.sections as unknown as { id: string; heading: string; body: string }[] }
        : { propertyId: req.params.propertyId, ...DEFAULT_CONTENT },
    });
  }),
);

const sectionInput = z.object({ id: z.string(), heading: z.string().default(''), body: z.string().default('') });
const contentInput = z.object({
  heroHeadline: z.string().default(''),
  heroSubheadline: z.string().default(''),
  heroImageUrl: z.string().default(''),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#356ef4'),
  aboutText: z.string().default(''),
  amenities: z.array(z.string()).max(40).default([]),
  galleryImageUrls: z.array(z.string()).max(24).default([]),
  sections: z.array(sectionInput).max(20).default([]),
});

pageBuilderRouter.put(
  '/:propertyId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.params.propertyId;
    await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), organizationId, 'Property');
    const body = parse(contentInput, req.body);
    const content = await prisma.propertyPageContent.upsert({
      where: { propertyId },
      create: { propertyId, ...body, sections: body.sections as object },
      update: { ...body, sections: body.sections as object },
    });
    res.json({ content: { ...content, sections: content.sections as unknown as typeof body.sections } });
  }),
);
