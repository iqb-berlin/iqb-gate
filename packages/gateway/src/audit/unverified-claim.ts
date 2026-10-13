/** Longer claims are cut: the audit log names a person, it does not store what a client sends. */
const MAX_CLAIM_LENGTH = 200;

/** The JWT of an `Authorization: Bearer` header; `null` for any other header, or none. */
export function bearerJwt(authorization: string | undefined): string | null {
  return /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]*)$/i.exec(authorization ?? '')?.[1] ?? null;
}

/** A claim of a token's payload as text, cut to a length fit for the audit log. */
export function claimText(payload: unknown, claim: string): string | null {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[claim] : undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text === '' ? null : text.slice(0, MAX_CLAIM_LENGTH);
}

/**
 * A claim of the Bearer JWT, read **without verifying** the token -- for the audit log alone, where
 * it names who the application was told it is. It holds only when the application accepted the
 * token, which the status of the entry tells. `null` when there is no such token or claim.
 */
export function unverifiedBearerClaim(authorization: string | undefined, claim: string): string | null {
  const token = bearerJwt(authorization);
  if (!token) return null;
  try {
    return claimText(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')), claim);
  } catch {
    return null;
  }
}
