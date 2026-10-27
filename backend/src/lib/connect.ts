/**
 * Stripe Connect (Express) — how a property gets paid out. One connected account per
 * organization: the guest pays the platform (see `lib/payments/stripe-gateway.ts`), Stripe
 * automatically routes the property's net share to this account on every destination
 * charge. Inert until `STRIPE_SECRET_KEY` is set, same pattern as the rest of the Stripe
 * integration. Not exercised against a real Stripe account in this build.
 */
import { prisma } from '../db';
import { env } from '../env';
import { logger } from './logger';
import { getStripeClient, stripeConfigured } from './stripe';

const log = logger('connect');

export { stripeConfigured as connectConfigured };

export interface OnboardResult {
  ok: boolean;
  url?: string;
  message: string;
}

/**
 * Ensures the organization has a Stripe Express account, then returns a fresh onboarding
 * link (Account Links expire quickly, so this is generated per request rather than cached).
 */
export async function startConnectOnboarding(organizationId: string): Promise<OnboardResult> {
  const stripe = await getStripeClient();
  if (!stripe) {
    return { ok: false, message: 'Payouts are not configured on this server yet (no STRIPE_SECRET_KEY).' };
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

  try {
    let accountId = org.stripeConnectAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: org.contactEmail,
        business_type: 'company',
        company: { name: org.name },
        metadata: { organizationId },
      });
      accountId = account.id;
      await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeConnectAccountId: accountId, stripeConnectStatus: 'onboarding' },
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${env.publicAppUrl}/settings?connect=refresh`,
      return_url: `${env.publicAppUrl}/settings?connect=return`,
      type: 'account_onboarding',
    });
    return { ok: true, url: link.url, message: 'Redirect the owner to this URL to complete onboarding.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('startConnectOnboarding failed', err);
    return { ok: false, message };
  }
}

/** Pulls live status from Stripe and syncs it onto the Organization row. Called from the
 *  Payments settings tab (poll after returning from onboarding) and from the
 *  `account.updated` webhook. */
export async function refreshConnectStatus(organizationId: string): Promise<string> {
  const stripe = await getStripeClient();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!stripe || !org.stripeConnectAccountId) return org.stripeConnectStatus;

  try {
    const account = await stripe.accounts.retrieve(org.stripeConnectAccountId);
    const status = account.charges_enabled ? 'active' : account.requirements?.disabled_reason ? 'restricted' : 'onboarding';
    await prisma.organization.update({ where: { id: organizationId }, data: { stripeConnectStatus: status } });
    return status;
  } catch (err) {
    log.error('refreshConnectStatus failed', err);
    return org.stripeConnectStatus;
  }
}

/** Called from the Stripe webhook on `account.updated`. */
export async function syncConnectAccountFromWebhook(accountId: string, chargesEnabled: boolean, disabledReason: string | null): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { stripeConnectAccountId: accountId } });
  if (!org) return;
  const status = chargesEnabled ? 'active' : disabledReason ? 'restricted' : 'onboarding';
  await prisma.organization.update({ where: { id: org.id }, data: { stripeConnectStatus: status } });
}
