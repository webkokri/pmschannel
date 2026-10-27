import { prisma } from '../db';

/**
 * Records one row to the platform-wide audit log. `organizationId`/`actorId` are
 * nullable so this covers both tenant actions (an org admin changes a setting) and
 * platform actions (the super admin overrides a plan) with the same helper.
 */
export async function audit(entry: {
  actorId?: string | null;
  organizationId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        actorId: entry.actorId ?? null,
        organizationId: entry.organizationId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as object,
        after: (entry.after ?? undefined) as object,
      },
    })
    .catch(() => undefined); // audit logging never blocks the actual operation
}
