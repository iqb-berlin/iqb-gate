import type { FastifyInstance } from 'fastify';
import { CHALLENGE_PATH, VERIFY_PATH } from '@iqb/gate-protocol';
import type { PersonVerification } from './person-verification.js';
import { readSession } from './gate-session.js';
import type { RateLimit } from '../rate-limit.js';
import { answerChallenge } from '../challenge-route.js';

/**
 * The challenge a session solves before it may write or read under a rule, and the place its
 * solution is handed in. The library in the browser comes here when a request is answered with
 * 428 -- and that answer started the session. A challenge costs the gateway a key derivation, so it
 * is handed out only to a session the gateway started, and to each client address only so often
 * (`challengeLimit`): a person needs one, a loop would need many.
 */
export function registerVerificationRoutes(
  gateway: FastifyInstance,
  verification: PersonVerification,
  challengeLimit: RateLimit
): void {
  gateway.get(CHALLENGE_PATH, async (request, reply) => {
    if (!readSession(request)) {
      return reply.code(400).header('cache-control', 'no-store').send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'A challenge belongs to a session; a checked request starts one.'
      });
    }
    return answerChallenge(request, reply, challengeLimit, () => verification.createChallenge());
  });

  gateway.post<{ Body: { payload?: unknown } | undefined }>(VERIFY_PATH, async (request, reply) => {
    // A request without the session cookie has nothing a solution could be counted for
    const sessionId = readSession(request);
    const payload = request.body?.payload;
    const verified = !!sessionId && typeof payload === 'string' && await verification.verify(sessionId, payload);
    if (!verified) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'The challenge was not solved.' });
    }
    return true;
  });
}
