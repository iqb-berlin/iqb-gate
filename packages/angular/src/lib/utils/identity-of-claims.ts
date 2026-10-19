import {
  type PersonClaims, rolesOf, subjectOf, textClaim, usernameOf
} from '@iqb/gate-protocol';

/** Who is logged in, for the application's view. */
export interface IqbOidcIdentity {
  subject: string;
  /** `preferred_username`, else the e-mail address, else the subject. */
  username: string;
  email: string | null;
  /**
   * The roles of the realm and, with a client named, of the client, from the access token, where
   * Keycloak puts them -- for what the view shows. What a role allows, the backend decides on the
   * token itself.
   */
  roles: string[];
}

/**
 * Whether two identities are the same in every part the application sees, the roles included --
 * in whatever order the provider lists them.
 */
export function sameIdentity(a: IqbOidcIdentity | null, b: IqbOidcIdentity | null): boolean {
  if (!a || !b) return a === b;
  return a.subject === b.subject && a.username === b.username && a.email === b.email &&
    a.roles.length === b.roles.length && a.roles.every(role => b.roles.includes(role));
}

/**
 * The identity of an ID token's claims, with the roles of the access token's; `null` without a
 * subject. Subject, names and roles follow the rule the backends verify tokens by (`@iqb/gate-protocol`).
 */
export function identityOfClaims(
  idToken: unknown,
  accessToken: unknown = {},
  clientId?: string
): IqbOidcIdentity | null {
  const claims = (idToken ?? {}) as PersonClaims;
  const subject = subjectOf(claims);
  if (!subject) return null;
  return {
    subject,
    username: usernameOf(claims, subject),
    email: textClaim(claims.email),
    roles: rolesOf((accessToken ?? {}) as PersonClaims, clientId)
  };
}
