import type { FastifyReply, FastifyRequest } from 'fastify';
import { CLIENT_SIGNALS_HEADER } from '@iqb/gate-protocol';
import type { CheckedRequest } from './path-rules.js';
import { readSession, startSession } from './session/gate-session.js';
import { type GateAssessment, type Requester, rejectionOf } from './session/gate-assessment.js';
import { type AuditContext, recordWhenAnswered } from './audit/record-checked-request.js';

/**
 * A check that runs before a request is passed upstream: it answers the request itself and
 * returns the reply, or returns nothing and lets it pass.
 */
export type GatePreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** A gate as its pre-handler sees it: which requests it checks, and how it decides one. */
export interface Gate {
  /** The rule a request is checked under, or `null` for one the gate leaves alone. */
  check(request: { method: string; url: string; authorization: string | undefined }): CheckedRequest | null;
  assess(requester: Requester): GateAssessment;
  /**
   * Whether requests it lets through go to the audit log as well: every write does, a read only
   * when it is refused -- a person reads hundreds of times an hour, and the log is there for what
   * was kept out.
   */
  recordsAllowed: boolean;
}

/**
 * The check before a request is passed on: a request the gate checks goes through only when the
 * gate's assessment allows it, and is written to the audit log once its answer is final
 * (`recordWhenAnswered`). A request without the gateway's session gets one, so that a challenge
 * can be counted for it. Everything else passes untouched. The body is not read.
 */
export function gatePreHandler(gate: Gate, context: AuditContext): GatePreHandler {
  return async (request, reply) => {
    const checked = gate.check({
      method: request.method, url: request.url, authorization: request.headers.authorization
    });
    if (!checked) return undefined;

    const presentedSession = readSession(request);
    const sessionId = presentedSession ?? startSession(request, reply);
    const assessment = gate.assess({ sessionId, signalsHeader: request.headers[CLIENT_SIGNALS_HEADER] });
    const body = rejectionOf(assessment);
    if (body || gate.recordsAllowed) {
      recordWhenAnswered(request, reply, { ...checked, presentedSession, assessment }, context);
    }
    // Returning the reply ends the request here; returning nothing passes it on
    return body ? reply.code(body.statusCode).send(body) : undefined;
  };
}

/** The checks one after the other, until one of them answers. */
export function inTurn(checks: GatePreHandler[]): GatePreHandler {
  return (request, reply) => checks.reduce<Promise<FastifyReply | undefined>>(
    async (earlier, check) => (await earlier) ?? check(request, reply),
    Promise.resolve(undefined)
  );
}
