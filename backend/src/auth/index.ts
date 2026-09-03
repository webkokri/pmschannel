import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { asyncHandler, forbidden, parse, unauthorized } from '../lib/http';
import type { UserRole } from '@cm/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Missing bearer token'));
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & AuthUser;
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

const RANK: Record<UserRole, number> = { viewer: 1, manager: 2, admin: 3 };

/** Require at least the given role. */
export function requireRole(min: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (RANK[req.user.role] < RANK[min]) return next(forbidden(`Requires ${min} role`));
    next();
  };
}

export async function verifyLogin(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
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
