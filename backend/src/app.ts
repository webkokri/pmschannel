import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env';
import { errorHandler, notFound } from './lib/http';
import { authRequired, authRouter } from './auth';
import { propertiesRouter } from './modules/properties';
import { channelsRouter } from './modules/channels';
import { calendarRouter } from './modules/calendar';
import { bookingsRouter } from './modules/bookings';
import { conflictsRouter } from './modules/conflicts';
import { syncRouter } from './modules/sync';
import { dashboardRouter } from './modules/dashboard';
import { simulatorRouter } from './modules/simulator';
import { usersRouter, settingsRouter } from './modules/users';
import { webhookRouter } from './engine/webhooks';
import { OTA_CATALOG } from '@cm/shared';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  if (!env.isTest) app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'channel-manager-api', ts: new Date().toISOString() }));
  app.get('/api/ota-catalog', (_req, res) => res.json({ catalog: OTA_CATALOG }));

  // Inbound OTA webhooks are unauthenticated (real ones use per-channel signatures).
  app.use('/api/webhooks', webhookRouter);

  app.use('/api/auth', authRouter);

  // Everything below requires a valid session.
  app.use('/api', authRequired);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/conflicts', conflictsRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/simulator', simulatorRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/settings', settingsRouter);

  app.use((_req, _res, next) => next(notFound('Route not found')));
  app.use(errorHandler);

  return app;
}
