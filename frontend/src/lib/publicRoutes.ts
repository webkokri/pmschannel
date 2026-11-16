/** Routes that must work with zero session — no auth check should ever run on them,
 *  and a 401 from some unrelated call must never redirect a visitor away from one. */
const PUBLIC_PREFIXES = ['/book/'];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
