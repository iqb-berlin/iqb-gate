/** Longer claims are cut: the audit log names a writer, it does not store what a client sends. */
const MAX_CLAIM_LENGTH = 200;

/**
 * A claim of the Bearer JWT, read **without verifying** the token -- for the audit log alone, where
 * it names who the application was told it is. It holds only when the application accepted the
 * token, which the status of the entry tells. `null` when there is no such token or claim.
 */
export function unverifiedBearerClaim(authorization: string | undefined, claim: string): string | null {
  const token = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]*)$/i.exec(authorization ?? '');
  if (!token) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(token[2], 'base64url').toString('utf8'));
    const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[claim] : undefined;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    return String(value).slice(0, MAX_CLAIM_LENGTH);
  } catch {
    return null;
  }
}
