import type { FastifyRequest } from 'fastify';

/**
 * The request a check decides on. In the proxy that is the request itself. Under Traefik's
 * ForwardAuth the gateway sees only Traefik's subrequest, and the request it is asked about is named
 * in its `X-Forwarded-*` headers; the client's other headers -- cookies, `Authorization`, the
 * browser's report -- come along as they were.
 */
export interface CheckTarget {
  method: string;
  url: string;
  /** `http` or `https`, as the client used it. */
  protocol: 'http' | 'https';
  /**
   * Whether Traefik asks. Its ForwardAuth passes on whatever answers 2xx, so a page the gateway
   * keeps back has to be answered with another status.
   */
  forwardAuth: boolean;
}

/** The request through the proxy, as it is. */
export function proxiedTarget(request: FastifyRequest): CheckTarget {
  return {
    method: request.method,
    url: request.url,
    protocol: request.protocol === 'https' ? 'https' : 'http',
    forwardAuth: false
  };
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * The request Traefik asks about, from the `X-Forwarded-Method`, `-Uri` and `-Proto` it sets on its
 * subrequest; `undefined` when one of them is missing or makes no sense. Method and address are read
 * as they are: Traefik overwrites what a client sent, as long as its `trustForwardHeader` stays off --
 * and a caller that reaches the gateway around Traefik gets an answer that lets nothing through
 * anyway. HTTPS is believed as everywhere in the gateway, from a proxy in `IQB_GATE_TRUST_PROXY`
 * (`request.protocol`): the page gate's pass is handed out only over HTTPS so judged, and a page
 * gated on a word the pass route does not believe could never be passed.
 */
export function forwardedTarget(request: FastifyRequest): CheckTarget | undefined {
  const method = singleHeader(request, 'x-forwarded-method')?.toUpperCase();
  const url = singleHeader(request, 'x-forwarded-uri');
  const protocol = singleHeader(request, 'x-forwarded-proto')?.toLowerCase();
  // One method and one address: a list, as a proxy that appends would make it, names no request
  if (!method || !/^[A-Z]+$/.test(method) || !url?.startsWith('/') || /\s/.test(url)) return undefined;
  if (protocol !== 'http' && protocol !== 'https') return undefined;
  return { method, url, protocol: request.protocol.toLowerCase() === 'https' ? 'https' : 'http', forwardAuth: true };
}
