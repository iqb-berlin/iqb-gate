import {
  DOCUMENT, type EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer
} from '@angular/core';
import {
  authInterceptor, OidcSecurityService, provideAuth, StsConfigLoader, StsConfigStaticLoader
} from 'angular-auth-oidc-client';
import type { HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { checkApiUrls, IQB_OIDC_OPTIONS, type IqbOidcOptions } from './iqb-oidc-options';
import { iqbOidcUnauthorizedInterceptor } from './iqb-oidc-unauthorized.interceptor';
import { IqbOidcLoginGuard } from './iqb-oidc-login-guard';

/** Seconds before its expiry a token is renewed, so that no request goes out with an expiring one. */
const RENEW_BEFORE_EXPIRY_SECONDS = 30;

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
  try {
    const result = await firstValueFrom(oidc.checkAuth().pipe(timeout(CHECK_AUTH_TIMEOUT_MS)));
    const returnTo = result?.isAuthenticated ? loginGuard.takeReturnTo() : null;
    // Before the router's first navigation, which then starts at the page the person was on
    if (returnTo && returnTo !== document.location.href) document.defaultView?.history.replaceState(null, '', returnTo);
  } catch {
    // Logged out
  }
}

/**
 * Logs the browser in with an OpenID Connect provider, as coding-box does with Keycloak: the code
 * flow with PKCE, the tokens kept in the browser and renewed with the refresh token, the access
 * token on the requests to `apiUrls` -- and only there. At the start of the application the
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
          const origin = inject(DOCUMENT).location.origin;
          return new StsConfigStaticLoader({
            authority: options.issuer,
            clientId: options.clientId,
            scope: options.scope ?? 'openid profile email offline_access',
            responseType: 'code',
            redirectUrl: options.redirectUrl ?? origin,
            postLogoutRedirectUri: options.postLogoutRedirectUrl ?? origin,
            silentRenew: true,
            useRefreshToken: true,
            renewTimeBeforeTokenExpiresInSeconds: RENEW_BEFORE_EXPIRY_SECONDS,
            ignoreNonceAfterRefresh: true,
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
