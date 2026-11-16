import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, badRequest, parse } from '../lib/http';
import { requireOrg, assertOwned } from '../lib/tenant';
import { requireRole } from '../auth';
import { getGatewayForPayment, getPaymentGateway } from '../lib/payments';
import { stripeConfigured } from '../lib/stripe';
import { computeCommission } from '../lib/commission';
import { getOrgSetting, setOrgSetting } from '../lib/settings';
import { decryptJson, encryptJson, redactCredentials } from '../lib/crypto';
import type { MonerisCredentials } from '../lib/payments/moneris-gateway';

export const paymentsRouter = Router();
paymentsRouter.use(requireOrg);

/** Which gateway this org's *public, guest-facing* direct booking checkout uses. */
paymentsRouter.get(
  '/gateway-config',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const gateway = (await getOrgSetting<string>(organizationId, 'payments:gateway')) ?? 'stripe';
    const encrypted = await getOrgSetting<string>(organizationId, 'payments:moneris');
    const moneris = encrypted ? decryptJson<MonerisCredentials>(encrypted) : null;
    res.json({
      gateway,
      stripeConfigured,
      moneris: moneris
        ? { ...redactCredentials(moneris as unknown as Record<string, unknown>), configured: true }
        : { configured: false },
    });
  }),
);

const gatewayConfigInput = z.object({
  gateway: z.enum(['stripe', 'moneris']),
  moneris: z
    .object({
      storeId: z.string().optional(),
      apiToken: z.string().optional(),
      checkoutId: z.string().optional(),
      environment: z.enum(['qa', 'live']).optional(),
    })
    .optional(),
});

paymentsRouter.patch(
  '/gateway-config',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(gatewayConfigInput, req.body);
    await setOrgSetting(organizationId, 'payments:gateway', body.gateway);

    if (body.moneris) {
      const existingEncrypted = await getOrgSetting<string>(organizationId, 'payments:moneris');
      const existing = existingEncrypted ? decryptJson<MonerisCredentials>(existingEncrypted) : null;
      const merged: MonerisCredentials = {
        storeId: body.moneris.storeId ?? existing?.storeId ?? '',
        apiToken: body.moneris.apiToken ?? existing?.apiToken ?? '',
        checkoutId: body.moneris.checkoutId ?? existing?.checkoutId ?? '',
        environment: body.moneris.environment ?? existing?.environment ?? 'qa',
      };
      await setOrgSetting(organizationId, 'payments:moneris', encryptJson(merged));
    }
    res.json({ ok: true });
  }),
);

paymentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const bookingId = req.query.bookingId ? String(req.query.bookingId) : undefined;
    const payments = await prisma.payment.findMany({
      where: { organizationId, bookingId },
      orderBy: { createdAt: 'desc' },
      include: { booking: { select: { guestName: true, externalRef: true } } },
    });

    const captured = payments.filter((p) => p.status === 'captured' || p.status === 'partially_refunded');
    const totals = {
      grossCents: captured.reduce((s, p) => s + p.amountCents, 0),
      commissionCents: captured.reduce((s, p) => s + p.commissionCents, 0),
      netCents: captured.reduce((s, p) => s + p.netCents, 0),
      transferredCents: captured.filter((p) => p.transferredToConnectAt).reduce((s, p) => s + p.netCents, 0),
    };

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeConnectStatus: true, commissionRateBps: true },
    });

    res.json({
      payments,
      totals,
      gateway: { name: getPaymentGateway().name, configured: getPaymentGateway().configured },
      connectStatus: org.stripeConnectStatus,
      commissionRateBps: org.commissionRateBps,
    });
  }),
);

const chargeInput = z.object({
  bookingId: z.string(),
  amountCents: z.number().int().min(1),
  currency: z.string().default('USD'),
  method: z.enum(['card', 'cash', 'bank_transfer', 'other']).default('card'),
});

