import type { GatewayConfig } from './config.js';
import { pathVariants } from './request-path.js';

/**
 * The seconds the upstream may stay silent on a request for `url`: those of the longest prefix
 * the path lies in -- the prefix itself or below it, `/api/upload` covering `/api/upload/x` but
 * not `/api/uploads` -- otherwise the default. The query is no part of the path. Matched as the
 * gate rules are: without regard to case, and as sent or as the application reads it -- a long
 * export asked for as `/API/...` reaches the same controller and needs the same time.
 */
export function timeoutSecondsFor(url: string, timeouts: GatewayConfig['timeouts']): number {
  // Asked for every request, assets included: no path parsed where no prefix could cover it
  if (!timeouts.paths.length) return timeouts.defaultSeconds;
  const { raw, normalised } = pathVariants(url);
  const spellings = [raw.toLowerCase(), normalised.toLowerCase()];
  const covers = (prefix: string) => {
    const lower = prefix.toLowerCase();
    return spellings.some(path => path === lower || path.startsWith(`${lower}/`));
  };
  const covering = timeouts.paths
    .filter(({ prefix }) => covers(prefix))
    .reduce<GatewayConfig['timeouts']['paths'][number] | undefined>(
      (longest, candidate) => (!longest || candidate.prefix.length > longest.prefix.length ? candidate : longest),
      undefined
    );
  return covering?.seconds ?? timeouts.defaultSeconds;
}
