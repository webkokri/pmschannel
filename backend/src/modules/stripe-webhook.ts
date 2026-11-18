import { Router } from 'express';
import { logger } from '../lib/logger';
import { constructWebhookEvent, stripeConfigured } from '../lib/stripe';
import { syncConnectAccountFromWebhook } from '../lib/connect';
import { finalizePaidDirectBooking } from './public';

const log = logger('stripe-webhook');
export const stripeWebhookRouter = Router();

/**
 * Stripe calls this for guest-payment checkout completion and Connect account status
 * changes. Mounted with `express.raw()` (see app.ts) so the signature can be verified
 * against the exact bytes Stripe sent. No-ops with 200 if Stripe isn't configured, so
 * it's safe to leave wired.
 *
 * Not exercised against a real Stripe account in this build — verify event shapes
 * against the Stripe dashboard's webhook log once you have live credentials.
 */
stripeWebhookRouter.post('/', async (req, res) => {
  if (!stripeConfigured) return res.status(200).json({ received: false, message: 'Billing not configured' });

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') return res.status(400).json({ error: 'Missing stripe-signature header' });

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = (await constructWebhookEvent(req.body as Buffer, signature)) as unknown as typeof event;
  } catch (err) {
    log.error('signature verification failed', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const metadata = (obj.metadata as Record<string, string>) ?? {};
        if (metadata.type === 'direct_booking' && metadata.checkoutRef) {
          await finalizePaidDirectBooking(metadata.checkoutRef, (obj.payment_intent as string) ?? obj.id as string);
        }
        break;
      }
      case 'account.updated': {
        const accountId = obj.id as string;
        const chargesEnabled = Boolean(obj.charges_enabled);
        const requirements = obj.requirements as { disabled_reason?: string } | undefined;
        await syncConnectAccountFromWebhook(accountId, chargesEnabled, requirements?.disabled_reason ?? null);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error(`handling ${event.type} failed`, err);
    res.status(500).json({ error: 'Webhook handler error' });
  }
});
