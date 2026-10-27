import { Router } from 'express';
import { prisma } from '../db';
import { logger } from '../lib/logger';
import { constructWebhookEvent, stripeConfigured } from '../lib/stripe';
import { activateAccelerator } from '../lib/accelerator';
import { syncConnectAccountFromWebhook } from '../lib/connect';

const log = logger('stripe-webhook');
export const stripeWebhookRouter = Router();

/**
 * Stripe calls this to keep `Subscription`/`Invoice` in sync. Mounted with
 * `express.raw()` (see app.ts) so the signature can be verified against the exact bytes
 * Stripe sent. No-ops with 200 if Stripe isn't configured, so it's safe to leave wired.
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
        const organizationId = (obj.client_reference_id as string) ?? metadata.organizationId;

        if (metadata.type === 'accelerator' && organizationId) {
          await activateAccelerator(organizationId, {
            priceCentsPaid: (obj.amount_total as number) ?? undefined,
            stripePaymentIntentId: (obj.payment_intent as string) ?? undefined,
          });
          break;
        }

        const planCode = metadata.planCode;
        if (organizationId && planCode) {
          const plan = await prisma.plan.findUnique({ where: { code: planCode } });
          if (plan) {
            await prisma.subscription.update({
              where: { organizationId },
              data: {
                planId: plan.id,
                status: 'active',
                pendingPlanId: null,
                stripeCustomerId: (obj.customer as string) ?? undefined,
                stripeSubscriptionId: (obj.subscription as string) ?? undefined,
              },
            });
            await prisma.organization.update({ where: { id: organizationId }, data: { status: 'active' } });
          }
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
      case 'invoice.paid': {
        const stripeCustomerId = obj.customer as string;
        const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId } });
        if (sub) {
          await prisma.invoice.create({
            data: {
              organizationId: sub.organizationId,
              subscriptionId: sub.id,
              amountCents: (obj.amount_paid as number) ?? 0,
              currency: ((obj.currency as string) ?? 'usd').toUpperCase(),
              status: 'paid',
              paidAt: new Date(),
              stripeInvoiceId: obj.id as string,
            },
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const stripeCustomerId = obj.customer as string;
        const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId } });
        if (sub) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'past_due' } });
          await prisma.organization.update({ where: { id: sub.organizationId }, data: { status: 'past_due' } });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSubscriptionId = obj.id as string;
        const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
        if (sub) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'canceled' } });
          await prisma.organization.update({ where: { id: sub.organizationId }, data: { status: 'canceled' } });
        }
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
