import type { NextFunction, Request, Response } from 'express';
import { forbidden, notFound, unauthorized } from './http';

/**
 * Every tenant-scoped route sits behind `authRequired` (sets `req.user`) and then this:
 * blocks platform staff / super-admin-only tokens that aren't attached to an organization
 * (e.g. hitting an org route without impersonating one first).
 */
export function requireOrg(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.organizationId) {
    return next(unauthorized('This account is not attached to an organization'));
  }
  next();
}

/** The caller's hard property restriction, or null for portfolio-wide staff. */
export function propertyScope(req: Request): string | null {
  return req.user?.assignedPropertyId ?? null;
}

/**
 * Blocks a dedicated property manager/owner from portfolio-wide surfaces (staff
 * management, org profile/branding, payment-gateway/Connect setup, notification config)
 * that aren't scoped to any one property — those are head-office concerns regardless of
 * the caller's role rank.
 */
export function requirePortfolioStaff(req: Request, _res: Response, next: NextFunction) {
  if (propertyScope(req)) return next(forbidden('Not available to a property-scoped account'));
  next();
}

/**
 * Throws 404 if the caller is restricted to one property and `propertyId` isn't it.
 * No-op for portfolio-wide staff. Call right after resolving a propertyId a scoped
 * manager must not be able to steer towards another property (query/body/route param).
 */
export function assertPropertyInScope(propertyId: string, req: Request): void {
  const scope = propertyScope(req);
  if (scope && propertyId !== scope) throw notFound('Property not found');
}

/**
 * Resolves the effective `propertyId` filter for a *list* endpoint that accepts an
 * optional `propertyId` query/body param: a scoped manager's filter is forced to their
 * property (and an explicit different id is rejected, rather than silently widened to the
 * whole org); portfolio-wide staff get whatever was requested (or none, for "all").
 */
export function resolvePropertyFilter(req: Request, requested?: string): string | undefined {
  const scope = propertyScope(req);
  if (!scope) return requested;
  if (requested && requested !== scope) throw notFound('Property not found');
  return scope;
}

/**
 * Load a row that carries `organizationId` directly (Property, Booking,
 * ChannelConnection, ConflictAlert, SyncJob, …) and verify it belongs to the caller's
 * organization. Returns 404 rather than 403 so tenants can't probe for other tenants'
 * record ids. Pass `req` to also enforce a scoped manager's property restriction — the
 * row's own `propertyId` field is checked, or (for a Property row itself) its `id`.
 */
export async function assertOwned<T extends { organizationId: string | null }>(
  finder: () => Promise<T | null>,
  organizationId: string,
  what = 'Resource',
  req?: Request,
): Promise<T> {
  const row = await finder();
  if (!row || row.organizationId !== organizationId) throw notFound(`${what} not found`);
  const scope = req ? propertyScope(req) : null;
  if (scope) {
    const r = row as unknown as { propertyId?: string; id?: string };
    const effective = r.propertyId ?? (what === 'Property' ? r.id : undefined);
    if (effective && effective !== scope) throw notFound(`${what} not found`);
  }
  return row;
}
