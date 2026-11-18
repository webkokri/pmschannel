import { Router } from 'express';
import { z } from 'zod';
import { addDays, nightsBetween, todayIso, type NormalizedBooking } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { env } from '../env';
import { logger } from '../lib/logger';
import { ingestBooking } from '../engine/ingest';
import { getGuestPaymentGateway } from '../lib/payments';
import { verifyMonerisReceipt, type MonerisCredentials } from '../lib/payments/moneris-gateway';
import { computeCommission } from '../lib/commission';
import { getOrgSetting } from '../lib/settings';
import { decryptJson } from '../lib/crypto';

const log = logger('public-checkout');

/**
 * Unauthenticated public booking microsite backend — mounted before `authRequired`, like
 * the OTA webhooks. Only ever reads/writes through `published` properties. Two ways to
 * complete a booking: the free `POST /bookings/:code` (confirms immediately, guest pays
 * the property directly later — used when no payment gateway is configured) or the paid
 * checkout flow below (`POST /bookings/:code/checkout` → gateway → webhook/receipt →
 * `finalizePaidDirectBooking`), which only ever creates the real booking — through the
 * same `ingestBooking` pipeline every other channel uses — once payment is confirmed.
 */
export const publicRouter = Router();

/**
 * Turns a paid `PendingDirectBooking` into a real booking once the gateway confirms
 * payment. Idempotent (a webhook or a receipt check can both fire for the same payment).
 * If the room sold out between checkout start and payment confirmation — a real
 * possibility since nothing is held while payment is in flight — the guest is refunded
 * automatically rather than left having paid for a booking that was rejected.
 */
export async function finalizePaidDirectBooking(pendingId: string, gatewayRef: string): Promise<void> {
  const pending = await prisma.pendingDirectBooking.findUnique({ where: { id: pendingId } });
  if (!pending || pending.status !== 'pending') return;

  const [property, room] = await Promise.all([
    prisma.property.findUniqueOrThrow({ where: { id: pending.propertyId } }),
    prisma.roomType.findUniqueOrThrow({ where: { id: pending.roomTypeId } }),
  ]);

  const normalized: NormalizedBooking = {
    externalRef: `WEB-${pending.id}`,
    status: 'confirmed',
    channelCode: 'direct_web',
    propertyCode: property.code,
    externalRoomId: `direct_web-${room.code}`,
    externalRatePlanId: null,
    guestName: pending.guestName,
    guestEmail: pending.guestEmail,
    guestPhone: pending.guestPhone,
    checkIn: pending.checkIn.toISOString().slice(0, 10),
    checkOut: pending.checkOut.toISOString().slice(0, 10),
    units: pending.units,
    adults: pending.adults,
    children: pending.children,
    currency: pending.currency,
    amount: pending.amountCents / 100,
    bookedAt: new Date().toISOString(),
    raw: { source: 'public_microsite', gateway: pending.gateway, gatewayRef },
  };

  const outcome = await ingestBooking('direct_web', normalized, { roomTypeId: pending.roomTypeId });

  if (outcome.rejected) {
    const gateway = await getGuestPaymentGateway(pending.organizationId);
    const refund = await gateway.refund({ gatewayRef, amountCents: pending.amountCents });
    await prisma.pendingDirectBooking.update({ where: { id: pending.id }, data: { status: 'rejected', bookingId: outcome.bookingId } });
    log.warn(
      `direct booking ${pending.id} lost the overbooking race after payment — refund ${refund.ok ? 'issued' : `FAILED: ${refund.message}`}`,
    );
    return;
  }

  const split = await computeCommission(pending.organizationId, pending.amountCents);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: pending.organizationId },
    select: { stripeConnectAccountId: true, stripeConnectStatus: true },
  });
  const splitAtGateway = pending.gateway === 'stripe' && org.stripeConnectStatus === 'active';

  await prisma.payment.create({
    data: {
      organizationId: pending.organizationId,
      bookingId: outcome.bookingId,
      amountCents: pending.amountCents,
      currency: pending.currency,
      status: 'captured',
      method: 'card',
      gateway: pending.gateway,
      gatewayRef,
      capturedAt: new Date(),
      commissionRateBps: split.rateBps,
      commissionCents: split.commissionCents,
      netCents: split.netCents,
      transferredToConnectAt: splitAtGateway ? new Date() : null,
    },
  });

  await prisma.pendingDirectBooking.update({ where: { id: pending.id }, data: { status: 'completed', bookingId: outcome.bookingId } });
}

