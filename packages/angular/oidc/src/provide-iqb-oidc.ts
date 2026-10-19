import {
  DOCUMENT, type EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer
} from '@angular/core';
import { APP_BASE_HREF } from '@angular/common';
import {
  authInterceptor, OidcSecurityService, provideAuth, StsConfigLoader, StsConfigStaticLoader
} from 'angular-auth-oidc-client';
import type { HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { checkApiUrls, IQB_OIDC_OPTIONS, type IqbOidcOptions } from './iqb-oidc-options';
import { iqbOidcUnauthorizedInterceptor } from './iqb-oidc-unauthorized.interceptor';
import { IqbOidcLoginGuard } from './iqb-oidc-login-guard';
import { applicationUrl } from './application-url';

/** Seconds before its expiry a token is renewed, so that no request goes out with an expiring one. */
const RENEW_BEFORE_EXPIRY_SECONDS = 30;

/**
 * Without `offline_access`: Keycloak then ties the refresh token to the login session, instead of
 * an offline token in the browser's storage that outlives the logout and the session's end.
 */
const DEFAULT_SCOPE = 'openid profile email';

/** How long the start of the application waits for the provider before it starts logged out. */
const CHECK_AUTH_TIMEOUT_MS = 10 * 1000;

/**
 * At the start: takes over a login the browser comes back from, and returns to the page a forced
 * login left. A provider that fails or does not answer in time leaves the application logged out,
 * never unstarted.
 */
async function checkAuthAtStart(): Promise<void> {
  const oidc = inject(OidcSecurityService);
  const loginGuard = inject(IqbOidcLoginGuard);
  const document = inject(DOCUMENT);
  const authenticated = await firstValueFrom(oidc.checkAuth().pipe(timeout(CHECK_AUTH_TIMEOUT_MS)))
    .then(result => !!result?.isAuthenticated, () => false);
  // Taken whatever came of it: a forced login the person abandoned must not send a later one there
  const returnTo = loginGuard.takeReturnTo();
  // Before the router's first navigation, which then starts at the page the person was on
  if (authenticated && returnTo && returnTo !== document.location.href) {
    document.defaultView?.history.replaceState(null, '', returnTo);
  }
}

/**
 * Logs the browser in with an OpenID Connect provider, as coding-box does with Keycloak: the code
 * flow with PKCE, the tokens kept in the browser and renewed with the refresh token, the access
 * token on the requests whose URL begins with one of `apiUrls` -- and only there (relative request
 * URLs are not resolved yet, see `IqbOidcOptions.apiUrls`). At the start of the application the
 * library looks whether the browser just came back from the provider (`?code=&state=`), and takes
 * over the login. The backends check the token (`@iqb/gate-nest`).
 *
 * The interceptors are registered with the application's HTTP client:
 * `withInterceptors([...iqbOidcInterceptors(), iqbGateInterceptor])`.
 */
export function provideIqbOidc(options: IqbOidcOptions): EnvironmentProviders {
  checkApiUrls(options.apiUrls);
  return makeEnvironmentProviders([
    { provide: IQB_OIDC_OPTIONS, useValue: options },
    provideAuth({
      loader: {
        provide: StsConfigLoader,
        useFactory: () => {
          // The base the router takes: APP_BASE_HREF, else the href of <base>
          const document = inject(DOCUMENT);
          const baseHref = inject(APP_BASE_HREF, { optional: true })
            ?? document.querySelector('base[href]')?.getAttribute('href') ?? null;
          const appUrl = applicationUrl(document.location.href, baseHref);
          return new StsConfigStaticLoader({
            authority: options.issuer,
            clientId: options.clientId,
            scope: options.scope ?? DEFAULT_SCOPE,
            responseType: 'code',
            redirectUrl: options.redirectUrl ?? appUrl,
            postLogoutRedirectUri: options.postLogoutRedirectUrl ?? appUrl,
            silentRenew: true,
            useRefreshToken: true,
            renewTimeBeforeTokenExpiresInSeconds: RENEW_BEFORE_EXPIRY_SECONDS,
            ignoreNonceAfterRefresh: true,
            // The library would navigate to '/' after a login, and to '/unauthorized' after a failed
            // one -- racing checkAuthAtStart, which returns to the page a forced login left
            triggerAuthorizationResultEvent: true,
            secureRoutes: options.apiUrls
          });
        }
      }
    }),
    provideAppInitializer(checkAuthAtStart)
  ]);
}

/** The access token on the API requests, and a renewal or a new login when an API answers 401. */
export function iqbOidcInterceptors(): HttpInterceptorFn[] {
  return [authInterceptor(), iqbOidcUnauthorizedInterceptor];
}
