import type { NextFunction, Request, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError(400, m, d);
export const unauthorized = (m = 'Unauthorized') => new ApiError(401, m);
export const forbidden = (m = 'Forbidden') => new ApiError(403, m);
export const notFound = (m = 'Not found') => new ApiError(404, m);
export const conflict = (m: string, d?: unknown) => new ApiError(409, m, d);

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Validation failed', formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(err: ZodError) {
  return err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: formatZodError(err) });
  }
  // Prisma "record not found" surfaces as P2025
  if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2025') {
    return res.status(404).json({ error: 'Not found', details: null });
  }
  if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2002') {
    return res.status(409).json({ error: 'Unique constraint violation', details: (err as { meta?: unknown }).meta ?? null });
  }
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error', details: null });
}
