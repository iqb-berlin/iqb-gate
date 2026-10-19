/**
 * The address of the application, where the provider sends the browser back: the URL of its base
 * -- `https://host/studio/` for `/studio/`, `/studio` or `/studio/index.html` -- and its origin for
 * a base of `/`, as before (a provider's client registered for `https://host` keeps working).
 * `pageUrl` is the page the browser shows, which a relative base is resolved against; `baseHref`
 * the base the router takes, `null` or empty without one. A base on another origin (assets on a
 * CDN) is no address of the application.
 */
export function applicationUrl(pageUrl: string, baseHref: string | null): string {
  const { origin } = new URL(pageUrl);
  if (!baseHref) return origin;
  const base = new URL(baseHref, pageUrl);
  if (base.origin !== origin) return origin;
  // Like the router's Location: the base is the path the application lies below, with its slash or
  // without, and without an index.html at its end
  const folder = base.pathname.replace(/\/index\.html$/, '/');
  const path = folder.endsWith('/') ? folder : `${folder}/`;
  return path === '/' ? origin : `${origin}${path}`;
}
