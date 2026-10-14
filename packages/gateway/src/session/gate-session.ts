import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
// The decorations of @fastify/cookie, which the gateway registers
import type {} from '@fastify/cookie';

/** The session cookie over plain HTTP (local setups). */
export const SESSION_COOKIE = 'iqb-gate-session';

/** The session cookie over HTTPS: `__Host-` makes the browser keep it to this host and path `/`. */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;

/**
 * The session the gateway counts writes and solved challenges for, from its signed cookie; `null`
 * when the request carries none, or one the gateway did not sign. Needs `@fastify/cookie` with the
 * gateway's secret; the cookies are parsed here, for the few requests that need them, not for all
 * the traffic through the gateway.
 */
export function readSession(request: FastifyRequest): string | null {
  const cookies = request.server.parseCookie(request.headers.cookie ?? '');
  const value = cookies[SECURE_SESSION_COOKIE] ?? cookies[SESSION_COOKIE];
  if (!value) return null;
  const unsigned = request.unsignCookie(value);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

/**
 * Starts a session: a random id in a signed cookie that lives as long as the browser session. Not
 * readable by scripts, and sent along with requests from the same site only. `secure` when the
 * client came over HTTPS -- under ForwardAuth that is Traefik's word, not the subrequest's protocol.
 */
export function startSession(reply: FastifyReply, secure: boolean): string {
  const id = randomBytes(18).toString('base64url');
  reply.setCookie(secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE, id, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  });
  return id;
}
