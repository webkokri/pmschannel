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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  jwtSecret: required('JWT_SECRET', 'dev-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  cmSecret: required('CM_SECRET', 'dev-encryption-key-change-me-please-32b'),
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@channelmanager.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
  workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000),
  workerPullIntervalMs: Number(process.env.WORKER_PULL_INTERVAL_MS ?? 60000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim()),
};
