import type { NextFunction, Request, Response } from 'express';
import { notFound, unauthorized } from './http';

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

/**
 * Load a row that carries `organizationId` directly (Property, Booking,
 * ChannelConnection, ConflictAlert, SyncJob, …) and verify it belongs to the caller's
 * organization. Returns 404 rather than 403 so tenants can't probe for other tenants'
 * record ids.
 */
export async function assertOwned<T extends { organizationId: string | null }>(
  finder: () => Promise<T | null>,
  organizationId: string,
  what = 'Resource',
): Promise<T> {
  const row = await finder();
  if (!row || row.organizationId !== organizationId) throw notFound(`${what} not found`);
  return row;
}
