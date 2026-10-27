import { prisma } from '../../db';
import { logger } from '../logger';
import { getOrgSetting } from '../settings';
import { sendEmail, emailConfigured } from './email';
import { sendSms, smsConfigured } from './sms';

const log = logger('notify:send');

export type NotifyEventKey = 'booking_confirmation' | 'booking_cancelled' | 'overbooking_alert' | 'test';

export interface NotificationConfig {
  emailEnabled: boolean;
  smsEnabled: boolean;
  events: Record<string, { email: boolean; sms: boolean }>;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  emailEnabled: true,
  smsEnabled: false,
  events: {
    booking_confirmation: { email: true, sms: false },
    booking_cancelled: { email: true, sms: false },
    overbooking_alert: { email: true, sms: false },
  },
};

export interface NotificationTemplate {
  subject: string;
  body: string;
}

/** `{{var}}` templates — simple and dependency-free. */
export const DEFAULT_TEMPLATES: Record<NotifyEventKey, NotificationTemplate> = {
  booking_confirmation: {
    subject: 'Booking confirmed — {{guestName}}',
    body:
      'Hi {{guestName}}, your reservation at {{propertyName}} is confirmed for ' +
      '{{checkIn}} → {{checkOut}}. Total: {{amount}} {{currency}}. Thank you for booking with us!',
  },
  booking_cancelled: {
    subject: 'Booking cancelled — {{guestName}}',
    body: 'Hi {{guestName}}, your reservation at {{propertyName}} for {{checkIn}} → {{checkOut}} has been cancelled.',
  },
  overbooking_alert: {
    subject: '⚠ Overbooking detected at {{propertyName}}',
    body: '{{message}} Review it in the Conflicts screen.',
  },
  test: {
    subject: 'Test notification from Channel Manager',
    body: 'This is a test notification. If you received this, your {{channel}} configuration works.',
  },
};

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export async function getNotificationConfig(organizationId: string): Promise<NotificationConfig> {
  const stored = await getOrgSetting<NotificationConfig>(organizationId, 'notify:config');
  return stored
    ? { ...DEFAULT_NOTIFICATION_CONFIG, ...stored, events: { ...DEFAULT_NOTIFICATION_CONFIG.events, ...stored.events } }
    : DEFAULT_NOTIFICATION_CONFIG;
}

export async function getTemplate(organizationId: string, key: NotifyEventKey): Promise<NotificationTemplate> {
  const stored = await getOrgSetting<NotificationTemplate>(organizationId, `notify-template:${key}`);
  return stored ?? DEFAULT_TEMPLATES[key];
}

async function logSend(
  organizationId: string,
  type: string,
  channel: 'email' | 'sms',
  recipient: string,
  ok: boolean,
  error?: string,
) {
  await prisma.notificationLog
    .create({
      data: { organizationId, type, channel, recipient, status: ok ? 'sent' : 'failed', error: error ?? '' },
    })
    .catch(() => undefined);
}

/**
 * Best-effort notification send — renders the org's template for `event`, respects the
 * org's on/off toggles, and never throws (a notification failure must never block a
 * booking or a conflict from being recorded).
 */
export async function notify(
  organizationId: string,
  event: NotifyEventKey,
  opts: { email?: string | null; phone?: string | null; vars: Record<string, string> },
): Promise<void> {
  try {
    const config = await getNotificationConfig(organizationId);
    const eventCfg = config.events[event] ?? { email: false, sms: false };
    const template = await getTemplate(organizationId, event);

    if (config.emailEnabled && eventCfg.email && opts.email) {
      const result = await sendEmail({
        to: opts.email,
        subject: render(template.subject, opts.vars),
        html: render(template.body, opts.vars).replace(/\n/g, '<br/>'),
      });
      await logSend(organizationId, event, 'email', opts.email, result.ok, result.ok ? undefined : result.message);
    }
    if (config.smsEnabled && eventCfg.sms && opts.phone) {
      const result = await sendSms({ to: opts.phone, body: render(template.body, opts.vars) });
      await logSend(organizationId, event, 'sms', opts.phone, result.ok, result.ok ? undefined : result.message);
    }
  } catch (err) {
    log.error(`notify(${event}) failed`, err);
  }
}

/** "Send test" action on the Notifications settings screen. */
export async function sendTest(
  organizationId: string,
  channel: 'email' | 'sms',
  recipient: string,
): Promise<{ ok: boolean; message: string }> {
  const template = DEFAULT_TEMPLATES.test;
  if (channel === 'email') {
    const result = await sendEmail({
      to: recipient,
      subject: template.subject,
      html: render(template.body, { channel: 'email' }),
    });
    await logSend(organizationId, 'test', 'email', recipient, result.ok, result.ok ? undefined : result.message);
    return result;
  }
  const result = await sendSms({ to: recipient, body: render(template.body, { channel: 'SMS' }) });
  await logSend(organizationId, 'test', 'sms', recipient, result.ok, result.ok ? undefined : result.message);
  return result;
}

export { emailConfigured, smsConfigured };
