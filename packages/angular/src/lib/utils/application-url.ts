/**
 * The address of the application, where the provider sends the browser back: the URL of its base
 * -- `https://host/studio/` for `/studio/` -- and its origin for a base of `/`, as before (a
 * provider's client registered for `https://host` keeps working). `pageUrl` is the page the browser
 * shows, which a relative base is resolved against; `baseHref` the base the router takes, `null`
 * or empty without one. A base on another origin (assets on a CDN) is no address of the application.
 */
export function applicationUrl(pageUrl: string, baseHref: string | null): string {
  const { origin } = new URL(pageUrl);
  if (!baseHref) return origin;
  // Like a browser with <base href>: a base that names no folder stands for the one it lies in
  const base = new URL('.', new URL(baseHref, pageUrl));
  return base.origin !== origin || base.pathname === '/' ? origin : base.href;
}
