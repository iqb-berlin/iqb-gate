import { InjectionToken } from '@angular/core';
import { HttpContextToken } from '@angular/common/http';

export interface IqbOidcOptions {
  /** The provider's issuer, e.g. `https://login.example.org/realms/iqb`. */
  issuer: string;
  /** The application's client at the provider: public, with the code flow and PKCE. */
  clientId: string;
  /**
   * Requests below these URLs carry the access token; no other request does. Each is a path from
   * the root (`/api/`) or an http(s) URL, and ends with `/`, so that `https://studio.example.org/`
   * cannot match `https://studio.example.org.attacker.net`. `/` alone is refused: it matches
   * `//attacker.net/`, another host. A request's URL is compared as the application writes it, from
   * the root (`/api/units`) or in full; one relative to the base (`api/units`) matches none and goes
   * without the token -- not resolved yet.
   */
  apiUrls: string[];
  /**
   * `openid profile email` by default. A provider that hands out a refresh token only for
   * `offline_access` (Auth0, Microsoft Entra ID) needs it named here; Keycloak does not.
   */
  scope?: string;
  /**
   * Where the provider sends the browser back after the login; by default the application's address:
   * the URL of its base (`APP_BASE_HREF`, else `<base href>`), its origin for `/`.
   */
  redirectUrl?: string;
  /** Where it sends the browser after the logout; the application's address by default, as above. */
  postLogoutRedirectUrl?: string;
}

export const IQB_OIDC_OPTIONS = new InjectionToken<IqbOidcOptions>('IQB_OIDC_OPTIONS');

/**
 * For a request whose 401 means something else than an expired login -- a wrong password the
 * application asks for itself: `new HttpContext().set(IQB_OIDC_OWN_UNAUTHORIZED, true)`.
 */
export const IQB_OIDC_OWN_UNAUTHORIZED = new HttpContextToken<boolean>(() => false);

/**
 * Whether a prefix matches addresses of one host only: a path from the root that `//` cannot begin,
 * or an http(s) URL with a host and a path. Browsers read `\` as `/` and drop tabs and line breaks
 * from a URL (`/\t/attacker.net/` is `//attacker.net/`): neither may appear at all.
 */
function isOneHost(url: string): boolean {
  const control = [...url].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  if (control || /[\s\\]/.test(url)) return false;
  return /^\/[^/]/.test(url) || /^https?:\/\/[^/?#@]+\//i.test(url);
}

/** Refuses API URLs a token could leak through: of another host, without a closing `/`, with a wildcard. */
export function checkApiUrls(apiUrls: string[]): void {
  if (!apiUrls.length) throw new Error('provideIqbOidc: apiUrls names no API.');
  const unsafe = apiUrls.filter(url => !isOneHost(url) || !url.endsWith('/') || url.includes('*'));
  if (unsafe.length) {
    throw new Error('provideIqbOidc: an API URL has to be a path from the root or an http(s) URL, ' +
      `has to end with "/" and name no wildcard: ${unsafe.join(', ')}`);
  }
}

/** Whether a request goes to one of the application's APIs, which carry the token. */
export function isApiUrl(url: string, apiUrls: string[]): boolean {
  return apiUrls.some(prefix => url.startsWith(prefix));
}