publicRouter.get(
  '/properties/:code',
  asyncHandler(async (req, res) => {
    const property = await prisma.property.findUnique({
      where: { code: req.params.code },
      include: {
        seo: true,
        faqs: { orderBy: { sortOrder: 'asc' } },
        roomTypes: { orderBy: { name: 'asc' } },
        pageContent: true,
      },
    });
    if (!property || !property.active || !property.seo?.published) throw notFound('Property not found');

    const from = todayIso();
    const to = addDays(from, 60);
    const dates = nightsBetween(from, to);
    const dateObjs = dates.map((d) => new Date(d + 'T00:00:00Z'));

    const roomTypeIds = property.roomTypes.map((r) => r.id);
    const days = await prisma.calendarDay.findMany({ where: { roomTypeId: { in: roomTypeIds }, date: { in: dateObjs } } });
    const byRoom = new Map<string, typeof days>();
    for (const d of days) byRoom.set(d.roomTypeId, [...(byRoom.get(d.roomTypeId) ?? []), d]);

    const packages = await prisma.package.findMany({ where: { propertyId: property.id, active: true } });
    const gateway = await getGuestPaymentGateway(property.organizationId);

    res.json({
      paymentGateway: { configured: gateway.configured, name: gateway.name },
      property: {
        code: property.code,
        name: property.name,
        city: property.city,
        region: property.region,
        country: property.country,
        currency: property.currency,
      },
      seo: {
        metaTitle: property.seo.metaTitle || property.name,
        metaDescription: property.seo.metaDescription,
        keywords: property.seo.keywords,
        ogImageUrl: property.seo.ogImageUrl,
      },
      faqs: property.faqs.map((f) => ({ question: f.question, answer: f.answer })),
      pageContent: property.pageContent
        ? {
            heroHeadline: property.pageContent.heroHeadline,
            heroSubheadline: property.pageContent.heroSubheadline,
            heroImageUrl: property.pageContent.heroImageUrl,
            primaryColor: property.pageContent.primaryColor,
            aboutText: property.pageContent.aboutText,
            amenities: property.pageContent.amenities,
            galleryImageUrls: property.pageContent.galleryImageUrls,
            sections: property.pageContent.sections as { id: string; heading: string; body: string }[],
          }
        : null,
      roomTypes: property.roomTypes.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        maxOccupancy: r.maxOccupancy,
        basePrice: Number(r.basePrice),
        calendar: (byRoom.get(r.id) ?? []).map((d) => ({
          date: d.date.toISOString().slice(0, 10),
          price: Number(d.price),
          available: d.availableUnits > 0 && !d.stopSell,
          minStay: d.minStay,
        })),
      })),
      packages: packages.map((p) => ({
        id: p.id,
        roomTypeId: p.roomTypeId,
        name: p.name,
        description: p.description,
        priceAdjustType: p.priceAdjustType,
        priceValue: Number(p.priceValue),
        includedAddons: p.includedAddons,
      })),
    });
  }),
);

