import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { assertOwned, assertPropertyInScope, requireOrg } from '../lib/tenant';
import { requirePermission } from '../lib/permissions';

export const seoRouter = Router();
seoRouter.use(requireOrg);

seoRouter.get(
  '/:propertyId',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.property.findUnique({ where: { id: req.params.propertyId } }), organizationId, 'Property', req);
    const [seo, faqs] = await Promise.all([
      prisma.propertySeo.findUnique({ where: { propertyId: req.params.propertyId } }),
      prisma.propertyFaq.findMany({ where: { propertyId: req.params.propertyId }, orderBy: { sortOrder: 'asc' } }),
    ]);
    res.json({
      seo: seo ?? { propertyId: req.params.propertyId, metaTitle: '', metaDescription: '', keywords: [], ogImageUrl: '', published: false },
      faqs,
    });
  }),
);

const seoInput = z.object({
  metaTitle: z.string().default(''),
  metaDescription: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  ogImageUrl: z.string().default(''),
  published: z.boolean().default(false),
});

seoRouter.put(
  '/:propertyId',
  requirePermission('seo.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.params.propertyId;
    await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), organizationId, 'Property', req);
    const body = parse(seoInput, req.body);
    const seo = await prisma.propertySeo.upsert({
      where: { propertyId },
      create: { propertyId, ...body },
      update: body,
    });
    res.json({ seo });
  }),
);

const faqInput = z.object({ question: z.string().min(1), answer: z.string().min(1), sortOrder: z.number().int().default(0) });

seoRouter.post(
  '/:propertyId/faqs',
  requirePermission('seo.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.params.propertyId;
    await assertOwned(() => prisma.property.findUnique({ where: { id: propertyId } }), organizationId, 'Property', req);
    const body = parse(faqInput, req.body);
    const faq = await prisma.propertyFaq.create({ data: { propertyId, ...body } });
    res.status(201).json({ faq });
  }),
);

seoRouter.patch(
  '/faqs/:id',
  requirePermission('seo.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.propertyFaq.findUnique({
      where: { id: req.params.id },
      include: { property: { select: { organizationId: true } } },
    });
    if (!existing || existing.property.organizationId !== organizationId) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    assertPropertyInScope(existing.propertyId, req);
    const body = parse(faqInput.partial(), req.body);
    const faq = await prisma.propertyFaq.update({ where: { id: req.params.id }, data: body });
    res.json({ faq });
  }),
);

seoRouter.delete(
  '/faqs/:id',
  requirePermission('seo.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.propertyFaq.findUnique({
      where: { id: req.params.id },
      include: { property: { select: { organizationId: true } } },
    });
    if (!existing || existing.property.organizationId !== organizationId) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    assertPropertyInScope(existing.propertyId, req);
    await prisma.propertyFaq.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
