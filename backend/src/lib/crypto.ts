import crypto from 'node:crypto';
import { env } from '../env';

/**
 * Symmetric encryption for channel credentials at rest.
 * AES-256-GCM with a key derived from CM_SECRET. Output: base64(iv|tag|ciphertext).
 */
const key = crypto.createHash('sha256').update(env.cmSecret).digest();

export function encryptJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptJson<T = unknown>(blob: string): T | null {
  if (!blob) return null;
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Redact secret-looking values for API responses. */
export function redactCredentials(creds: Record<string, unknown> | null): Record<string, unknown> {
  if (!creds) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}
