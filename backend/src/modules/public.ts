import { Router } from 'express';
import { z } from 'zod';
import { addDays, nightsBetween, todayIso, type NormalizedBooking } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, badRequest, notFound, parse } from '../lib/http';
import { env } from '../env';
import { ingestBooking } from '../engine/ingest';

/**
 * Unauthenticated public booking microsite backend — mounted before `authRequired`, like
 * the OTA webhooks. Only ever reads/writes through `published` properties, and the only
 * write it allows is creating a booking (through the same `ingestBooking` pipeline every
 * other channel uses, so it's conflict-checked identically).
 */
export const publicRouter = Router();

publicRouter.get(
  '/properties/:code',
  asyncHandler(async (req, res) => {
    const property = await prisma.property.findUnique({
      where: { code: req.params.code },
      include: {
        seo: true,
        faqs: { orderBy: { sortOrder: 'asc' } },
        roomTypes: { orderBy: { name: 'asc' } },
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

    res.json({
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
  units: z.number().int().min(1).default(1),
});

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
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      units: body.units,
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
