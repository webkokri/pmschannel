import { OTA_CATEGORIES, type ChannelCategory, type LimitKey, type PlanLimits } from '@cm/shared';
import { prisma } from '../db';
import { forbidden, paymentRequired } from './http';

interface ActivePlan {
  planName: string;
  planCode: string;
  limits: PlanLimits;
}

async function getActivePlan(organizationId: string): Promise<ActivePlan> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!sub) {
    throw paymentRequired('No subscription found for this organization — contact support.');
  }
  return { planName: sub.plan.name, planCode: sub.plan.code, limits: sub.plan.limits as unknown as PlanLimits };
}

const LABEL: Record<LimitKey, string> = {
  properties: 'properties',
  roomTypesPerProperty: 'room types on this property',
  channelConnections: 'connected channels',
  users: 'team members',
};

/**
 * Throws a 402 `paymentRequired` (with `{ limitKey, limit, current }` details the
 * frontend uses to show an upgrade prompt) if adding one more of `key` would exceed the
 * organization's plan. Call **before** creating the row.
 */
export async function assertWithinLimit(
  organizationId: string,
  key: LimitKey,
  opts: { propertyId?: string } = {},
): Promise<void> {
  const { planName, limits } = await getActivePlan(organizationId);

  let current: number;
  let limit: number;

  switch (key) {
    case 'properties':
      current = await prisma.property.count({ where: { organizationId } });
      limit = limits.maxProperties;
      break;
    case 'channelConnections':
      // Accelerator-boosted connections are a paid add-on, not part of the base plan —
      // they don't count against (or get blocked by) this limit.
      current = await prisma.channelConnection.count({ where: { organizationId, enabled: true, viaAccelerator: false } });
      limit = limits.maxChannelConnections;
      break;
    case 'users':
      current = await prisma.user.count({ where: { organizationId } });
      limit = limits.maxUsers;
      break;
    case 'roomTypesPerProperty':
      if (!opts.propertyId) throw new Error('assertWithinLimit("roomTypesPerProperty") requires propertyId');
      current = await prisma.roomType.count({ where: { propertyId: opts.propertyId } });
      limit = limits.maxRoomTypesPerProperty;
      break;
  }

  if (current >= limit) {
    throw paymentRequired(
      `Your ${planName} plan allows up to ${limit} ${LABEL[key]}. Upgrade your plan to add more.`,
      { limitKey: key, limit, current },
    );
  }
}

/** Channel categories (global / north_america / direct_misc) gated by plan. */
export async function assertChannelCategoryAllowed(
  organizationId: string,
  category: ChannelCategory,
): Promise<void> {
  const { planName, limits } = await getActivePlan(organizationId);
  if (!limits.channelCategories.includes(category)) {
    throw forbidden(
      `Your ${planName} plan doesn't include "${OTA_CATEGORIES[category] ?? category}" channels. Upgrade your plan to connect this one.`,
    );
  }
}

export interface UsageSummary {
  plan: { code: string; name: string; limits: PlanLimits };
  usage: {
    properties: number;
    channelConnections: number;
    users: number;
  };
}

/** Everything the billing page needs to render usage bars against the plan. */
export async function getUsageSummary(organizationId: string): Promise<UsageSummary> {
  const { planName, planCode, limits } = await getActivePlan(organizationId);
  const [properties, channelConnections, users] = await Promise.all([
    prisma.property.count({ where: { organizationId } }),
    prisma.channelConnection.count({ where: { organizationId, enabled: true, viaAccelerator: false } }),
    prisma.user.count({ where: { organizationId } }),
  ]);
  return {
    plan: { code: planCode, name: planName, limits },
    usage: { properties, channelConnections, users },
  };
}
