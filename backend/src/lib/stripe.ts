/**
 * Thin, optional Stripe wrapper. Every export is a safe no-op ("billing not configured")
 * unless `STRIPE_SECRET_KEY` is set, so the app runs (and self-serve plan changes work via
 * the manual/`pendingPlanChange` path) with zero payment-provider setup. Once you add a
 * real key, these start actually talking to Stripe — nothing else in the app needs to
 * change, `modules/billing.ts` already calls through this module.
 *
 * Not exercised against a real Stripe account in this build (no credentials available
 * here) — read it over once you have test keys before relying on it in production.
 */
import { env } from '../env';
import { logger } from './logger';

const log = logger('stripe');

export const stripeConfigured = Boolean(env.stripeSecretKey);

// Lazily import the `stripe` package only when configured, so it's an optional
// dependency at runtime (not required for the app to boot without it installed).
// Exported so other modules (e.g. lib/payments/stripe-gateway.ts, for guest payments
// rather than subscription billing) share the same lazy client instead of reimporting.
export async function getStripeClient() {
  if (!env.stripeSecretKey) return null;
  const { default: Stripe } = await import('stripe');
  // Cast: avoids pinning to one literal API-version string across SDK upgrades. This
  // path only runs once a real STRIPE_SECRET_KEY is set — verify against Stripe's docs
  // for the SDK version installed before relying on it in production.
  return new Stripe(env.stripeSecretKey, { apiVersion: '2024-06-20' as never });
}
const client = getStripeClient;

export interface CheckoutSessionResult {
  ok: boolean;
  url?: string;
  message: string;
}

/** Create a Checkout Session for an organization to subscribe/upgrade to a plan. */
export async function createCheckoutSession(opts: {
  organizationId: string;
  organizationName: string;
  contactEmail: string;
  planCode: string;
  priceCents: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly';
  successUrl: string;
  cancelUrl: string;
  existingStripeCustomerId?: string | null;
}): Promise<CheckoutSessionResult> {
  const stripe = await client();
  if (!stripe) {
    return {
      ok: false,
      message:
        'Billing is not configured on this server yet (no STRIPE_SECRET_KEY). ' +
        'Your upgrade request has been recorded for the team to action manually.',
    };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: opts.existingStripeCustomerId ?? undefined,
      customer_email: opts.existingStripeCustomerId ? undefined : opts.contactEmail,
      client_reference_id: opts.organizationId,
      line_items: [
        {
          price_data: {
            currency: opts.currency.toLowerCase(),
            recurring: { interval: opts.billingCycle === 'yearly' ? 'year' : 'month' },
            unit_amount: opts.priceCents,
            product_data: { name: `Channel Manager — ${opts.planCode} plan` },
          },
          quantity: 1,
        },
      ],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: { organizationId: opts.organizationId, planCode: opts.planCode },
    });
    return { ok: true, url: session.url ?? undefined, message: 'Checkout session created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('createCheckoutSession failed', err);
    return { ok: false, message };
  }
}

/** One-time-payment Checkout Session — used for the Accelerator add-on (not a subscription). */
export async function createOneTimeCheckoutSession(opts: {
  organizationId: string;
  contactEmail: string;
  productName: string;
  priceCents: number;
  currency: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSessionResult> {
  const stripe = await client();
  if (!stripe) {
    return { ok: false, message: 'Payments are not configured on this server yet (no STRIPE_SECRET_KEY).' };
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: opts.contactEmail,
      client_reference_id: opts.organizationId,
      line_items: [
        {
          price_data: {
            currency: opts.currency.toLowerCase(),
            unit_amount: opts.priceCents,
            product_data: { name: opts.productName },
          },
          quantity: 1,
        },
      ],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: opts.metadata,
    });
    return { ok: true, url: session.url ?? undefined, message: 'Checkout session created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('createOneTimeCheckoutSession failed', err);
    return { ok: false, message };
  }
}

/** Verify + construct a webhook event from the raw request body. Returns null if unconfigured. */
export async function constructWebhookEvent(rawBody: Buffer, signature: string) {
  const stripe = await client();
  if (!stripe || !env.stripeWebhookSecret) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}
