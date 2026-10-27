import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from './http';

/**
 * Granular permission keys, checked *in addition to* the existing role rank
 * (admin/manager/viewer — see `requireRole` in auth/index.ts). A viewer or manager can be
 * granted one of these individually (e.g. a manager who also handles the books gets
 * `finance.manage` without being promoted to admin); admins and super admins always pass.
 */
export const PERMISSIONS = [
  'finance.manage',
  'notifications.manage',
  'staff.manage',
  'pms.manage',
  'rms.manage',
  'seo.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function hasPermission(
  user: { role: string; isSuperAdmin: boolean; permissions?: string[] } | undefined,
  key: Permission,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin || user.role === 'admin') return true;
  return Boolean(user.permissions?.includes(key));
}

/** Require the rank-based role check *or* the named granular permission. */
export function requirePermission(key: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (hasPermission(req.user, key)) return next();
    next(forbidden(`Requires the "${key}" permission`));
  };
}
