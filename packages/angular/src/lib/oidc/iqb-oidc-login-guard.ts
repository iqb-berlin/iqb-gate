import { DOCUMENT, inject, Injectable } from '@angular/core';
import { sessionMemory } from './session-memory';

/** How long after one login another may start by itself. */
export const LOGIN_PAUSE_MS = 30 * 1000;

const LOGIN_AT_KEY = 'iqb-oidc-login-at';
const RETURN_TO_KEY = 'iqb-oidc-return-to';

/**
 * Starts the logins that are not the person's own choice -- after an API refused the token -- and
 * brings the person back to where they were. Only one such login within {@link LOGIN_PAUSE_MS}:
 * the login leaves the page, so the pause is kept in the session storage, and an API that keeps
 * refusing a fresh token cannot send the browser back and forth.
 */
@Injectable({
  providedIn: 'root'
})
export class IqbOidcLoginGuard {
  private readonly document = inject(DOCUMENT);

  loginOnce(login: () => void): boolean {
    const now = Date.now();
    const last = Number(sessionMemory.get(LOGIN_AT_KEY) ?? 0);
    if (last && now - last < LOGIN_PAUSE_MS) return false;
    sessionMemory.set(LOGIN_AT_KEY, String(now));
    sessionMemory.set(RETURN_TO_KEY, this.document.location.href);
    login();
    return true;
  }

  /**
   * After the login: the page the person was on, once, if it is one of this application -- the
   * router then starts there instead of at the redirect URL.
   */
  takeReturnTo(): string | null {
    const target = sessionMemory.get(RETURN_TO_KEY);
    sessionMemory.remove(RETURN_TO_KEY);
    if (!target) return null;
    try {
      return new URL(target).origin === this.document.location.origin ? target : null;
    } catch {
      return null;
    }
  }
}
