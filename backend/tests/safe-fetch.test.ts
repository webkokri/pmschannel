import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, UnsafeUrlError } from '../src/lib/safe-fetch';

// The guard intentionally no-ops under NODE_ENV=test (test suites' fake "external
// platform" servers run on loopback) — flip it to 'production' for these
// assertions so we're actually exercising the SSRF guard itself.
let prevEnv: string | undefined;
beforeEach(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
});
afterEach(() => {
  process.env.NODE_ENV = prevEnv;
});

describe('assertPublicHttpUrl — SSRF guard for admin-supplied connector URLs', () => {
  it('rejects loopback addresses', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/feed.ics')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl('http://[::1]/feed.ics')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects localhost by hostname', async () => {
    await expect(assertPublicHttpUrl('http://localhost:4000/api/admin/anything')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the cloud instance metadata address', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertPublicHttpUrl('http://10.0.0.5/internal')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl('http://192.168.1.1/internal')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl('http://172.16.0.1/internal')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicHttpUrl('gopher://example.com/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects malformed URLs instead of throwing an unrelated error', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(UnsafeUrlError);
  });
});
