import { inject } from '@angular/core';
import {
  HttpErrorResponse, type HttpEvent, type HttpHandlerFn, type HttpInterceptorFn, type HttpRequest
} from '@angular/common/http';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  catchError, type Observable, switchMap, throwError
} from 'rxjs';
import { IQB_OIDC_OPTIONS, IQB_OIDC_OWN_UNAUTHORIZED, isApiUrl } from './iqb-oidc-options';
import { IqbOidcLoginGuard } from './iqb-oidc-login-guard';
import { IqbOidcRefresh } from './iqb-oidc-refresh';

const isUnauthorized = (error: unknown): error is HttpErrorResponse => (
  error instanceof HttpErrorResponse && error.status === 401
);

/**
 * When an API refuses the access token a request carried -- it expired, or the provider ended the
 * session -- the session is renewed once and the request repeated. Should that not work, the
 * browser goes to the login (`IqbOidcLoginGuard`) and the request fails with its 401. Requests
 * without a token, and those marked `IQB_OIDC_OWN_UNAUTHORIZED`, keep their 401 as it is.
 */
export const iqbOidcUnauthorizedInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const options = inject(IQB_OIDC_OPTIONS);
  const carriesToken = req.headers.get('Authorization')?.startsWith('Bearer ') ?? false;
  if (!carriesToken || req.context.get(IQB_OIDC_OWN_UNAUTHORIZED) || !isApiUrl(req.url, options.apiUrls)) {
    return next(req);
  }
  const oidc = inject(OidcSecurityService);
  const loginGuard = inject(IqbOidcLoginGuard);
  const refresh = inject(IqbOidcRefresh);
  const login = () => loginGuard.loginOnce(() => oidc.authorize());
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!isUnauthorized(error)) return throwError(() => error);
      return refresh.renew().pipe(
        switchMap(token => {
          if (!token) {
            login();
            return throwError(() => error);
          }
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
            catchError((again: unknown) => {
              if (isUnauthorized(again)) login();
              return throwError(() => again);
            })
          );
        })
      );
    })
  );
};
