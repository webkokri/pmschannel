/**
 * SMS sending via Twilio. Inert until `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` are all
 * set. Not exercised against a real Twilio account in this build.
 */
import { env } from '../../env';
import { logger } from '../logger';
import type { SendResult } from './email';

const log = logger('notify:sms');

export const smsConfigured = Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber);

export async function sendSms(opts: { to: string; body: string }): Promise<SendResult> {
  if (!smsConfigured) {
    return { ok: false, message: 'SMS is not configured on this server (no TWILIO_* env vars set).' };
  }
  try {
    const { default: Twilio } = await import('twilio');
    const client = Twilio(env.twilioAccountSid, env.twilioAuthToken);
    await client.messages.create({ to: opts.to, from: env.twilioFromNumber, body: opts.body });
    return { ok: true, message: 'sent' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('sendSms failed', err);
    return { ok: false, message };
  }
}
