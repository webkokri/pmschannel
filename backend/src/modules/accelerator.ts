import { Router } from 'express';
import { OTA_BY_CODE } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { requireOrg } from '../lib/tenant';
import { requireRole } from '../auth';
import { audit } from '../lib/audit';
import { getAcceleratorChannelCodes, getAcceleratorPriceCents } from '../lib/accelerator';
import { createOneTimeCheckoutSession, stripeConfigured } from '../lib/stripe';
import { env } from '../env';

export const acceleratorRouter = Router();
acceleratorRouter.use(requireOrg);

acceleratorRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const [accelerator, channelCodes, priceCents, connectedCount] = await Promise.all([
      prisma.accelerator.findUnique({ where: { organizationId } }),
      getAcceleratorChannelCodes(),
      getAcceleratorPriceCents(),
      prisma.channelConnection.count({ where: { organizationId, viaAccelerator: true, enabled: true } }),
    ]);

    res.json({
      active: accelerator?.active ?? false,
      activatedAt: accelerator?.activatedAt ?? null,
      boostedChannelCodes: accelerator?.boostedChannelCodes ?? [],
      connectedCount,
      priceCents,
      currency: 'USD',
      stripeConfigured,
      bundle: channelCodes.map((code) => ({
        code,
        name: OTA_BY_CODE[code]?.name ?? code,
        category: OTA_BY_CODE[code]?.category ?? 'global',
      })),
    });
  }),
);

acceleratorRouter.post(
  '/activate',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const priceCents = await getAcceleratorPriceCents();

    if (!stripeConfigured) {
      await audit({
        actorId: req.user!.id,
        organizationId,
        action: 'accelerator.activation_requested',
        entity: 'Accelerator',
        entityId: organizationId,
      });
      return res.json({
        applied: false,
        message:
          'Payments aren\'t configured on this server yet — your request has been recorded for the team to action manually.',
      });
    }

    const result = await createOneTimeCheckoutSession({
      organizationId,
      contactEmail: organization.contactEmail,
      productName: 'Channel Manager Accelerator — multi-platform distribution boost',
      priceCents,
      currency: 'USD',
      metadata: { type: 'accelerator', organizationId },
      successUrl: `${env.publicAppUrl}/accelerator?checkout=success`,
      cancelUrl: `${env.publicAppUrl}/accelerator?checkout=cancelled`,
    });
    if (result.ok && result.url) {
      return res.json({ applied: false, checkoutUrl: result.url, message: result.message });
    }
    res.json({ applied: false, message: result.message });
  }),
);
