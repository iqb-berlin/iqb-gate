import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import {
  firstValueFrom, of, Subject, throwError
} from 'rxjs';
import { IqbOidcRefresh } from './iqb-oidc-refresh';

describe('IqbOidcRefresh', () => {
  let oidc: { forceRefreshSession: jest.Mock };
  let refresh: IqbOidcRefresh;

  beforeEach(() => {
    oidc = { forceRefreshSession: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: OidcSecurityService, useValue: oidc }] });
    refresh = TestBed.inject(IqbOidcRefresh);
  });

  it('should give the new access token', async () => {
    oidc.forceRefreshSession.mockReturnValue(of({ isAuthenticated: true, accessToken: 'fresh' }));
    expect(await firstValueFrom(refresh.renew())).toBe('fresh');
  });

  // The library throws when the provider refuses the refresh token
  it('should give null when the session cannot be renewed, however the library says so', async () => {
    oidc.forceRefreshSession.mockReturnValue(of({ isAuthenticated: false }));
    expect(await firstValueFrom(refresh.renew())).toBeNull();
    oidc.forceRefreshSession.mockReturnValue(throwError(() => new Error('invalid_grant')));
    expect(await firstValueFrom(refresh.renew())).toBeNull();
  });

  it('should let requests refused at once wait for one renewal', async () => {
    const result = new Subject<{ isAuthenticated: boolean; accessToken: string }>();
    oidc.forceRefreshSession.mockReturnValue(result);

    const first = firstValueFrom(refresh.renew());
    const second = firstValueFrom(refresh.renew());
    result.next({ isAuthenticated: true, accessToken: 'fresh' });
    result.complete();

    expect(await Promise.all([first, second])).toEqual(['fresh', 'fresh']);
    expect(oidc.forceRefreshSession).toHaveBeenCalledTimes(1);
  });
});
