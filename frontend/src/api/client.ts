import { isPublicRoute } from '@/lib/publicRoutes';

const TOKEN_KEY = 'cm.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (res.status === 401) {
    setToken(null);
    // A public page (the booking microsite) never has a session to lose — a 401 there
    // (e.g. some unrelated authenticated call misfiring) must not bounce a guest to
    // /login; that page has nothing to do with staff login at all.
    if (!location.pathname.startsWith('/login') && !isPublicRoute(location.pathname)) {
      location.assign('/login');
    }
    throw new ApiError(401, 'Session expired', null);
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.details ?? null);
  }
  return body as T;
}
