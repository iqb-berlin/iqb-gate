import type { IncomingHttpHeaders } from 'node:http';

/**
 * Whether a request is a browser opening a page -- what the page gate looks at -- rather than a
 * script of the page fetching data or an asset. Browsers say so in `Sec-Fetch-Mode`/`-Dest`; for
 * those that do not (older ones, scripts), an `Accept` that asks for HTML decides.
 */
export function isNavigation(method: string, headers: IncomingHttpHeaders): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const mode = headers['sec-fetch-mode'];
  const destination = headers['sec-fetch-dest'];
  if (mode !== undefined || destination !== undefined) {
    return mode === 'navigate' && (destination === undefined || destination === 'document');
  }
  return /\btext\/html\b/i.test(headers.accept ?? '');
}
