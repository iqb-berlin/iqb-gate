import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTOMATION_DETECTED_CODE,
  AUTOMATION_DETECTED_STATUS,
  CHALLENGE_PATH,
  CLIENT_SIGNALS_HEADER,
  type GateRejection,
  HUMAN_VERIFICATION_REQUIRED_CODE,
  HUMAN_VERIFICATION_REQUIRED_STATUS,
  VERIFY_PATH
} from '@iqb/gate-protocol';
import type { AuditLog } from '../audit/audit-log.js';
import type { WriteGateConfig } from './write-gate-config.js';
import type { WriteAssessment, WriteGate } from './write-gate.js';
import { checkedWrite } from './write-check.js';
import { readSession, startSession } from './gate-session.js';
import type { RateLimit } from '../rate-limit.js';
import { answerChallenge } from '../challenge-route.js';
import { unverifiedBearerClaim } from './unverified-claim.js';

/** The status recorded for a client that went away before its answer was sent (nginx's convention). */
const CLIENT_CLOSED_REQUEST = 499;

function rejection(assessment: WriteAssessment): GateRejection | null {
  if (assessment.outcome === 'automation-detected') {
    return {
      statusCode: AUTOMATION_DETECTED_STATUS,
      error: 'Forbidden',
      code: AUTOMATION_DETECTED_CODE,
      message: 'The browser reports that it is automated; writes here have to come from a person.',
      signals: assessment.blockingSignals
    };
  }
  if (assessment.outcome === 'verification-required') {
    return {
      statusCode: HUMAN_VERIFICATION_REQUIRED_STATUS,
      error: 'Precondition Required',
      code: HUMAN_VERIFICATION_REQUIRED_CODE,
      message: `Solve the challenge at ${CHALLENGE_PATH}, hand it in at ${VERIFY_PATH}, then send the write again.`
    };
  }
  return null;
}

/**
 * The challenge a session solves before it may write, and the place its solution is handed in. The
 * library in the browser comes here when a write is answered with 428 -- and that answer started
 * the session. A challenge costs the gateway a key derivation, so it is handed out only to a
 * session the gateway started, and to each client address only so often (`challengeLimit`): a
 * person needs one, a loop would need many.
 */
export function registerChallengeRoutes(
  gateway: FastifyInstance,
  writeGate: WriteGate,
  challengeLimit: RateLimit
): void {
  gateway.get(CHALLENGE_PATH, async (request, reply) => {
    if (!readSession(request)) {
      return reply.code(400).header('cache-control', 'no-store').send({
        statusCode: 400, error: 'Bad Request', message: 'A challenge belongs to a session; a checked write starts one.'
      });
    }
    return answerChallenge(request, reply, challengeLimit, () => writeGate.createChallenge());
  });

  gateway.post<{ Body: { payload?: unknown } | undefined }>(VERIFY_PATH, async (request, reply) => {
    // A request without the session cookie has nothing a solution could be counted for
    const sessionId = readSession(request);
    const payload = request.body?.payload;
    const verified = !!sessionId && typeof payload === 'string' && await writeGate.verify(sessionId, payload);
    if (!verified) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'The challenge was not solved.' });
    }
    return true;
  });
}

/**
 * The check before a request is passed on: a write under one of the rules goes through only when
 * it comes from a person (see `WriteGate`), and every such write is written to the audit log once
 * its answer is final -- whether the application answered, failed, or the gateway rejected it, and
 * also when the client left before (499). Everything else passes untouched. The body is not read.
 */
export function writeGatePreHandler(config: WriteGateConfig, writeGate: WriteGate, audit: AuditLog) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const write = checkedWrite(config, {
      method: request.method, url: request.url, authorization: request.headers.authorization
    });
    if (!write) return undefined;

    const presented = readSession(request);
    const sessionId = presented ?? startSession(request, reply);
    const assessment = writeGate.assess({ sessionId, signalsHeader: request.headers[CLIENT_SIGNALS_HEADER] });
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      audit.record({
        sessionId: presented,
        user: config.userClaim ? unverifiedBearerClaim(request.headers.authorization, config.userClaim) : null,
        method: request.method,
        path: write.path,
        rule: write.rule,
        statusCode: reply.raw.writableFinished ? reply.raw.statusCode : CLIENT_CLOSED_REQUEST,
        outcome: assessment.outcome,
        blockingSignals: assessment.blockingSignals,
        loggedSignals: assessment.loggedSignals
      });
    };
    reply.raw.once('finish', record);
    reply.raw.once('close', record);

    const body = rejection(assessment);
    // Returning the reply ends the request here; returning nothing passes it on
    return body ? reply.code(body.statusCode).send(body) : undefined;
  };
}
