import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { type UserRole } from '@cm/shared';
import { prisma } from '../db';
import { env } from '../env';
import { asyncHandler, forbidden, parse, unauthorized } from '../lib/http';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string | null;
  isSuperAdmin: boolean;
  /** Hard-restricts a dedicated property manager/owner to this one property — null for
   *  portfolio-wide staff. See lib/tenant.ts. */
  assignedPropertyId: string | null;
  /** Granular permission overlay — see lib/permissions.ts. */
  permissions: string[];
  /** Set on a short-lived token issued by super-admin impersonation, never on a real login. */
  impersonated?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser, opts: { expiresIn?: string } = {}): string {
  return jwt.sign(user, env.jwtSecret, {
    expiresIn: (opts.expiresIn ?? env.jwtExpiresIn) as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies the JWT, then re-reads the user (and their organization, if any) from the
 * database rather than trusting the token's embedded fields. This matters for more than
 * just correctness at the edges:
 *  - a deactivated/deleted user's existing token stops working immediately, instead of
 *    silently working until it expires (up to `JWT_EXPIRES_IN`)
 *  - a role or permission change takes effect on the user's very next request
 *  - a stale token from before a dev database reset (or from an org that was deleted)
 *    fails cleanly here with a clear "sign in again", instead of surfacing as a confusing
 *    404 deep inside some other route once `organizationId` no longer resolves to anything
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Missing bearer token'));

  let payload: jwt.JwtPayload & AuthUser;
  try {
    payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & AuthUser;
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }

  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user || !user.active) return next(unauthorized('Session no longer valid — please sign in again'));

  if (user.organizationId && !user.isSuperAdmin) {
    const org = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { id: true } });
    if (!org) return next(unauthorized('Session no longer valid — please sign in again'));
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    isSuperAdmin: user.isSuperAdmin,
    assignedPropertyId: user.assignedPropertyId,
    permissions: user.permissions,
    impersonated: Boolean(payload.impersonated),
  };
  next();
});

const RANK: Record<UserRole, number> = { viewer: 1, manager: 2, admin: 3 };

/** Require at least the given role *within the organization* (super admins always pass). */
export function requireRole(min: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.isSuperAdmin) return next();
    if (RANK[req.user.role] < RANK[min]) return next(forbidden(`Requires ${min} role`));
    next();
  };
}

/** Platform-level: only the super admin may pass. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (!req.user.isSuperAdmin) return next(forbidden('Super admin access required'));
  next();
}

export async function verifyLogin(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    isSuperAdmin: user.isSuperAdmin,
    assignedPropertyId: user.assignedPropertyId,
    permissions: user.permissions,
  };
}

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await verifyLogin(body.email, body.password);
    if (!user) throw unauthorized('Invalid email or password');
    res.json({ token: signToken(user), user });
  }),
);

authRouter.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

// No self-serve signup: this is a single, internally-owned portfolio. The super admin
// creates every property and every property manager/owner account directly — see
// modules/admin/properties.ts.
