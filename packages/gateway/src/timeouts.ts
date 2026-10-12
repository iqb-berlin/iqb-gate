import type { GatewayConfig } from './config.js';

/**
 * The seconds the upstream may stay silent on a request for `url`: those of the longest prefix
 * the path lies in -- the prefix itself or below it, `/api/upload` covering `/api/upload/x` but
 * not `/api/uploads` -- otherwise the default. The query is no part of the path.
 */
export function timeoutSecondsFor(url: string, timeouts: GatewayConfig['timeouts']): number {
  const path = url.split('?', 1)[0];
  const covering = timeouts.paths
    .filter(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
    .reduce<GatewayConfig['timeouts']['paths'][number] | undefined>(
      (longest, candidate) => (!longest || candidate.prefix.length > longest.prefix.length ? candidate : longest),
      undefined
    );
  return covering?.seconds ?? timeouts.defaultSeconds;
}
