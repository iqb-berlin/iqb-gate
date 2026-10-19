import { inject, Injectable } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  catchError, combineLatest, distinctUntilChanged, finalize, map, type Observable, of, switchMap
} from 'rxjs';
import { IQB_OIDC_OPTIONS } from './iqb-oidc-options';
import { identityOfClaims, type IqbOidcIdentity, sameIdentity } from '../utils/identity-of-claims';

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
  private readonly clientId = inject(IQB_OIDC_OPTIONS, { optional: true })?.clientId;

  /**
   * Changes only when someone logs in or out -- the library reports again after every renewal of
   * the token, which is no news to the application.
   */
  readonly isAuthenticated$: Observable<boolean> = this.oidc.isAuthenticated$.pipe(
    map(result => result.isAuthenticated),
    distinctUntilChanged()
  );

  /**
   * Read again with every renewal of the token, which may bring roles granted or withdrawn
   * meanwhile; reports only what changed.
   */
  readonly identity$: Observable<IqbOidcIdentity | null> = this.oidc.isAuthenticated$.pipe(
    switchMap(result => (result.isAuthenticated
      ? combineLatest([this.oidc.getPayloadFromIdToken(), this.oidc.getPayloadFromAccessToken()]).pipe(
        map(([idToken, accessToken]) => identityOfClaims(idToken, accessToken, this.clientId)),
        catchError(() => of(null))
      )
      : of(null))),
    distinctUntilChanged(sameIdentity)
  );

  /** Off to the provider's login page; back at the redirect URL with a code. */
  login(): void {
    this.oidc.authorize();
  }

  /**
   * Revokes the tokens and ends the session at the provider. Should the revocation fail, the
   * provider's session is ended all the same -- named by the ID token, so the tokens stay until
   * then. Afterwards they are dropped here in any case: the library leaves them where it cannot end
   * the provider's session (no end-session endpoint), and nobody stays logged in who asked to leave.
   */
  logout(): void {
    this.oidc.logoffAndRevokeTokens().pipe(
      catchError(() => this.oidc.logoff()),
      catchError(() => of(null)),
      finalize(() => this.oidc.logoffLocal())
    ).subscribe();
  }
}
