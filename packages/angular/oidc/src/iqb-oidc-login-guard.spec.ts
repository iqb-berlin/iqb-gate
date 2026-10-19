import { TestBed } from '@angular/core/testing';
import { IqbOidcLoginGuard, LOGIN_PAUSE_MS } from './iqb-oidc-login-guard';

describe('IqbOidcLoginGuard', () => {
  let guard: IqbOidcLoginGuard;

  beforeEach(() => {
    sessionStorage.clear();
    guard = TestBed.inject(IqbOidcLoginGuard);
  });

  afterEach(() => jest.useRealTimers());

  it('should start a login, and no other within the pause', () => {
    jest.useFakeTimers({ now: 10_000 });
    const login = jest.fn();

    expect(guard.loginOnce(login)).toBe(true);
    jest.setSystemTime(10_000 + LOGIN_PAUSE_MS - 1);
    expect(guard.loginOnce(login)).toBe(false);
    jest.setSystemTime(10_000 + LOGIN_PAUSE_MS);
    expect(guard.loginOnce(login)).toBe(true);
    expect(login).toHaveBeenCalledTimes(2);
  });

  // The login leaves the page: the pause has to outlast it, or a refusing API sends the browser back and forth
  it('should keep the pause across the page the login leaves', () => {
    jest.useFakeTimers({ now: 10_000 });
    guard.loginOnce(jest.fn());

    TestBed.resetTestingModule();
    const afterReturn = TestBed.inject(IqbOidcLoginGuard);
    const login = jest.fn();

    expect(afterReturn.loginOnce(login)).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });

  it('should bring the person back to the page they were on, once', () => {
    guard.loginOnce(jest.fn());
    expect(guard.takeReturnTo()).toBe(document.location.href);
    expect(guard.takeReturnTo()).toBeNull();
  });

  it('should bring nobody to a page of another origin', () => {
    sessionStorage.setItem('iqb-oidc-return-to', 'https://evil.example.org/');
    expect(guard.takeReturnTo()).toBeNull();
  });
});
