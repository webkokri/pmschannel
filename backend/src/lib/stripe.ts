/**
 * Thin, optional Stripe wrapper for guest-facing payments — the direct-booking checkout
 * (lib/payments/stripe-gateway.ts) and the Connect payout account (lib/connect.ts). Every
 * export is a safe no-op ("payments not configured") unless `STRIPE_SECRET_KEY` is set, so
 * the app runs with zero payment-provider setup.
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

/** Verify + construct a webhook event from the raw request body. Returns null if unconfigured. */
export async function constructWebhookEvent(rawBody: Buffer, signature: string) {
  const stripe = await client();
  if (!stripe || !env.stripeWebhookSecret) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}
