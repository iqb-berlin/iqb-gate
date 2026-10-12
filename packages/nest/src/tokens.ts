import type { OidcIdentity } from '@iqb/gate-oidc';

/** The `OidcVerifier` of the module, for an application's own strategy. */
export const OIDC_VERIFIER = Symbol('OIDC_VERIFIER');

/** How the module turns a verified identity into the application's user (see `IqbOidcSettings.userSync`). */
export const OIDC_USER_SYNC = Symbol('OIDC_USER_SYNC');

/**
 * Turns a verified identity into the application's own user: found or created by issuer and
 * subject, with the name and the roles it trusts. `null` keeps the person out.
 */
export interface OidcUserSync<User = unknown> {
  sync(identity: OidcIdentity): Promise<User | null> | User | null;
}

/** The parts of a request the guard reads and writes. */
export interface OidcRequest {
  headers?: Record<string, string | string[] | undefined>;
  oidcIdentity?: OidcIdentity;
  user?: unknown;
}
