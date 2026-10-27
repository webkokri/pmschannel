import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, badRequest, unauthorized } from '../lib/http';
import { logger } from '../lib/logger';
import { timingSafeEqual } from '../lib/crypto';
import { resolveConnection } from '../connectors/registry';
import { ingestBooking } from './ingest';

const log = logger('webhooks');
export const webhookRouter = Router();

/**
 * Inbound booking webhook. Real OTAs POST here; the connector's `parseWebhook`
 * turns the body into normalized bookings which then run through the standard
 * ingest pipeline. Every call is persisted to `WebhookEvent` first for audit.
 *
 *   POST /api/webhooks/:channelCode?propertyCode=PROP
 */
webhookRouter.post(
  '/:channelCode',
  asyncHandler(async (req, res) => {
    const { channelCode } = req.params;
    const channel = await prisma.channel.findUnique({ where: { code: channelCode } });
    if (!channel) throw badRequest(`Unknown channel code "${channelCode}"`);

    const event = await prisma.webhookEvent.create({
      data: {
        channelCode,
        headers: sanitizeHeaders(req.headers) as object,
        body: (req.body ?? {}) as object,
      },
    });

    try {
      const propertyCode =
        (req.query.propertyCode as string) ||
        (req.body?.propertyCode as string) ||
        (Array.isArray(req.body) ? req.body[0]?.propertyCode : undefined);
      if (!propertyCode) throw badRequest('propertyCode is required (query or body)');

      const property = await prisma.property.findUnique({ where: { code: propertyCode } });
      if (!property) throw badRequest(`Unknown property code "${propertyCode}"`);
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { organizationId: property.organizationId } });

      const connection = await prisma.channelConnection.findUnique({
        where: { propertyId_channelId: { propertyId: property.id, channelId: channel.id } },
      });
      if (!connection) throw badRequest(`No connection for ${channelCode} on property ${propertyCode}`);

      // This endpoint is unauthenticated by necessity (a real OTA has no session), and
      // `propertyCode` is intentionally public (the booking microsite/SEO surface), so
      // the secret is the only thing stopping anyone who finds a property code from
      // injecting fake bookings. Fail closed if it's missing or wrong — never treat an
      // unset stored secret as "no secret required".
      const providedSecret = (req.query.secret as string) || (req.headers['x-webhook-secret'] as string) || '';
      if (!connection.webhookSecret || !timingSafeEqual(providedSecret, connection.webhookSecret)) {
        throw unauthorized('Missing or invalid webhook secret for this connection.');
      }

      const { connector, ctx } = await resolveConnection(connection.id);
      const normalized = connector.parseWebhook
        ? connector.parseWebhook(ctx, req.headers as Record<string, unknown>, req.body)
        : [];

      const outcomes = [];
      for (const nb of normalized) {
        outcomes.push(await ingestBooking(channelCode, nb, { sourceConnectionId: connection.id }));
      }

      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true } });
      res.json({ received: normalized.length, outcomes });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { error: message } });
      log.error(`webhook ${channelCode} failed: ${message}`);
      throw err;
    }
  }),
);

function sanitizeHeaders(headers: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (['authorization', 'cookie', 'x-api-key'].includes(k.toLowerCase())) out[k] = '[redacted]';
    else out[k] = v;
  }
  return out;
}
