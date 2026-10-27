/**
 * Guest-payment gateway backed by Stripe. When the property has an active Stripe Connect
 * account, this uses a **destination charge**: the guest's card is charged on the
 * platform's account, Stripe automatically moves `amount - applicationFeeCents` to the
 * property's connected account, and the `applicationFeeCents` (our commission) stays on
 * the platform — one API call, no manual transfer/payout step. Without a connected
 * account, it falls back to a plain charge on the platform's account (the commission
 * split is still recorded in our ledger, but the property's share isn't moved anywhere
 * automatically — see `Payment.transferredToConnectAt`).
 *
 * Inert — `configured` is false — until `STRIPE_SECRET_KEY` is set, same pattern as
 * `lib/stripe.ts`. Not exercised against a real Stripe account in this build; verify
 * against Stripe's docs for the installed SDK version once you have live test keys.
 */
import { stripeConfigured, getStripeClient } from '../stripe';
import { logger } from '../logger';
import type { ChargeOptions, GatewayChargeResult, GatewayRefundResult, PaymentGateway } from './types';

const log = logger('payments:stripe');

export const stripeGateway: PaymentGateway = {
  name: 'stripe',
  configured: stripeConfigured,

  async charge({ amountCents, currency, description, applicationFeeCents, destinationAccountId }: ChargeOptions): Promise<GatewayChargeResult> {
    const stripe = await getStripeClient();
    if (!stripe) {
      return {
        ok: false,
        gatewayRef: '',
        splitAtGateway: false,
        message: 'Payment gateway is not configured (no STRIPE_SECRET_KEY).',
      };
    }
    try {
      // Real integration: pass a `payment_method` / `customer` captured from the guest's
      // checkout — this creates a not-yet-confirmed intent as a placeholder shape so the
      // rest of the app (Payment ledger, refunds) has something concrete to work against.
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: currency.toLowerCase(),
        description,
        confirm: false,
        ...(destinationAccountId
          ? {
              application_fee_amount: applicationFeeCents,
              transfer_data: { destination: destinationAccountId },
            }
          : {}),
      });
      return {
        ok: true,
        gatewayRef: intent.id,
        splitAtGateway: Boolean(destinationAccountId),
        message: destinationAccountId
          ? 'Payment intent created — net amount will transfer to the property automatically on capture.'
          : 'Payment intent created — the property has not connected Stripe yet, so the full amount stays on the platform account until they do.',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('charge failed', err);
      return { ok: false, gatewayRef: '', splitAtGateway: false, message };
    }
  },

  async refund({ gatewayRef, amountCents }): Promise<GatewayRefundResult> {
    const stripe = await getStripeClient();
    if (!stripe) {
      return { ok: false, message: 'Payment gateway is not configured (no STRIPE_SECRET_KEY).' };
    }
    try {
      // `refund_application_fee: true` claws back our commission proportionally too, so a
      // refunded booking doesn't leave the platform having kept a fee on a stay that never
      // happened.
      await stripe.refunds.create({ payment_intent: gatewayRef, amount: amountCents, refund_application_fee: true });
      return { ok: true, message: 'Refund issued' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('refund failed', err);
      return { ok: false, message };
    }
  },
};
