import type { FastifyPluginAsync } from 'fastify';
import { GATE_PREFIX } from './config.js';
import { forwardedTarget } from './check-target.js';
import type { GatePreHandler } from './gate-pre-handler.js';

/** Where Traefik's ForwardAuth asks the gateway about a request. */
export const FORWARD_AUTH_PATH = `${GATE_PREFIX}/auth`;

/**
 * The gateway as Traefik's ForwardAuth: the checks decide on the request Traefik names
 * (`forwardedTarget`), and whatever one of them answers -- 428, 403, the interstitial -- Traefik
 * hands to the client as it is, cookies included. Otherwise the answer is 200, and Traefik passes the
 * request on to the application. A 200 sets no cookie: a session starts only with a refusal, as a
 * new one has solved no challenge yet. A plugin of its own, so that it can leave the body unread.
 */
export function forwardAuthRoute(evaluate: GatePreHandler): FastifyPluginAsync {
  return async scope => {
    // Traefik sends no body -- unless it keeps the method or passes the body on. Either way the body is
    // left unread: parsed, an upload or a broken JSON would be answered 413, 415 or 400 instead of decided.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined));

    scope.all(FORWARD_AUTH_PATH, async (request, reply) => {
      const target = forwardedTarget(request);
      if (!target) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `${FORWARD_AUTH_PATH} answers Traefik's ForwardAuth: `
            + 'X-Forwarded-Method, -Uri and -Proto are missing or make no sense.'
        });
      }
      if (await evaluate(request, reply, target)) return reply;
      return reply.code(200).send();
    });
  };
}
