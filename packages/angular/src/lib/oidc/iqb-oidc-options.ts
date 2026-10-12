import { InjectionToken } from '@angular/core';
import { HttpContextToken } from '@angular/common/http';

export interface IqbOidcOptions {
  /** The provider's issuer, e.g. `https://login.example.org/realms/iqb`. */
  issuer: string;
  /** The application's client at the provider: public, with the code flow and PKCE. */
  clientId: string;
  /**
   * Requests below these URLs carry the access token; no other request does. Each ends with `/`,
   * so that `https://studio.example.org/` cannot match `https://studio.example.org.attacker.net`.
   */
  apiUrls: string[];
  scope?: string;
  /** Where the provider sends the browser back after the login; the application's origin by default. */
  redirectUrl?: string;
  /** Where it sends the browser after the logout; the application's origin by default. */
  postLogoutRedirectUrl?: string;
}

export const IQB_OIDC_OPTIONS = new InjectionToken<IqbOidcOptions>('IQB_OIDC_OPTIONS');

/**
 * For a request whose 401 means something else than an expired login -- a wrong password the
 * application asks for itself: `new HttpContext().set(IQB_OIDC_OWN_UNAUTHORIZED, true)`.
 */
export const IQB_OIDC_OWN_UNAUTHORIZED = new HttpContextToken<boolean>(() => false);

/** Refuses API URLs a token could leak through: without a closing `/`, or with a wildcard. */
export function checkApiUrls(apiUrls: string[]): void {
  if (!apiUrls.length) throw new Error('provideIqbOidc: apiUrls names no API.');
  const unsafe = apiUrls.filter(url => !url.endsWith('/') || url.includes('*'));
  if (unsafe.length) {
    throw new Error(`provideIqbOidc: an API URL has to end with "/" and name no wildcard: ${unsafe.join(', ')}`);
  }
}

/** Whether a request goes to one of the application's APIs, which carry the token. */
export function isApiUrl(url: string, apiUrls: string[]): boolean {
  return apiUrls.some(prefix => url.startsWith(prefix));
}
