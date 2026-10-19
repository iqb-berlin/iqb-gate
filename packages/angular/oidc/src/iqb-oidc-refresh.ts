import { inject, Injectable } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  catchError, finalize, map, type Observable, of, shareReplay
} from 'rxjs';

/**
 * One renewal of the session at a time: several requests refused at once wait for the same one,
 * rather than racing each other with the refresh token. Emits the new access token, or `null`
 * when the session could not be renewed -- the provider ended it, the refresh token expired, or
 * there is none.
 */
@Injectable({
  providedIn: 'root'
})
export class IqbOidcRefresh {
  private readonly oidc = inject(OidcSecurityService);
  private running: Observable<string | null> | null = null;

  renew(): Observable<string | null> {
    if (!this.running) {
      this.running = this.oidc.forceRefreshSession().pipe(
        map(result => (result?.isAuthenticated && result.accessToken ? result.accessToken : null)),
        // The library throws when the provider refuses the refresh token
        catchError(() => of(null)),
        finalize(() => {
          this.running = null;
        }),
        shareReplay(1)
      );
    }
    return this.running;
  }
}
