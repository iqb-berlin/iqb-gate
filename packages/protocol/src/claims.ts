/**
 * How the claims of an OpenID Connect token name a person: the same rule for the token the
 * backend verifies (`@iqb/gate-oidc`) and the one the browser shows (`@iqb/gate-angular`), so that
 * both sides call a person by the same name and grant the same roles. Follows Keycloak, which the
 * IQB applications use, and any standard provider, which leaves out what it does not know.
 */

/** The claims that name a person. */
export interface PersonClaims {
  sub?: unknown;
  preferred_username?: unknown;
  email?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown } | undefined>;
}

/** A text claim without the blanks around it; `null` when there is none, or nothing but blanks. */
export function textClaim(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}

function roleList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textClaim).filter((role): role is string => role !== null) : [];
}

/**
 * The provider's id of the person: `sub` exactly as sent -- an identifier, which a blank changes --
 * as long as it is a text that is not only blanks; `null` otherwise.
 */
export function subjectOf(claims: PersonClaims): string | null {
  return typeof claims.sub === 'string' && claims.sub.trim() !== '' ? claims.sub : null;
}

/**
 * A name to show: `preferred_username`, else the e-mail address, else the subject -- each without
 * the blanks around it, the subject too, which stays as sent where it keys the person.
 */
export function usernameOf(claims: PersonClaims, subject: string): string {
  return textClaim(claims.preferred_username) ?? textClaim(claims.email) ?? textClaim(subject) ?? subject;
}

/** The roles of the realm and, if a client is named, those of the client -- each once. */
export function rolesOf(claims: PersonClaims, clientId?: string): string[] {
  const clientRoles = clientId ? roleList(claims.resource_access?.[clientId]?.roles) : [];
  return [...new Set([...roleList(claims.realm_access?.roles), ...clientRoles])];
}
