import type { IncomingHttpHeaders } from 'node:http';

/**
 * Headers only the gateway may set; whatever a client sends under this prefix is dropped, and so
 * is what the application answers with under it.
 */
export const RESERVED_HEADER_PREFIX = 'x-iqb-gate-';

/**
 * Headers without the reserved ones -- for the application's answers, so that the browser library
 * takes no answer of the application for one of the gateway's (`x-iqb-gate-refusal`).
 */
export function withoutReservedHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !name.toLowerCase().startsWith(RESERVED_HEADER_PREFIX))
  ) as IncomingHttpHeaders;
}

/**
 * Other ways a client could claim an origin of its own. The gateway states the origin in
 * `X-Forwarded-*` alone, so these never reach the upstream.
 */
const CLAIMED_ORIGIN_HEADERS = [
  'forwarded', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port'
];

/** What the gateway knows about the request it forwards. */
export interface ForwardedRequest {
  /**
   * The addresses the request passed, from the client to whoever connected to the gateway --
   * only as far as they can be believed: the peer, and before it only what trusted proxies
   * reported (Fastify's `request.ips`, reversed). Without a trusted proxy, just the peer.
   */
  chain: string[];
  /** `http` or `https`, as the client used it (Fastify's `request.protocol`, honouring `trustProxy`). */
  protocol: string;
  /** The host the client asked for (Fastify's `request.host`, honouring `trustProxy`). */
  host: string | undefined;
}

/**
 * The headers to send upstream: the client's, without the reserved ones and without any claim of
 * origin, plus `X-Forwarded-For`, `-Proto` and `-Host` as far as the gateway can vouch for them.
 * A client that is no trusted proxy cannot put an address of its choice into the chain.
 */
export function forwardedHeaders(headers: IncomingHttpHeaders, request: ForwardedRequest): IncomingHttpHeaders {
  const kept = Object.fromEntries(
    Object.entries(withoutReservedHeaders(headers))
      .filter(([name]) => !CLAIMED_ORIGIN_HEADERS.includes(name.toLowerCase()))
  ) as IncomingHttpHeaders;
  const chain = request.chain.filter(address => address !== '');
  return {
    ...kept,
    ...(chain.length ? { 'x-forwarded-for': chain.join(', ') } : {}),
    'x-forwarded-proto': request.protocol,
    ...(request.host ? { 'x-forwarded-host': request.host } : {})
  };
}
