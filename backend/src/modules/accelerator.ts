import { Router } from 'express';
import { OTA_BY_CODE } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { requireOrg, requirePortfolioStaff } from '../lib/tenant';
import { requireRole } from '../auth';
import { audit } from '../lib/audit';
import { activateAccelerator, getAcceleratorChannelCodes } from '../lib/accelerator';

export const acceleratorRouter = Router();
acceleratorRouter.use(requireOrg, requirePortfolioStaff);

acceleratorRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const [accelerator, channelCodes, connectedCount] = await Promise.all([
      prisma.accelerator.findUnique({ where: { organizationId } }),
      getAcceleratorChannelCodes(),
      prisma.channelConnection.count({ where: { organizationId, viaAccelerator: true, enabled: true } }),
    ]);

    res.json({
      active: accelerator?.active ?? false,
      activatedAt: accelerator?.activatedAt ?? null,
      boostedChannelCodes: accelerator?.boostedChannelCodes ?? [],
      connectedCount,
      bundle: channelCodes.map((code) => ({
        code,
        name: OTA_BY_CODE[code]?.name ?? code,
        category: OTA_BY_CODE[code]?.category ?? 'global',
      })),
    });
  }),
);

/** Free, admin-triggered — this is the portfolio's own feature, not a purchase. */
acceleratorRouter.post(
  '/activate',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const result = await activateAccelerator(organizationId);
    await audit({
      actorId: req.user!.id,
      organizationId,
      action: 'accelerator.activated',
      entity: 'Accelerator',
      entityId: organizationId,
      after: result,
    });
    res.json({ applied: true, ...result });
  }),
);
