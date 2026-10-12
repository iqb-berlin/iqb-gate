import { inject, Injectable } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  catchError, combineLatest, map, type Observable, of, switchMap
} from 'rxjs';

/** Who is logged in, for the application's view. */
export interface IqbOidcIdentity {
  subject: string;
  /** `preferred_username`, else the e-mail address, else the subject. */
  username: string;
  email: string | null;
  /**
   * The realm's roles from the access token, where Keycloak puts them by default -- for what the
   * view shows. What a role allows, the backend decides on the token itself.
   */
  roles: string[];
}

interface Claims {
  sub?: unknown;
  preferred_username?: unknown;
  email?: unknown;
  realm_access?: { roles?: unknown };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The identity of an ID token's claims, with the roles of the access token's; `null` without a subject. */
export function identityOfClaims(idToken: unknown, accessToken: unknown = {}): IqbOidcIdentity | null {
  const claims = (idToken ?? {}) as Claims;
  const subject = text(claims.sub);
  if (!subject) return null;
  const roles = ((accessToken ?? {}) as Claims).realm_access?.roles;
  return {
    subject,
    username: text(claims.preferred_username) ?? text(claims.email) ?? subject,
    email: text(claims.email),
    roles: Array.isArray(roles) ? roles.map(text).filter((role): role is string => role !== null) : []
  };
}

/**
 * The login as the application sees it, without the OpenID Connect library's vocabulary: whether
 * someone is logged in, who, and the way in and out. The tokens themselves stay with the library;
 * the requests to the application's APIs carry them (see `provideIqbOidc`).
 */
@Injectable({
  providedIn: 'root'
})
export class IqbOidcService {
  private readonly oidc = inject(OidcSecurityService);

  readonly isAuthenticated$: Observable<boolean> = this.oidc.isAuthenticated$.pipe(
    map(result => result.isAuthenticated)
  );

  readonly identity$: Observable<IqbOidcIdentity | null> = this.isAuthenticated$.pipe(
    switchMap(authenticated => (authenticated
      ? combineLatest([this.oidc.getPayloadFromIdToken(), this.oidc.getPayloadFromAccessToken()]).pipe(
        map(([idToken, accessToken]) => identityOfClaims(idToken, accessToken)),
        catchError(() => of(null))
      )
      : of(null)))
  );

  /** Off to the provider's login page; back at the redirect URL with a code. */
  login(): void {
    this.oidc.authorize();
  }

  /**
   * Revokes the tokens and ends the session at the provider. Should the revocation fail, the
   * tokens are dropped here all the same and the provider's session is ended: nobody stays
   * logged in who asked to leave.
   */
  logout(): void {
    this.oidc.logoffAndRevokeTokens().pipe(
      catchError(() => {
        this.oidc.logoffLocal();
        return this.oidc.logoff().pipe(catchError(() => of(null)));
      })
    ).subscribe();
  }
}
