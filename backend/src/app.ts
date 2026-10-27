import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { OTA_CATALOG } from '@cm/shared';
import { env } from './env';
import { errorHandler, notFound } from './lib/http';
import { authRequired, authRouter, requireSuperAdmin } from './auth';
import { propertiesRouter } from './modules/properties';
import { channelsRouter } from './modules/channels';
import { calendarRouter } from './modules/calendar';
import { bookingsRouter } from './modules/bookings';
import { conflictsRouter } from './modules/conflicts';
import { syncRouter } from './modules/sync';
import { dashboardRouter } from './modules/dashboard';
import { simulatorRouter } from './modules/simulator';
import { usersRouter, settingsRouter } from './modules/users';
import { billingRouter } from './modules/billing';
import { plansRouter } from './modules/plans';
import { organizationRouter } from './modules/organization';
import { financeRouter } from './modules/finance';
import { packagesRouter } from './modules/packages';
import { paymentsRouter } from './modules/payments';
import { notificationsRouter } from './modules/notifications';
import { staffRouter } from './modules/staff';
import { reportsRouter } from './modules/reports';
import { pmsRouter } from './modules/pms';
import { rmsRouter } from './modules/rms';
import { seoRouter } from './modules/seo';
import { aiRouter } from './modules/ai';
import { connectRouter } from './modules/connect';
import { acceleratorRouter } from './modules/accelerator';
import { publicRouter } from './modules/public';
import { icalExportRouter } from './modules/ical-export';
import { webhookRouter } from './engine/webhooks';
import { stripeWebhookRouter } from './modules/stripe-webhook';
import { adminOrganizationsRouter } from './modules/admin/organizations';
import { adminPlansRouter } from './modules/admin/plans';
import { adminPlatformRouter } from './modules/admin/platform';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigins, credentials: true }));

  // Stripe needs the raw body to verify the webhook signature, so it's registered
  // *before* the global JSON parser below.
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

  app.use(express.json({ limit: '2mb' }));
  if (!env.isTest) app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'channel-manager-api', ts: new Date().toISOString() }));
  app.get('/api/ota-catalog', (_req, res) => res.json({ catalog: OTA_CATALOG }));

  // Public: OTA booking webhooks, the plan catalogue, auth (login/signup), and the
  // public booking microsite (SEO/GEO/AEO surface — read-only + "create a booking").
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/ical', icalExportRouter);

  // Everything below requires a valid session.
  app.use('/api', authRequired);

  // Tenant (organization) routes.
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
  app.use('/api/billing', billingRouter);
  app.use('/api/organization', organizationRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/packages', packagesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/pms', pmsRouter);
  app.use('/api/rms', rmsRouter);
  app.use('/api/seo', seoRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/connect', connectRouter);
  app.use('/api/accelerator', acceleratorRouter);

  // Platform routes — super admin only, full control of the SaaS.
  app.use('/api/admin', requireSuperAdmin);
  app.use('/api/admin/organizations', adminOrganizationsRouter);
  app.use('/api/admin/plans', adminPlansRouter);
  app.use('/api/admin/platform', adminPlatformRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Route not found')));

  // In production, this one process also serves the built admin panel (single deployable
  // web service — see DEPLOYMENT.md). Falls back to the SPA's index.html for client-side
  // routing on anything that isn't a static asset or an /api/* route.
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (env.isProd && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  }

  app.use(errorHandler);

  return app;
}