const bookingInput = z.object({
  roomTypeId: z.string(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guestName: z.string().min(1),
  guestEmail: z.string().email(),
  guestPhone: z.string().min(1),
  units: z.number().int().min(1).default(1),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
});

/** Same party-fits-the-room(s) check the search results already applied client-side —
 *  enforced again server-side since the client can't be trusted to have respected it. */
function assertPartyFits(maxOccupancy: number, units: number, adults: number, children: number) {
  if (adults + children > maxOccupancy * units) {
    throw badRequest(`This room sleeps up to ${maxOccupancy * units} across ${units} room(s) — reduce guests or add another room.`);
  }
}

publicRouter.post(
  '/bookings/:code',
  asyncHandler(async (req, res) => {
    const property = await prisma.property.findUnique({
      where: { code: req.params.code },
      include: { seo: true },
    });
    if (!property || !property.active || !property.seo?.published) throw notFound('Property not found');

    const body = parse(bookingInput, req.body);
    if (body.checkOut <= body.checkIn) throw badRequest('checkOut must be after checkIn');

    const room = await prisma.roomType.findFirst({ where: { id: body.roomTypeId, propertyId: property.id } });
    if (!room) throw badRequest('Unknown room type for this property');
    assertPartyFits(room.maxOccupancy, body.units, body.adults, body.children);

    const days = await prisma.calendarDay.findMany({
      where: {
        roomTypeId: room.id,
        date: { in: nightsBetween(body.checkIn, body.checkOut).map((d) => new Date(d + 'T00:00:00Z')) },
      },
    });
    const amount = days.reduce((s, d) => s + Number(d.price), 0) * body.units || Number(room.basePrice) * nightsBetween(body.checkIn, body.checkOut).length;

    const normalized: NormalizedBooking = {
      externalRef: `WEB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'confirmed',
      channelCode: 'direct_web',
      propertyCode: property.code,
      externalRoomId: `direct_web-${room.code}`,
      externalRatePlanId: null,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      guestPhone: body.guestPhone,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      units: body.units,
      adults: body.adults,
      children: body.children,
      currency: property.currency,
      amount,
      bookedAt: new Date().toISOString(),
      raw: { source: 'public_microsite' },
    };

    const outcome = await ingestBooking('direct_web', normalized, { roomTypeId: room.id });
    if (outcome.rejected) {
      throw badRequest('Sorry — that room is no longer available for those dates. Please choose different dates.');
    }
    res.status(201).json({ confirmed: true, reference: normalized.externalRef, amount, currency: property.currency });
  }),
);

/** Starts a paid checkout — creates a `PendingDirectBooking` (nothing reserved yet) and a
 *  gateway checkout session/ticket for its amount. The booking itself is only created once
 *  payment is confirmed (`finalizePaidDirectBooking`, called from the Stripe webhook or
 *  the Moneris receipt-verification endpoint below). */
publicRouter.post(
  '/bookings/:code/checkout',
  asyncHandler(async (req, res) => {
    const property = await prisma.property.findUnique({ where: { code: req.params.code }, include: { seo: true } });
    if (!property || !property.active || !property.seo?.published) throw notFound('Property not found');

    const body = parse(bookingInput, req.body);
    if (body.checkOut <= body.checkIn) throw badRequest('checkOut must be after checkIn');
    const room = await prisma.roomType.findFirst({ where: { id: body.roomTypeId, propertyId: property.id } });
    if (!room) throw badRequest('Unknown room type for this property');
    assertPartyFits(room.maxOccupancy, body.units, body.adults, body.children);

    const nights = nightsBetween(body.checkIn, body.checkOut);
    const days = await prisma.calendarDay.findMany({
      where: { roomTypeId: room.id, date: { in: nights.map((d) => new Date(d + 'T00:00:00Z')) } },
    });
    const amount =
      days.length === nights.length
        ? days.reduce((s, d) => s + Number(d.price), 0) * body.units
        : Number(room.basePrice) * nights.length * body.units;
    const amountCents = Math.round(amount * 100);

    const gatewayChoice = (await getOrgSetting<string>(property.organizationId, 'payments:gateway')) ?? 'stripe';
    const pending = await prisma.pendingDirectBooking.create({
      data: {
        organizationId: property.organizationId,
        propertyId: property.id,
        roomTypeId: room.id,
        checkIn: new Date(body.checkIn + 'T00:00:00Z'),
        checkOut: new Date(body.checkOut + 'T00:00:00Z'),
        units: body.units,
        guestName: body.guestName,
        guestEmail: body.guestEmail,
        guestPhone: body.guestPhone,
        adults: body.adults,
        children: body.children,
        amountCents,
        currency: property.currency,
        gateway: gatewayChoice,
      },
    });

    const split = await computeCommission(property.organizationId, amountCents);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: property.organizationId },
      select: { stripeConnectAccountId: true, stripeConnectStatus: true },
    });
    const destinationAccountId = org.stripeConnectStatus === 'active' ? org.stripeConnectAccountId : null;

    const gateway = await getGuestPaymentGateway(property.organizationId);
    const result = await gateway.createGuestCheckout({
      amountCents,
      currency: property.currency,
      description: `${property.name} — ${room.name}, ${body.checkIn} to ${body.checkOut}`,
      applicationFeeCents: split.commissionCents,
      destinationAccountId,
      successUrl: `${env.publicAppUrl}/book/${property.code}?checkout=success&ref=${pending.id}`,
      cancelUrl: `${env.publicAppUrl}/book/${property.code}?checkout=cancelled`,
      checkoutRef: pending.id,
    });

    if (!result.ok) {
      await prisma.pendingDirectBooking.delete({ where: { id: pending.id } });
      throw badRequest(result.message);
    }
    res.status(201).json({ checkoutRef: pending.id, amountCents, currency: property.currency, ...result });
  }),
);

/** Polled by the public page after a redirect/widget completion to show the final state. */
publicRouter.get(
  '/bookings/checkout-status/:ref',
  asyncHandler(async (req, res) => {
    const pending = await prisma.pendingDirectBooking.findUnique({ where: { id: req.params.ref } });
    if (!pending) throw notFound('Unknown checkout reference');
    res.json({ status: pending.status, amountCents: pending.amountCents, currency: pending.currency });
  }),
);

/** Called by the public page once Moneris Checkout's widget reports a successful payment.
 *  The widget's own "success" callback is client-reported and never trusted on its own —
 *  this verifies the ticket server-to-server with Moneris before finalizing anything. */
publicRouter.post(
  '/bookings/checkout/:ref/moneris-complete',
  asyncHandler(async (req, res) => {
    const pending = await prisma.pendingDirectBooking.findUnique({ where: { id: req.params.ref } });
    if (!pending || pending.gateway !== 'moneris') throw notFound('Unknown checkout reference');
    if (pending.status !== 'pending') return res.json({ status: pending.status });

    const { ticket } = parse(z.object({ ticket: z.string().min(1) }), req.body);
    const encrypted = await getOrgSetting<string>(pending.organizationId, 'payments:moneris');
    const creds = encrypted ? decryptJson<MonerisCredentials>(encrypted) : null;
    if (!creds) throw badRequest('Moneris is not configured for this property.');

    const receipt = await verifyMonerisReceipt(creds, ticket);
    if (!receipt.success || receipt.amountCents !== pending.amountCents) {
      throw badRequest(`Payment could not be verified: ${receipt.message}`);
    }

    await finalizePaidDirectBooking(pending.id, `${receipt.orderId}|${receipt.txnNumber}`);
    const after = await prisma.pendingDirectBooking.findUniqueOrThrow({ where: { id: pending.id } });
    res.json({ status: after.status, bookingId: after.bookingId });
  }),
);

/**
 * The embeddable booking-widget loader — a generic, property-agnostic script a hotel
 * pastes once into their own site (alongside a marker `<div data-cm-booking-widget="CODE">`).
 * It builds an iframe pointed at that property's `/book/:code?embed=1` page and keeps it
 * sized to its content via `postMessage`, so the embed blends into the host page instead
 * of needing a fixed height guessed up front. Served from here (not a static file) so its
 * origin always matches whatever `PUBLIC_APP_URL` this server is actually running as.
 */
publicRouter.get(
  '/widget.js',
  asyncHandler(async (_req, res) => {
    const appOrigin = env.publicAppUrl;
    const js = `(function () {
  var ORIGIN = ${JSON.stringify(appOrigin)};
  function mount(el) {
    var code = el.getAttribute('data-cm-booking-widget');
    if (!code || el.querySelector('iframe[data-cm-booking-iframe]')) return;
    var iframe = document.createElement('iframe');
    iframe.setAttribute('data-cm-booking-iframe', '1');
    iframe.src = ORIGIN + '/book/' + encodeURIComponent(code) + '?embed=1';
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = '640px';
    iframe.style.display = 'block';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Book now');
    el.appendChild(iframe);
    window.addEventListener('message', function (e) {
      if (e.origin !== ORIGIN) return;
      if (e.source !== iframe.contentWindow) return;
      if (e.data && e.data.type === 'cm-resize' && typeof e.data.height === 'number') {
        iframe.style.height = Math.max(320, e.data.height) + 'px';
      }
    });
  }
  function mountAll() {
    var els = document.querySelectorAll('[data-cm-booking-widget]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();`;
    res.setHeader('content-type', 'application/javascript; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.send(js);
  }),
);

publicRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const properties = await prisma.property.findMany({
      where: { active: true, seo: { published: true } },
      select: { code: true, updatedAt: true },
    });
    const urls = properties
      .map(
        (p) =>
          `<url><loc>${env.publicAppUrl}/book/${p.code}</loc><lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`,
      )
      .join('');
    res.setHeader('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }),
);
