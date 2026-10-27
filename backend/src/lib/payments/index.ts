import { stripeGateway } from './stripe-gateway';
import type { PaymentGateway } from './types';

/** Only one gateway today; the interface is what makes adding a second (PayPal, Square,
 *  Moneris for Canadian properties, …) a matter of implementing `PaymentGateway`. */
export function getPaymentGateway(): PaymentGateway {
  return stripeGateway;
}

export * from './types';
