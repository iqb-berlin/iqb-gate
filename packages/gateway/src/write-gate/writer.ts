import type { OidcVerifier } from '@iqb/gate-oidc';
import { bearerJwt, claimText, unverifiedBearerClaim } from './unverified-claim.js';

/** Who the audit log names for a write, and whether the gateway checked it. */
export interface Writer {
  user: string | null;
  userVerified: boolean;
}

/**
 * Names the writer of a request: the person of an OpenID Connect token the gateway verified, or
 * else whatever Bearer JWT it carries, which nobody checked -- an application's own token. Both by
 * the claim `userClaim`, so that a person keeps one name in the log whether checked or not; a
 * verified token without that claim by its username. Never decides about the write.
 */
export async function nameWriter(
  authorization: string | undefined,
  verifier: OidcVerifier | undefined,
  userClaim: string | undefined
): Promise<Writer> {
  const token = bearerJwt(authorization);
  const identity = token && verifier ? await verifier.verify(token) : null;
  if (identity) {
    return { user: (userClaim && claimText(identity.claims, userClaim)) || identity.username, userVerified: true };
  }
  return { user: userClaim ? unverifiedBearerClaim(authorization, userClaim) : null, userVerified: false };
}
