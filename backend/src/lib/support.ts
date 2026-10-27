import { prisma } from '../db';
import { logger } from './logger';

const log = logger('support');

export interface SupportManagerInfo {
  id: string;
  name: string;
  email: string;
}

/** The active platform staff eligible to be assigned as a dedicated support manager. */
async function listSupportManagers() {
  return prisma.user.findMany({
    where: { isSupportManager: true, active: true },
    select: { id: true, name: true, email: true },
  });
}

/** Whoever currently carries the fewest organizations — spreads the book of business evenly. */
export async function leastLoadedSupportManager(): Promise<SupportManagerInfo | null> {
  const staff = await listSupportManagers();
  if (staff.length === 0) return null;

  const loads = await prisma.organization.groupBy({
    by: ['supportManagerId'],
    where: { supportManagerId: { not: null } },
    _count: { _all: true },
  });
  const loadById = new Map(loads.map((l) => [l.supportManagerId as string, l._count._all]));

  return staff.reduce((best, candidate) => {
    const bestLoad = loadById.get(best.id) ?? 0;
    const candidateLoad = loadById.get(candidate.id) ?? 0;
    return candidateLoad < bestLoad ? candidate : best;
  });
}

/**
 * Auto-assign a dedicated support manager to a newly-created organization. Safe to call
 * even if no staff exist yet (e.g. before the first support manager is onboarded) — it
 * just leaves the org unassigned and logs a warning; the super admin can assign one later.
 */
export async function assignSupportManager(organizationId: string): Promise<SupportManagerInfo | null> {
  const manager = await leastLoadedSupportManager();
  if (!manager) {
    log.warn(`No support managers available to assign to organization ${organizationId}`);
    return null;
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: { supportManagerId: manager.id, supportManagerAssignedAt: new Date() },
  });
  log.info(`Assigned support manager ${manager.email} to organization ${organizationId}`);
  return manager;
}

/** Super-admin manual override. */
export async function reassignSupportManager(
  organizationId: string,
  supportManagerId: string | null,
): Promise<void> {
  if (supportManagerId) {
    const manager = await prisma.user.findUnique({ where: { id: supportManagerId } });
    if (!manager || !manager.isSupportManager || !manager.active) {
      throw new Error('That user is not an active support manager');
    }
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      supportManagerId,
      supportManagerAssignedAt: supportManagerId ? new Date() : null,
    },
  });
}
