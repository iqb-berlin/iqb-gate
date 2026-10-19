import type { OidcVerifier } from '@iqb/gate-oidc';
import { bearerJwt, claimText, unverifiedBearerClaim } from './unverified-claim.js';

/** Who the audit log names for a checked request, and whether the gateway checked it. */
export interface AuditUser {
  user: string | null;
  userVerified: boolean;
}

/**
 * Names the person behind a checked write or read: the person of an OpenID Connect token the
 * gateway verified, or else whatever Bearer JWT it carries, which nobody checked -- an application's
 * own token. Both by the claim `userClaim`, so that a person keeps one name in the log whether
 * checked or not; a verified token without that claim by its username. Never decides about the
 * request.
 */
export async function nameAuditUser(
  authorization: string | undefined,
  verifier: OidcVerifier | undefined,
  userClaim: string | undefined
): Promise<AuditUser> {
  const token = bearerJwt(authorization);
  const verification = token && verifier ? await verifier.verify(token) : null;
  if (verification?.status === 'verified') {
    const { identity } = verification;
    return { user: (userClaim && claimText(identity.claims, userClaim)) || identity.username, userVerified: true };
  }
  return { user: userClaim ? unverifiedBearerClaim(authorization, userClaim) : null, userVerified: false };
}
