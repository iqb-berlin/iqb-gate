import type { JWTPayload } from 'jose';

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

interface ProviderClaims extends JWTPayload {
  preferred_username?: unknown;
  email?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown } | undefined>;
}

/** A text claim without the blanks around it; `null` when there is none, or nothing but blanks. */
const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
};

const roleList = (value: unknown): string[] => (
  Array.isArray(value) ? value.map(text).filter((role): role is string => role !== null) : []
);

/**
 * The identity a verified token names. Expects `iss` and `sub` to be there -- the verifier has
 * checked them. Follows the claims of Keycloak, which the IQB applications use, and of any
 * standard provider, which leaves out what it does not know.
 */
export function identityOf(payload: JWTPayload, clientId?: string): OidcIdentity {
  const claims = payload as ProviderClaims;
  const subject = String(claims.sub);
  const email = text(claims.email);
  const clientRoles = clientId ? roleList(claims.resource_access?.[clientId]?.roles) : [];
  return {
    issuer: String(claims.iss),
    subject,
    username: text(claims.preferred_username) ?? email ?? subject,
    email,
    givenName: text(claims.given_name),
    familyName: text(claims.family_name),
    roles: [...new Set([...roleList(claims.realm_access?.roles), ...clientRoles])],
    claims: payload
  };
}
