export interface GatewayChargeResult {
  ok: boolean;
  gatewayRef: string;
  message: string;
  /** True when the split actually happened at the gateway (Stripe Connect destination
   *  charge) — the property's net share already moved to their own account. False means
   *  the platform is holding the full amount (no Connect account yet). */
  splitAtGateway: boolean;
}

export interface GatewayRefundResult {
  ok: boolean;
  message: string;
}

export interface ChargeOptions {
  amountCents: number;
  currency: string;
  description: string;
  /** The commission the platform keeps — becomes Stripe's `application_fee_amount` when
   *  a destination account is set. */
  applicationFeeCents: number;
  /** The property's own Stripe Connect account, if they've onboarded. Omit to charge the
   *  platform's own account in full (no automatic split — see `splitAtGateway`). */
  destinationAccountId?: string | null;
}

export interface GuestCheckoutOptions {
  amountCents: number;
  currency: string;
  description: string;
  /** The commission the platform keeps. Stripe only (becomes `application_fee_amount`) —
   *  Moneris has no platform/connect concept, so it's recorded in our ledger only. */
  applicationFeeCents: number;
  /** The property's own Stripe Connect account, if onboarded. Stripe only. */
  destinationAccountId?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Carried through to the webhook/receipt so it can look up the `PendingDirectBooking`
   *  this checkout is for — never raw booking details (gateway metadata is limited and
   *  guest-payment metadata shouldn't carry guest PII through a third party either). */
  checkoutRef: string;
}

/** Stripe is redirect-based (send the guest to a hosted page); Moneris Checkout is a
 *  client-side lightbox widget (hand the frontend a one-time ticket to load it with). The
 *  public booking page branches on `mode` to know which to do. */
export type GuestCheckoutResult =
  | { ok: true; mode: 'redirect'; url: string; message: string }
  | { ok: true; mode: 'widget'; ticket: string; environment: string; message: string }
  | { ok: false; message: string };

/** A guest-payment processor. Distinct from `lib/stripe.ts`, which is for SaaS
 *  subscription billing — this is for charging/refunding a *guest's* booking, split
 *  between the platform (commission) and the property (via Stripe Connect). */
export interface PaymentGateway {
  readonly name: string;
  readonly configured: boolean;
  charge(opts: ChargeOptions): Promise<GatewayChargeResult>;
  refund(opts: { gatewayRef: string; amountCents: number }): Promise<GatewayRefundResult>;
  /** Start a guest self-serve checkout for a direct (in-house) booking. */
  createGuestCheckout(opts: GuestCheckoutOptions): Promise<GuestCheckoutResult>;
}
