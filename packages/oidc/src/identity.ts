import type { JWTPayload } from 'jose';
import {
  type PersonClaims, rolesOf, subjectOf, textClaim, usernameOf
} from '@iqb/gate-protocol';

/** Who a verified token names, in the words the applications use. */
export interface OidcIdentity {
  /** The provider that issued the token (`iss`). */
  issuer: string;
  /** The provider's id of the person (`sub`); together with the issuer, what an application keys its user on. */
  subject: string;
  /** A name to show: `preferred_username`, else the e-mail address, else the subject. */
  username: string;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  /** The roles of the realm and, if a client is named, those of the client (Keycloak's layout). */
  roles: string[];
  /** All claims of the verified token, for what an application reads beyond the above. */
  claims: JWTPayload;
}

/**
 * The identity a verified token names. Expects `iss` and `sub` to be there -- the verifier has
 * checked them; throws without a subject. Subject, names and roles follow the rule the browser library shows them by
 * (`@iqb/gate-protocol`).
 */
export function identityOf(payload: JWTPayload, clientId?: string): OidcIdentity {
  const claims = payload as JWTPayload & PersonClaims;
  const subject = subjectOf(claims);
  if (subject === null) throw new Error('the token names no subject');
  return {
    issuer: String(claims.iss),
    subject,
    username: usernameOf(claims, subject),
    email: textClaim(claims.email),
    givenName: textClaim(claims.given_name),
    familyName: textClaim(claims.family_name),
    roles: rolesOf(claims, clientId),
    claims: payload
  };
}
