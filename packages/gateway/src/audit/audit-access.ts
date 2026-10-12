import { createHash, timingSafeEqual } from 'node:crypto';

function sameSecret(given: string, key: string): boolean {
  // Compared as hashes: equal length, so the comparison takes the same time whatever was given
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(key));
}

/**
 * Whether a request may read the audit log: it brings the audit key as Bearer token (an
 * application's backend) or as password of HTTP Basic (a person in the browser; any user name).
 */
export function isAuditAuthorized(authorization: string | undefined, key: string): boolean {
  const [scheme, credentials] = (authorization ?? '').split(/\s+/, 2);
  if (!credentials) return false;
  if (/^bearer$/i.test(scheme)) return sameSecret(credentials, key);
  if (!/^basic$/i.test(scheme)) return false;
  const decoded = Buffer.from(credentials, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator >= 0 && sameSecret(decoded.slice(separator + 1), key);
}
