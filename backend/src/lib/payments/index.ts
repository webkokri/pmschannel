import { getOrgSetting } from '../settings';
import { decryptJson } from '../crypto';
import { stripeGateway } from './stripe-gateway';
import { createMonerisGateway, type MonerisCredentials } from './moneris-gateway';
import type { PaymentGateway } from './types';

/** Staff-initiated guest charges (Bookings page "charge guest") — Stripe only; Moneris
 *  Checkout has no equivalent "charge a saved card from the dashboard" call. */
export function getPaymentGateway(): PaymentGateway {
  return stripeGateway;
}

const unconfiguredGateway = (name: string, message: string): PaymentGateway => ({
  name,
  configured: false,
  charge: async () => ({ ok: false, gatewayRef: '', splitAtGateway: false, message }),
  refund: async () => ({ ok: false, message }),
  createGuestCheckout: async () => ({ ok: false, message }),
});

/** Resolves which gateway this organization uses for the public, guest-facing direct
 *  booking checkout — their own choice (Settings → Payments), since Moneris needs their
 *  own Store ID/API Token rather than a platform-wide key. */
export async function getGuestPaymentGateway(organizationId: string): Promise<PaymentGateway> {
  const choice = (await getOrgSetting<string>(organizationId, 'payments:gateway')) ?? 'stripe';
  if (choice === 'moneris') {
    const encrypted = await getOrgSetting<string>(organizationId, 'payments:moneris');
    const creds = encrypted ? decryptJson<MonerisCredentials>(encrypted) : null;
    if (!creds) return unconfiguredGateway('moneris', 'Moneris is selected but not configured for this property yet.');
    return createMonerisGateway(creds);
  }
  return stripeGateway;
}

/** Resolves the gateway a *specific past payment* must be refunded through — the org's
 *  current setting may have changed since, so this reads the payment's own record. */
export async function getGatewayForPayment(organizationId: string, gateway: string): Promise<PaymentGateway> {
  if (gateway === 'moneris') {
    const encrypted = await getOrgSetting<string>(organizationId, 'payments:moneris');
    const creds = encrypted ? decryptJson<MonerisCredentials>(encrypted) : null;
    if (!creds) return unconfiguredGateway('moneris', 'Moneris is no longer configured for this property — cannot refund automatically.');
    return createMonerisGateway(creds);
  }
  return stripeGateway;
}

export * from './types';
export type { MonerisCredentials };
