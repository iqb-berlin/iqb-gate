import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  BehaviorSubject, firstValueFrom, of, throwError
} from 'rxjs';
import { identityOfClaims, IqbOidcService } from './iqb-oidc.service';

describe('IqbOidcService', () => {
  let service: IqbOidcService;
  let oidc: {
    isAuthenticated$: BehaviorSubject<{ isAuthenticated: boolean }>;
    getPayloadFromIdToken: jest.Mock;
    getPayloadFromAccessToken: jest.Mock;
    authorize: jest.Mock;
    logoffAndRevokeTokens: jest.Mock;
    logoffLocal: jest.Mock;
    logoff: jest.Mock;
  };

  beforeEach(() => {
    oidc = {
      isAuthenticated$: new BehaviorSubject<{ isAuthenticated: boolean }>({ isAuthenticated: false }),
      getPayloadFromIdToken: jest.fn(() => of({ sub: 's1', preferred_username: 'anna', email: 'anna@example.org' })),
      getPayloadFromAccessToken: jest.fn(() => of({ sub: 's1', realm_access: { roles: ['admin'] } })),
      authorize: jest.fn(),
      logoffAndRevokeTokens: jest.fn(() => of({})),
      logoffLocal: jest.fn(),
      logoff: jest.fn(() => of({}))
    };
    TestBed.configureTestingModule({ providers: [{ provide: OidcSecurityService, useValue: oidc }] });
    service = TestBed.inject(IqbOidcService);
  });

  it('should say whether someone is logged in', async () => {
    expect(await firstValueFrom(service.isAuthenticated$)).toBe(false);
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    expect(await firstValueFrom(service.isAuthenticated$)).toBe(true);
  });

  // The library reports again after every renewal of the token; an application would reload for nothing
  it('should not report a renewal of the token as a new login', () => {
    const reports: boolean[] = [];
    service.isAuthenticated$.subscribe(authenticated => reports.push(authenticated));
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    oidc.isAuthenticated$.next({ isAuthenticated: false });
    expect(reports).toEqual([false, true, false]);
  });

  // Keycloak puts the realm's roles into the access token, not into userinfo
  it('should say who, with the roles of the access token', async () => {
    expect(await firstValueFrom(service.identity$)).toBeNull();
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    expect(await firstValueFrom(service.identity$)).toEqual({
      subject: 's1', username: 'anna', email: 'anna@example.org', roles: ['admin']
    });
  });

  it('should go to the provider to log in, and revoke the tokens to log out', () => {
    service.login();
    expect(oidc.authorize).toHaveBeenCalled();
    service.logout();
    expect(oidc.logoffAndRevokeTokens).toHaveBeenCalled();
    expect(oidc.logoffLocal).not.toHaveBeenCalled();
  });

  it('should log out all the same when the tokens cannot be revoked', () => {
    oidc.logoffAndRevokeTokens.mockReturnValue(throwError(() => new Error('revocation failed')));
    service.logout();
    expect(oidc.logoffLocal).toHaveBeenCalled();
    expect(oidc.logoff).toHaveBeenCalled();
  });
});

describe('identityOfClaims', () => {
  it('should fall back to the e-mail address, then the subject, for a name', () => {
    expect(identityOfClaims({ sub: 's1', email: 'a@b.org' })?.username).toBe('a@b.org');
    expect(identityOfClaims({ sub: 's1', preferred_username: '  ' })?.username).toBe('s1');
  });

  it('should know nobody without a subject', () => {
    expect(identityOfClaims(null)).toBeNull();
    expect(identityOfClaims({ preferred_username: 'anna' })).toBeNull();
  });
});
