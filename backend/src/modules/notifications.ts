import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler, badRequest, parse } from '../lib/http';
import { requireOrg } from '../lib/tenant';
import { requirePermission } from '../lib/permissions';
import { setOrgSetting } from '../lib/settings';
import { DEFAULT_TEMPLATES, getNotificationConfig, getTemplate, sendTest } from '../lib/notify/send';
import { emailConfigured } from '../lib/notify/email';
import { smsConfigured } from '../lib/notify/sms';

export const notificationsRouter = Router();
notificationsRouter.use(requireOrg);

notificationsRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const config = await getNotificationConfig(organizationId);
    res.json({ config, emailConfigured, smsConfigured });
  }),
);

const configInput = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  events: z.record(z.object({ email: z.boolean(), sms: z.boolean() })).optional(),
});

notificationsRouter.patch(
  '/config',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(configInput, req.body);
    const current = await getNotificationConfig(organizationId);
    const next = {
      ...current,
      ...body,
      events: { ...current.events, ...(body.events ?? {}) },
    };
    await setOrgSetting(organizationId, 'notify:config', next);
    res.json({ config: next });
  }),
);

const EVENT_KEYS = ['booking_confirmation', 'booking_cancelled', 'overbooking_alert', 'test'] as const;

notificationsRouter.get(
  '/templates',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const templates = Object.fromEntries(
      await Promise.all(EVENT_KEYS.map(async (k) => [k, await getTemplate(organizationId, k)] as const)),
    );
    res.json({ templates, defaults: DEFAULT_TEMPLATES });
  }),
);

const templateInput = z.object({ subject: z.string().min(1), body: z.string().min(1) });

notificationsRouter.patch(
  '/templates/:key',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const key = req.params.key as (typeof EVENT_KEYS)[number];
    if (!EVENT_KEYS.includes(key)) throw badRequest(`Unknown template key "${key}"`);
    const organizationId = req.user!.organizationId!;
    const body = parse(templateInput, req.body);
    await setOrgSetting(organizationId, `notify-template:${key}`, body);
    res.json({ template: body });
  }),
);

const testInput = z.object({ channel: z.enum(['email', 'sms']), recipient: z.string().min(3) });

notificationsRouter.post(
  '/test',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const body = parse(testInput, req.body);
    const result = await sendTest(organizationId, body.channel, body.recipient);
    res.json(result);
  }),
);

notificationsRouter.get(
  '/log',
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const logs = await prisma.notificationLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ logs });
  }),
);
