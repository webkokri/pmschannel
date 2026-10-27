/**
 * Email sending via plain SMTP (nodemailer) — works with any provider (Postmark,
 * SendGrid, Amazon SES, a Gmail app password, …) since they all speak SMTP. Inert until
 * `SMTP_HOST/PORT/USER/PASS/FROM` are all set. Not exercised against a real mailbox in
 * this build.
 */
import { env } from '../../env';
import { logger } from '../logger';

const log = logger('notify:email');

export const emailConfigured = Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFrom);

export interface SendResult {
  ok: boolean;
  message: string;
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<SendResult> {
  if (!emailConfigured) {
    return { ok: false, message: 'Email is not configured on this server (no SMTP_* env vars set).' };
  }
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
    await transport.sendMail({ from: env.smtpFrom, to: opts.to, subject: opts.subject, html: opts.html });
    return { ok: true, message: 'sent' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('sendEmail failed', err);
    return { ok: false, message };
  }
}
