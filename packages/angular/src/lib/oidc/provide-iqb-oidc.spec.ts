import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { OidcSecurityService, StsConfigLoader } from 'angular-auth-oidc-client';
import {
  firstValueFrom, NEVER, of, throwError
} from 'rxjs';
import { iqbOidcInterceptors, provideIqbOidc } from './provide-iqb-oidc';
import { iqbOidcUnauthorizedInterceptor } from './iqb-oidc-unauthorized.interceptor';

describe('provideIqbOidc', () => {
  const options = { issuer: 'https://login.example.org/realms/iqb', clientId: 'studio', apiUrls: ['/api/'] };

  const startWith = async (checkAuth: jest.Mock) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideIqbOidc(options), { provide: OidcSecurityService, useValue: { checkAuth } }
      ]
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
  };

  beforeEach(() => sessionStorage.clear());
  afterEach(() => jest.useRealTimers());

  it('should configure the code flow with refresh tokens, the token only on the APIs', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideIqbOidc(options)] });
    const [config] = await firstValueFrom(TestBed.inject(StsConfigLoader).loadConfigs());
    expect(config).toEqual(expect.objectContaining({
      authority: 'https://login.example.org/realms/iqb',
      clientId: 'studio',
      responseType: 'code',
      useRefreshToken: true,
      silentRenew: true,
      secureRoutes: ['/api/'],
      redirectUrl: document.location.origin,
      postLogoutRedirectUri: document.location.origin
    }));
  });

  it('should refuse API URLs a token could leak through', () => {
    expect(() => provideIqbOidc({ ...options, apiUrls: ['https://studio.example.org'] })).toThrow(/end with/);
  });

  it('should take over a login the browser comes back from, at the start', async () => {
    const checkAuth = jest.fn(() => of({ isAuthenticated: true }));
    await startWith(checkAuth);
    expect(checkAuth).toHaveBeenCalled();
  });

  it('should return to the page a forced login left', async () => {
    const before = document.location.href;
    sessionStorage.setItem('iqb-oidc-return-to', `${document.location.origin}/#/workspace/3`);
    await startWith(jest.fn(() => of({ isAuthenticated: true })));
    expect(document.location.href).toBe(`${document.location.origin}/#/workspace/3`);
    history.replaceState(null, '', before);
  });

  // The person went back from the provider without logging in; a later login lands where it is meant to
  it('should forget the page of a forced login that was abandoned', async () => {
    const before = document.location.href;
    sessionStorage.setItem('iqb-oidc-return-to', `${document.location.origin}/#/workspace/3`);
    await startWith(jest.fn(() => of({ isAuthenticated: false })));
    expect(document.location.href).toBe(before);
    expect(sessionStorage.getItem('iqb-oidc-return-to')).toBeNull();
  });

  it('should forget it as well when the provider fails', async () => {
    sessionStorage.setItem('iqb-oidc-return-to', `${document.location.origin}/#/workspace/3`);
    await startWith(jest.fn(() => throwError(() => new Error('unreachable'))));
    expect(sessionStorage.getItem('iqb-oidc-return-to')).toBeNull();
  });

  it('should let the application start when the provider fails', async () => {
    await expect(startWith(jest.fn(() => throwError(() => new Error('unreachable'))))).resolves.toBeUndefined();
  });

  it('should let the application start when the provider does not answer', async () => {
    jest.useFakeTimers();
    const started = startWith(jest.fn(() => NEVER));
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(started).resolves.toBeUndefined();
  });
});

describe('iqbOidcInterceptors', () => {
  it('should put the token on first, then handle the 401 of a request that carried it', () => {
    const interceptors = iqbOidcInterceptors();
    expect(interceptors).toHaveLength(2);
    expect(interceptors[1]).toBe(iqbOidcUnauthorizedInterceptor);
  });
});
