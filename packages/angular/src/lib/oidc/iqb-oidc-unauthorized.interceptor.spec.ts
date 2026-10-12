import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  HttpContext, HttpErrorResponse, HttpHeaders, HttpRequest, HttpResponse
} from '@angular/common/http';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  firstValueFrom, type Observable, of, throwError
} from 'rxjs';
import { iqbOidcUnauthorizedInterceptor } from './iqb-oidc-unauthorized.interceptor';
import { IQB_OIDC_OPTIONS, IQB_OIDC_OWN_UNAUTHORIZED } from './iqb-oidc-options';

describe('iqbOidcUnauthorizedInterceptor', () => {
  let oidc: { forceRefreshSession: jest.Mock; authorize: jest.Mock };
  const refused = new HttpErrorResponse({ status: 401, url: '/api/x' });
  const answered = new HttpResponse({ status: 200, body: { ok: true } });
  const withToken = new HttpHeaders({ Authorization: 'Bearer old' });

  /** A handler that answers each call with the next of the given answers. */
  const handlerAnswering = (...answers: Array<HttpResponse<unknown> | HttpErrorResponse>) => jest.fn(
    (_request: HttpRequest<unknown>): Observable<HttpResponse<unknown>> => {
      const answer = answers.shift();
      return answer instanceof HttpErrorResponse ? throwError(() => answer) : of(answer as HttpResponse<unknown>);
    }
  );

  const intercept = (
    request: HttpRequest<unknown>,
    next: ReturnType<typeof handlerAnswering>
  ) => runInInjectionContext(
    TestBed.inject(EnvironmentInjector),
    () => firstValueFrom(iqbOidcUnauthorizedInterceptor(request, next))
  );

  const apiRequest = (url = '/api/x', context?: HttpContext) => new HttpRequest('GET', url, {
    headers: withToken, ...(context ? { context } : {})
  });

  beforeEach(() => {
    sessionStorage.clear();
    oidc = { forceRefreshSession: jest.fn(), authorize: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: OidcSecurityService, useValue: oidc },
        {
          provide: IQB_OIDC_OPTIONS,
          useValue: { issuer: 'https://login.example.org', clientId: 'studio', apiUrls: ['/api/'] }
        }
      ]
    });
  });

  it('should leave requests to anything but the APIs alone', async () => {
    const next = handlerAnswering(new HttpErrorResponse({ status: 401 }));
    await expect(intercept(new HttpRequest('GET', '/assets/x', { headers: withToken }), next))
      .rejects.toMatchObject({ status: 401 });
    expect(oidc.forceRefreshSession).not.toHaveBeenCalled();
  });

  // Nobody was logged in: the application decides what its 401 means
  it('should leave a request without a token alone', async () => {
    const next = handlerAnswering(refused);
    await expect(intercept(new HttpRequest('GET', '/api/x'), next)).rejects.toBe(refused);
    expect(oidc.forceRefreshSession).not.toHaveBeenCalled();
  });

  // A wrong password the application asks for itself is no expired login
  it('should leave a request alone whose 401 the application answers itself', async () => {
    const own = new HttpContext().set(IQB_OIDC_OWN_UNAUTHORIZED, true);
    await expect(intercept(apiRequest('/api/password', own), handlerAnswering(refused))).rejects.toBe(refused);
    expect(oidc.forceRefreshSession).not.toHaveBeenCalled();
  });

  it('should renew the session once on a 401 and repeat the request with the new token', async () => {
    oidc.forceRefreshSession.mockReturnValue(of({ isAuthenticated: true, accessToken: 'fresh' }));
    const next = handlerAnswering(refused, answered);

    expect(await intercept(apiRequest(), next)).toBe(answered);
    expect(next.mock.calls[1][0].headers.get('Authorization')).toBe('Bearer fresh');
    expect(oidc.authorize).not.toHaveBeenCalled();
  });

  // The library throws when the provider ended the session or the refresh token expired
  it('should send the browser to the login when the session cannot be renewed, failing with the 401', async () => {
    oidc.forceRefreshSession.mockReturnValue(throwError(() => new Error('invalid_grant')));

    await expect(intercept(apiRequest(), handlerAnswering(refused))).rejects.toBe(refused);
    expect(oidc.authorize).toHaveBeenCalledTimes(1);
  });

  it('should send the browser to the login when the API refuses even the renewed token, once in a while', async () => {
    oidc.forceRefreshSession.mockReturnValue(of({ isAuthenticated: true, accessToken: 'fresh' }));
    const again = () => handlerAnswering(refused, new HttpErrorResponse({ status: 401, url: '/api/x' }));

    await expect(intercept(apiRequest(), again())).rejects.toMatchObject({ status: 401 });
    await expect(intercept(apiRequest('/api/y'), again())).rejects.toMatchObject({ status: 401 });
    expect(oidc.authorize).toHaveBeenCalledTimes(1);
  });

  it('should pass any other error on', async () => {
    const next = handlerAnswering(new HttpErrorResponse({ status: 500 }));
    await expect(intercept(apiRequest(), next)).rejects.toMatchObject({ status: 500 });
    expect(oidc.forceRefreshSession).not.toHaveBeenCalled();
  });
});
