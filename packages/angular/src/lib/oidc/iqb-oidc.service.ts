import { inject, Injectable } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  catchError, combineLatest, distinctUntilChanged, map, type Observable, of, switchMap
} from 'rxjs';
import { IQB_OIDC_OPTIONS } from './iqb-oidc-options';
import { identityOfClaims, type IqbOidcIdentity } from '../utils/identity-of-claims';

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

  readonly identity$: Observable<IqbOidcIdentity | null> = this.isAuthenticated$.pipe(
    switchMap(authenticated => (authenticated
      ? combineLatest([this.oidc.getPayloadFromIdToken(), this.oidc.getPayloadFromAccessToken()]).pipe(
        map(([idToken, accessToken]) => identityOfClaims(idToken, accessToken, this.clientId)),
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