/**
 * Charge a guest for (part of) a booking. `method: 'card'` goes through the configured
 * gateway as a **Stripe Connect destination charge**: the platform is charged, our
 * commission (`applicationFeeCents`) stays with us, and the rest moves automatically to
 * the property's own Stripe account if they've completed Connect onboarding — otherwise
 * the full amount sits on the platform account pending manual settlement.
 *
 * `cash` / `bank_transfer` / `other` mean the guest paid the property directly — no money
 * moves through us, so there's nothing to transfer, but the commission is still computed
 * and recorded (as an amount owed *to* the platform) for consistent reporting on the
 * Finance dashboard; settling that is outside this build's scope (e.g. a monthly invoice).
 */
paymentsRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(chargeInput, req.body);
    const booking = await assertOwned(
      () => prisma.booking.findUnique({ where: { id: body.bookingId } }),
      organizationId,
      'Booking',
    );
    const split = await computeCommission(organizationId, body.amountCents);

    if (body.method !== 'card') {
      const payment = await prisma.payment.create({
        data: {
          organizationId,
          bookingId: booking.id,
          amountCents: body.amountCents,
          currency: body.currency,
          status: 'captured',
          method: body.method,
          capturedAt: new Date(),
          commissionRateBps: split.rateBps,
          commissionCents: split.commissionCents,
          netCents: split.netCents,
        },
      });
      return res.status(201).json({ payment });
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeConnectAccountId: true, stripeConnectStatus: true },
    });
    const destinationAccountId = org.stripeConnectStatus === 'active' ? org.stripeConnectAccountId : null;

    const gateway = getPaymentGateway();
    const result = await gateway.charge({
      amountCents: body.amountCents,
      currency: body.currency,
      description: `Booking ${booking.externalRef} — ${booking.guestName}`,
      applicationFeeCents: split.commissionCents,
      destinationAccountId,
    });
    const payment = await prisma.payment.create({
      data: {
        organizationId,
        bookingId: booking.id,
        amountCents: body.amountCents,
        currency: body.currency,
        status: result.ok ? 'captured' : 'failed',
        method: 'card',
        gatewayRef: result.gatewayRef,
        capturedAt: result.ok ? new Date() : null,
        commissionRateBps: split.rateBps,
        commissionCents: split.commissionCents,
        netCents: split.netCents,
        transferredToConnectAt: result.ok && result.splitAtGateway ? new Date() : null,
      },
    });
    res.status(result.ok ? 201 : 402).json({ payment, gatewayMessage: result.message });
  }),
);

const refundInput = z.object({ amountCents: z.number().int().min(1) });

paymentsRouter.post(
  '/:id/refund',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const payment = await assertOwned(
      () => prisma.payment.findUnique({ where: { id: req.params.id } }),
      organizationId,
      'Payment',
    );
    if (payment.status !== 'captured' && payment.status !== 'partially_refunded') {
      throw badRequest('Only a captured payment can be refunded');
    }
    const body = parse(refundInput, req.body);
    const remaining = payment.amountCents - payment.refundedCents;
    if (body.amountCents > remaining) throw badRequest(`Cannot refund more than the remaining ${remaining} cents`);

    if (payment.method === 'card' && payment.gatewayRef) {
      const gateway = await getGatewayForPayment(organizationId, payment.gateway);
      const result = await gateway.refund({ gatewayRef: payment.gatewayRef, amountCents: body.amountCents });
      if (!result.ok) throw badRequest(result.message);
    }

    const refundedCents = payment.refundedCents + body.amountCents;
    // Refunding claws back our commission proportionally too (matches `refund_application_fee`
    // on the gateway side), so the ledger never shows us keeping a fee on a refunded stay.
    const refundRatio = body.amountCents / payment.amountCents;
    const commissionClawback = Math.round(payment.commissionCents * refundRatio);
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents,
        status: refundedCents >= payment.amountCents ? 'refunded' : 'partially_refunded',
        commissionCents: payment.commissionCents - commissionClawback,
        netCents: payment.netCents - (body.amountCents - commissionClawback),
      },
    });
    res.json({ payment: updated });
  }),
);
