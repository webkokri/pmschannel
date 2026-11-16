import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_PLAN_CODE, type UserRole } from '@cm/shared';
import { prisma } from '../db';
import { env } from '../env';
import { asyncHandler, badRequest, forbidden, parse, unauthorized } from '../lib/http';
import { assignSupportManager } from '../lib/support';
import { getPlatformSetting } from '../lib/platform-settings';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string | null;
  isSuperAdmin: boolean;
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

const signupInput = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  country: z.enum(['US', 'CA']).default('US'),
  planCode: z.string().optional(),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'org'
  );
}

/** Self-serve signup: creates an Organization + trial Subscription + the first admin User. */
authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    // Checked server-side regardless of whether the frontend hid the signup link —
    // a disabled toggle must actually block account creation, not just the UI path to it.
    const signupEnabled = await getPlatformSetting<boolean>('signupEnabled');
    if (signupEnabled === false) {
      throw forbidden('New signups are currently closed. Contact us if you were invited to join.');
    }

    const body = parse(signupInput, req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw badRequest('An account with that email already exists');

    const plan = await prisma.plan.findUnique({
      where: { code: body.planCode ?? DEFAULT_TRIAL_PLAN_CODE },
    });
    if (!plan || !plan.active) throw badRequest('Selected plan is not available');

    const baseSlug = slugify(body.organizationName);
    let slug = baseSlug;
    for (let i = 1; await prisma.organization.findUnique({ where: { slug } }); i++) {
      slug = `${baseSlug}-${i}`;
    }

    const trialEndsAt = new Date(Date.now() + DEFAULT_TRIAL_DAYS * 86_400_000);

    const { organization, user } = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: body.organizationName,
          slug,
          contactEmail: body.email.toLowerCase(),
          country: body.country,
          currency: body.country === 'CA' ? 'CAD' : 'USD',
          status: 'trialing',
          trialEndsAt,
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          planId: plan.id,
          status: 'trialing',
          currentPeriodEnd: trialEndsAt,
        },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: body.email.toLowerCase(),
          name: body.name,
          role: 'admin',
          passwordHash: await bcrypt.hash(body.password, 10),
        },
      });
      return { organization, user };
    });

    const supportManager = await assignSupportManager(organization.id);

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: organization.id,
      isSuperAdmin: false,
      permissions: [],
    };
    res.status(201).json({ token: signToken(authUser), user: authUser, organization, supportManager });
  }),
);
