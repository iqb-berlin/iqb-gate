import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** The pass cookie; only ever set over HTTPS, so always with `__Host-`. */
export const PASS_COOKIE = '__Host-iqb-gate-pass';

const DAY_SECONDS = 24 * 60 * 60;

function browserOf(userAgent: string): string {
  return createHash('sha256').update(userAgent).digest('base64url').slice(0, 22);
}

function signatureOf(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

/**
 * The value of a pass for a browser that solved the page challenge: until when it holds, for
 * which browser (its User-Agent, hashed), signed with the page gate's key. Copied to another
 * client, it holds only if that client sends the very same User-Agent.
 */
export function issuePass(key: string, userAgent: string, now: number, days: number): string {
  const body = `${Math.floor(now / 1000) + days * DAY_SECONDS}.${browserOf(userAgent)}`;
  return `${body}.${signatureOf(body, key)}`;
}

/** Whether a pass is the gateway's, has not expired and was issued to this browser. */
export function passHolds(value: string | undefined, key: string, userAgent: string, now: number): boolean {
  const parts = value?.split('.') ?? [];
  if (parts.length !== 3) return false;
  const [expiresAt, browser, signature] = parts;
  const expected = Buffer.from(signatureOf(`${expiresAt}.${browser}`, key));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return Number(expiresAt) * 1000 > now && browser === browserOf(userAgent);
}
