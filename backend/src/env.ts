import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// When run directly (tsx src/index.ts) rather than via an npm script, still pick
// up the repo-root .env.
const rootEnv = path.resolve(__dirname, '../../.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/**
 * Like `required`, but the fallback is a dev-only convenience that must never be used in
 * production: these back JWT signing and the at-rest credential-encryption key, and the
 * fallback values are plaintext in this (public) repo. Running production with one would
 * let anyone forge a valid session for any user — including super admin — or decrypt every
 * stored OTA/PMS/Stripe credential, just by reading this file on GitHub.
 */
function requiredSecret(name: string, devOnlyFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing required environment variable: ${name} — refusing to start in production with the insecure development default.`,
    );
  }
  return devOnlyFallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  jwtSecret: requiredSecret('JWT_SECRET', 'dev-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  cmSecret: requiredSecret('CM_SECRET', 'dev-encryption-key-change-me-please-32b'),
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@channelmanager.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
  workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000),
  workerPullIntervalMs: Number(process.env.WORKER_PULL_INTERVAL_MS ?? 60000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim()),
  publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:5173',
  /** Optional — billing (subscriptions + guest payments) runs "not configured" until set. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',

  /** Optional — email notifications no-op (and log) until all of these are set. */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',

  /** Optional — SMS notifications no-op (and log) until all of these are set. */
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',

  /** Optional — the AI assistant / suggestions run "not configured" until this is set. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
};
