/**
 * Guest-payment gateway backed by Moneris — the dominant processor for Canadian
 * merchants, and this project's second gateway alongside Stripe (per `lib/payments/index.ts`'s
 * original plan). Unlike Stripe, Moneris has no platform/Connect concept: each property
 * has its *own* Moneris Store ID + API Token (entered in Settings → Payments), and guest
 * payments land directly in that property's own Moneris-linked bank account — there is no
 * automatic commission skim at the gateway. The platform commission is still recorded on
 * the `Payment` ledger (same as a cash/bank_transfer payment) for reporting, just not
 * collected automatically the way a Stripe Connect destination charge collects it.
 *
 * Uses **Moneris Checkout** (the hosted lightbox widget), not the older Hosted Pay Page or
 * the raw MPG txn API — that's the current product for a "guest pays on our own site"
 * flow. Shape of the preload/receipt requests follows Moneris's published Checkout API;
 * this has not been exercised against a real Moneris test store in this build (no
 * credentials available here) — verify every field name against Moneris's current
 * developer docs before taking a live store onto this path. Refunds use the classic MPG
 * XML txn API (`gatewayRef` stores `orderId|txnNumber` from the receipt), which is the
 * correct way to refund a Checkout-captured payment; same caveat applies.
 */
import { logger } from '../logger';
import type { ChargeOptions, GatewayChargeResult, GatewayRefundResult, GuestCheckoutOptions, GuestCheckoutResult, PaymentGateway } from './types';

const log = logger('payments:moneris');

export interface MonerisCredentials {
  storeId: string;
  apiToken: string;
  checkoutId: string;
  /** "qa" (Moneris's test store environment) or "live". */
  environment: 'qa' | 'live';
}

function checkoutHost(env: 'qa' | 'live'): string {
  return env === 'live' ? 'https://gateway.moneris.com' : 'https://gatewayt.moneris.com';
}
function mpgHost(env: 'qa' | 'live'): string {
  return env === 'live' ? 'https://www3.moneris.com' : 'https://esqa.moneris.com';
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Moneris returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Server-to-server check of a completed Checkout ticket — never trust the frontend
 *  widget's own "success" callback alone, since that's client-reported. */
export async function verifyMonerisReceipt(
  creds: MonerisCredentials,
  ticket: string,
): Promise<{ success: boolean; amountCents: number; orderId: string; txnNumber: string; message: string }> {
  try {
    const body = await postJson(`${checkoutHost(creds.environment)}/chkt/request/request.php`, {
      store_id: creds.storeId,
      api_token: creds.apiToken,
      checkout_id: creds.checkoutId,
      action: 'receipt',
      ticket,
    });
    const receipt = (body.response as Record<string, unknown>)?.receipt as Record<string, unknown> | undefined;
    const txn = receipt?.transaction as Record<string, unknown> | undefined;
    const success = receipt?.result === 'Successful' && Boolean(txn);
    const amount = Number(txn?.amount ?? 0);
    return {
      success,
      amountCents: Math.round(amount * 100),
      orderId: String(txn?.response_order_id ?? ''),
      txnNumber: String(txn?.transaction_number ?? txn?.receipt_id ?? ''),
      message: String(receipt?.result ?? 'Unknown response from Moneris'),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('verifyMonerisReceipt failed', err);
    return { success: false, amountCents: 0, orderId: '', txnNumber: '', message };
  }
}

export function createMonerisGateway(creds: MonerisCredentials): PaymentGateway {
  return {
    name: 'moneris',
    configured: Boolean(creds.storeId && creds.apiToken && creds.checkoutId),

    async charge(_opts: ChargeOptions): Promise<GatewayChargeResult> {
      // Moneris Checkout is a guest-initiated hosted-widget flow, not a server-side
      // "charge this card" call — there's no saved payment method to charge here the way
      // a staff-initiated Stripe PaymentIntent works. Use the guest checkout flow instead.
      return {
        ok: false,
        gatewayRef: '',
        splitAtGateway: false,
        message: 'Moneris does not support charging a guest directly from the dashboard — only the guest checkout flow.',
      };
    },

    async createGuestCheckout(opts: GuestCheckoutOptions): Promise<GuestCheckoutResult> {
      if (!this.configured) return { ok: false, message: 'Moneris is not configured for this property yet.' };
      try {
        const body = await postJson(`${checkoutHost(creds.environment)}/chkt/request/request.php`, {
          store_id: creds.storeId,
          api_token: creds.apiToken,
          checkout_id: creds.checkoutId,
          action: 'preload',
          txn_total: (opts.amountCents / 100).toFixed(2),
          environment: creds.environment,
          order_no: opts.checkoutRef,
          cart: { description: opts.description },
        });
        const response = body.response as Record<string, unknown> | undefined;
        const ticket = response?.ticket as string | undefined;
        if (!ticket || response?.success !== 'true') {
          return { ok: false, message: String(response?.error ?? 'Moneris did not return a checkout ticket.') };
        }
        return { ok: true, mode: 'widget', ticket, environment: creds.environment, message: 'Checkout ticket created' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('createGuestCheckout failed', err);
        return { ok: false, message };
      }
    },

    async refund({ gatewayRef, amountCents }): Promise<GatewayRefundResult> {
      const [orderId, txnNumber] = gatewayRef.split('|');
      if (!orderId || !txnNumber) return { ok: false, message: 'Missing Moneris order/transaction reference for this payment.' };
      try {
        const xml =
          `<request><store_id>${creds.storeId}</store_id><api_token>${creds.apiToken}</api_token>` +
          `<refund><order_id>${orderId}</order_id><txn_number>${txnNumber}</txn_number>` +
          `<comp_amount>${(amountCents / 100).toFixed(2)}</comp_amount><crypt_type>7</crypt_type></refund></request>`;
        const res = await fetch(`${mpgHost(creds.environment)}/gateway2/servlet/MpgRequest`, {
          method: 'POST',
          headers: { 'content-type': 'text/xml' },
          body: xml,
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        const ok = /<complete>true<\/complete>/i.test(text);
        const message = /<message>(.*?)<\/message>/i.exec(text)?.[1] ?? (ok ? 'Refund issued' : 'Refund failed');
        return { ok, message };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('refund failed', err);
        return { ok: false, message };
      }
    },
  };
}
