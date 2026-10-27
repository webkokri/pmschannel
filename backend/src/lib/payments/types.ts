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

/** A guest-payment processor. Distinct from `lib/stripe.ts`, which is for SaaS
 *  subscription billing — this is for charging/refunding a *guest's* booking, split
 *  between the platform (commission) and the property (via Stripe Connect). */
export interface PaymentGateway {
  readonly name: string;
  readonly configured: boolean;
  charge(opts: ChargeOptions): Promise<GatewayChargeResult>;
  refund(opts: { gatewayRef: string; amountCents: number }): Promise<GatewayRefundResult>;
}
