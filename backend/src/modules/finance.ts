import { Router } from 'express';
import { z } from 'zod';
import { todayIso } from '@cm/shared';
import { prisma } from '../db';
import { asyncHandler, parse } from '../lib/http';
import { requireOrg, assertOwned } from '../lib/tenant';
import { requirePermission } from '../lib/permissions';

export const financeRouter = Router();
financeRouter.use(requireOrg);

/**
 * Revenue (booked amount) minus channel commission minus expenses, for a date range.
 * Commission is estimated from each booking's source channel connection's
 * `commissionPct` — a simple, transparent model rather than true per-transaction fees.
 */
financeRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
    const from = String(req.query.from ?? todayIso().slice(0, 8) + '01');
    const to = String(req.query.to ?? todayIso());

    const bookingWhere = {
      organizationId,
      propertyId,
      status: { in: ['confirmed', 'modified'] as ('confirmed' | 'modified')[] },
      checkIn: { gte: new Date(from + 'T00:00:00Z') },
      checkOut: { lte: new Date(to + 'T23:59:59Z') },
    };

    const bookings = await prisma.booking.findMany({
      where: bookingWhere,
      select: {
        amount: true,
        sourceChannel: { select: { id: true, name: true } },
        propertyId: true,
      },
    });

    const connections = await prisma.channelConnection.findMany({
      where: { organizationId, propertyId },
      select: { channelId: true, commissionPct: true },
    });
    const commissionByChannel = new Map(connections.map((c) => [c.channelId, Number(c.commissionPct)]));

    let grossRevenue = 0;
    let commissionCost = 0;
    const byChannel = new Map<string, { channel: string; bookings: number; gross: number; commission: number }>();

    for (const b of bookings) {
      const amount = Number(b.amount);
      grossRevenue += amount;
      // channelId isn't selected directly; look it up via sourceChannel.id
      const pct = commissionByChannel.get(b.sourceChannel.id) ?? 0;
      const commission = (amount * pct) / 100;
      commissionCost += commission;
      const bucket = byChannel.get(b.sourceChannel.name) ?? { channel: b.sourceChannel.name, bookings: 0, gross: 0, commission: 0 };
      bucket.bookings++;
      bucket.gross += amount;
      bucket.commission += commission;
      byChannel.set(b.sourceChannel.name, bucket);
    }

    const expenses = await prisma.expense.findMany({
      where: { organizationId, propertyId, incurredAt: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') } },
      orderBy: { incurredAt: 'desc' },
    });
    const expenseTotal = expenses.reduce((s, e) => s + e.amountCents / 100, 0);

    const netRevenue = grossRevenue - commissionCost - expenseTotal;

    // Guest payments processed through the platform, and our commission on them — a
    // separate ledger from OTA commission above (that's what Booking.com/Expedia charge
    // the property; this is what *we* charge for processing + distribution).
    const paymentAgg = await prisma.payment.aggregate({
      where: {
        organizationId,
        status: { in: ['captured', 'partially_refunded', 'refunded'] },
        createdAt: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') },
      },
      _sum: { amountCents: true, commissionCents: true, netCents: true, refundedCents: true },
    });
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeConnectStatus: true, commissionRateBps: true },
    });

    res.json({
      from,
      to,
      grossRevenue,
      commissionCost,
      expenseTotal,
      netRevenue,
      byChannel: [...byChannel.values()].sort((a, b) => b.gross - a.gross),
      expenses,
      platformPayments: {
        grossCents: paymentAgg._sum.amountCents ?? 0,
        commissionCents: paymentAgg._sum.commissionCents ?? 0,
        netCents: paymentAgg._sum.netCents ?? 0,
        refundedCents: paymentAgg._sum.refundedCents ?? 0,
        connectStatus: org.stripeConnectStatus,
        commissionRateBps: org.commissionRateBps,
      },
    });
  }),
);

const expenseInput = z.object({
  propertyId: z.string(),
  category: z.enum(['utilities', 'payroll', 'maintenance', 'supplies', 'marketing', 'other']),
  amountCents: z.number().int().min(0),
  currency: z.string().default('USD'),
  incurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendor: z.string().default(''),
  note: z.string().default(''),
});

financeRouter.post(
  '/expenses',
  requirePermission('finance.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(expenseInput, req.body);
    await assertOwned(() => prisma.property.findUnique({ where: { id: body.propertyId } }), organizationId, 'Property');
    const expense = await prisma.expense.create({
      data: { ...body, organizationId, incurredAt: new Date(body.incurredAt + 'T00:00:00Z') },
    });
    res.status(201).json({ expense });
  }),
);

financeRouter.patch(
  '/expenses/:id',
  requirePermission('finance.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.expense.findUnique({ where: { id: req.params.id } }), organizationId, 'Expense');
    const body = parse(expenseInput.partial().omit({ propertyId: true }), req.body);
    const data = { ...body, incurredAt: body.incurredAt ? new Date(body.incurredAt + 'T00:00:00Z') : undefined };
    const expense = await prisma.expense.update({ where: { id: req.params.id }, data });
    res.json({ expense });
  }),
);

financeRouter.delete(
  '/expenses/:id',
  requirePermission('finance.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await assertOwned(() => prisma.expense.findUnique({ where: { id: req.params.id } }), organizationId, 'Expense');
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
