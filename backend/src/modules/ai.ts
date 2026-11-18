import { Router } from 'express';
import { z } from 'zod';
import { addDays, nightsBetween, todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { requireOrg, resolvePropertyFilter } from '../lib/tenant';
import { requireRole } from '../auth';
import { aiConfigured, chat, chatJson } from '../lib/ai/claude';

export const aiRouter = Router();
aiRouter.use(requireOrg);

aiRouter.get(
  '/status',
  asyncHandler(async (_req, res) => res.json({ configured: aiConfigured })),
);

/** Assemble a compact, read-only snapshot of the org's current state for the model —
 *  the assistant answers *from this*, it never queries the database itself (see
 *  lib/ai/claude.ts for why: no tool-use loop, so there's no path to a mutating call). */
async function buildSnapshot(organizationId: string, propertyId?: string) {
  const propFilter = { organizationId, ...(propertyId ? { propertyId } : {}) };
  const [properties, recentBookings, openConflicts, occupancyRooms] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId, ...(propertyId ? { id: propertyId } : {}) },
      select: { id: true, name: true, code: true },
    }),
    prisma.booking.findMany({
      where: propFilter,
      orderBy: { receivedAt: 'desc' },
      take: 15,
      select: { guestName: true, status: true, checkIn: true, checkOut: true, amount: true, currency: true, sourceChannel: { select: { name: true } } },
    }),
    prisma.conflictAlert.findMany({
      where: { organizationId, status: 'open' },
      take: 10,
      select: { type: true, severity: true, details: true },
    }),
    prisma.roomType.findMany({ where: { property: propFilter }, select: { id: true, name: true, totalUnits: true } }),
  ]);

  const from = todayIso();
  const to = addDays(from, 14);
  const dateObjs = nightsBetween(from, to).map((d) => new Date(d + 'T00:00:00Z'));
  const occupancy: { room: string; occupancyPct: number }[] = [];
  for (const room of occupancyRooms) {
    const agg = await prisma.bookingNight.aggregate({
      where: { date: { in: dateObjs }, booking: { roomTypeId: room.id, status: { in: ['confirmed', 'modified'] } } },
      _sum: { units: true },
    });
    const sold = agg._sum.units ?? 0;
    const capacity = room.totalUnits * dateObjs.length;
    occupancy.push({ room: room.name, occupancyPct: capacity > 0 ? Math.round((sold / capacity) * 100) : 0 });
  }

  return {
    properties: properties.map((p) => `${p.name} (${p.code})`),
    next14DayOccupancy: occupancy,
    openConflicts: openConflicts.map((c) => ({ type: c.type, severity: c.severity, message: (c.details as { message?: string })?.message })),
    recentBookings: recentBookings.map((b) => ({
      guest: b.guestName,
      status: b.status,
      channel: b.sourceChannel.name,
      checkIn: b.checkIn.toISOString().slice(0, 10),
      checkOut: b.checkOut.toISOString().slice(0, 10),
      amount: `${b.amount} ${b.currency}`,
    })),
  };
}

const SYSTEM_PROMPT =
  'You are the in-app assistant for a hotel channel-manager admin panel. Answer questions about ' +
  'bookings, occupancy and conflicts using ONLY the JSON snapshot of current data provided below — ' +
  "never invent bookings, guests or numbers that aren't in it. You cannot take actions yourself " +
  '(no booking creation, no cancellations, no price changes) — if asked to do something, explain ' +
  'clearly which screen in the app to use instead. Be concise and concrete.';

const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).min(1).max(20),
  propertyId: z.string().optional(),
});

aiRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(chatInput, req.body);
    const snapshot = await buildSnapshot(organizationId, resolvePropertyFilter(req, body.propertyId));
    const system = `${SYSTEM_PROMPT}\n\nCurrent data snapshot:\n${JSON.stringify(snapshot)}`;
    const result = await chat(body.messages, system);
    res.json({ ok: result.ok, reply: result.text });
  }),
);

aiRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const status = req.query.status ? String(req.query.status) : undefined;
    // AiSuggestion carries no propertyId, so this can't be filtered by property —
    // acceptable here since these are just draft pricing/occupancy notes, not booking data.
    const suggestions = await prisma.aiSuggestion.findMany({
      where: { organizationId, status: status as never },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ suggestions });
  }),
);

const generateInput = z.object({ propertyId: z.string().optional() });

/** Feeds the occupancy/pricing snapshot to Claude and asks for a short list of concrete
 *  suggestions — stored as `AiSuggestion` rows for staff to review and action manually
 *  (via Pricing/RMS) rather than auto-applied. */
aiRouter.post(
  '/suggestions/generate',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(generateInput, req.body);
    const snapshot = await buildSnapshot(organizationId, resolvePropertyFilter(req, body.propertyId));

    const prompt =
      `Given this hotel occupancy/booking snapshot, suggest 2-4 concrete pricing or occupancy ` +
      `actions for the next two weeks. Snapshot:\n${JSON.stringify(snapshot)}\n\n` +
      `Return a JSON array of objects: [{ "type": "pricing"|"occupancy", "subject": "short title", "content": "1-2 sentence recommendation with reasoning" }]`;

    const suggestions = await chatJson<Array<{ type: 'pricing' | 'occupancy'; subject: string; content: string }>>(
      prompt,
      SYSTEM_PROMPT,
    );

    if (!suggestions) {
      return res.json({ created: 0, suggestions: [], message: aiConfigured ? 'AI did not return usable suggestions' : 'AI is not configured (no ANTHROPIC_API_KEY)' });
    }

    const created = await prisma.$transaction(
      suggestions.slice(0, 6).map((s) =>
        prisma.aiSuggestion.create({
          data: { organizationId, type: s.type === 'occupancy' ? 'occupancy' : 'pricing', subject: s.subject, content: s.content },
        }),
      ),
    );
    res.json({ created: created.length, suggestions: created });
  }),
);

const statusInput = z.object({ status: z.enum(['applied', 'dismissed']) });

aiRouter.patch(
  '/suggestions/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(statusInput, req.body);
    const existing = await prisma.aiSuggestion.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizationId !== organizationId) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }
    const suggestion = await prisma.aiSuggestion.update({ where: { id: req.params.id }, data: { status: body.status } });
    res.json({ suggestion });
  }),
);
