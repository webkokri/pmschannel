import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Guards against SSRF on outbound fetches whose target URL is supplied by a
 * tenant admin (connector credentials like `icalUrl`) rather than hardcoded by
 * us. Without this, a malicious or compromised org admin could point the
 * server at `http://169.254.169.254/...` (cloud instance metadata), an
 * internal admin panel, or any other private-network service and read back
 * whatever it returns.
 */
export class UnsafeUrlError extends Error {}

function isPrivateOrReservedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice('::ffff:'.length));
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
    return false;
  }
  return true; // not a resolvable IP literal — treat as unsafe
}

/**
 * Parses and validates `rawUrl`: http(s) only, not localhost, and every address it
 * resolves to must be public (not private/loopback/link-local/metadata). Throws
 * `UnsafeUrlError` with a message safe to show the admin who configured the URL.
 *
 * This doesn't defend against DNS rebinding (the resolved address changing between
 * this check and the actual request) — an accepted residual risk here, since the
 * realistic threat for this app is a careless or compromised tenant admin pointing
 * the server at internal infrastructure, not a sophisticated timing attack.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.');
  }

  // Test suites run their fake "external platform" servers on loopback, since
  // there's no real public host to point at in CI — never true in production
  // (NODE_ENV=test is not a value a deployed server runs under).
  if (process.env.NODE_ENV === 'test') return url;

  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('URLs pointing at localhost are not allowed.');
  }
  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    throw new UnsafeUrlError('URLs pointing at a private/internal address are not allowed.');
  }

  let addresses: string[];
  try {
    addresses = (await dns.lookup(hostname, { all: true })).map((r) => r.address);
  } catch {
    throw new UnsafeUrlError('Could not resolve that host.');
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw new UnsafeUrlError('That URL resolves to a private/internal address and is not allowed.');
  }

  return url;
}
