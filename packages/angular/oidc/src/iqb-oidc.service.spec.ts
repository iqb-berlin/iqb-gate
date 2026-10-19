import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  BehaviorSubject, firstValueFrom, of, throwError
} from 'rxjs';
import { IqbOidcService } from './iqb-oidc.service';
import { IQB_OIDC_OPTIONS } from './iqb-oidc-options';

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

  // The library reports every renewal; a role granted meanwhile comes with the renewed token
  it('should report roles that change with a renewal of the token, and nothing for an unchanged one', () => {
    const roles: string[][] = [];
    service.identity$.subscribe(identity => roles.push(identity?.roles ?? []));
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    oidc.getPayloadFromAccessToken.mockReturnValue(of({ sub: 's1', realm_access: { roles: ['admin', 'editor'] } }));
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    expect(roles).toEqual([[], ['admin'], ['admin', 'editor']]);
  });

  it('should add the roles of the configured client', async () => {
    oidc.getPayloadFromAccessToken.mockReturnValue(of({
      sub: 's1', realm_access: { roles: ['admin'] }, resource_access: { studio: { roles: ['editor'] } }
    }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: OidcSecurityService, useValue: oidc },
        {
          provide: IQB_OIDC_OPTIONS,
          useValue: { issuer: 'https://login.example.org', clientId: 'studio', apiUrls: [] }
        }
      ]
    });
    oidc.isAuthenticated$.next({ isAuthenticated: true });
    const identity = await firstValueFrom(TestBed.inject(IqbOidcService).identity$);
    expect(identity?.roles).toEqual(['admin', 'editor']);
  });

  it('should go to the provider to log in, and revoke the tokens to log out', () => {
    service.login();
    expect(oidc.authorize).toHaveBeenCalled();
    service.logout();
    expect(oidc.logoffAndRevokeTokens).toHaveBeenCalled();
    expect(oidc.logoffAndRevokeTokens.mock.invocationCallOrder[0])
      .toBeLessThan(oidc.logoffLocal.mock.invocationCallOrder[0]);
  });

  // logoff() names the session by the ID token; dropped before, the provider would keep the session
  it('should end the provider\'s session all the same when the tokens cannot be revoked', () => {
    oidc.logoffAndRevokeTokens.mockReturnValue(throwError(() => new Error('revocation failed')));
    service.logout();
    expect(oidc.logoff).toHaveBeenCalled();
    expect(oidc.logoff.mock.invocationCallOrder[0]).toBeLessThan(oidc.logoffLocal.mock.invocationCallOrder[0]);
  });

  // Without an end-session endpoint the library's logoff() answers null and leaves the tokens
  it('should drop the tokens here when the provider\'s session cannot be ended', () => {
    oidc.logoffAndRevokeTokens.mockReturnValue(throwError(() => new Error('revocation failed')));
    oidc.logoff.mockReturnValue(of(null));
    service.logout();
    expect(oidc.logoffLocal).toHaveBeenCalled();
    oidc.logoffLocal.mockClear();
    oidc.logoff.mockReturnValue(throwError(() => new Error('no configuration')));
    service.logout();
    expect(oidc.logoffLocal).toHaveBeenCalled();
  });
});
