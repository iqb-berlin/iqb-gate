import type { FastifyReply, FastifyRequest } from 'fastify';
import { CLIENT_SIGNALS_HEADER, GATE_REFUSAL_HEADER } from '@iqb/gate-protocol';
import type { CheckedRequest } from './path-rules.js';
import type { CheckTarget } from './check-target.js';
import { readSession, startSession } from './session/gate-session.js';
import { type GateAssessment, type Requester, rejectionOf } from './session/gate-assessment.js';
import { type AuditContext, recordWhenAnswered } from './audit/record-checked-request.js';

/**
 * A check that runs before a request is passed on -- by the proxy, or by Traefik once the gateway
 * answered its ForwardAuth: it answers the request itself and returns `true`, or returns `false` and
 * lets it pass. It decides on `target`, the request it is asked about. Not the reply: a Fastify reply
 * is thenable, so a promise of it settles only once the answer is sent -- and then as `undefined`.
 */
export type GatePreHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  target: CheckTarget
) => Promise<boolean>;

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
  return async (request, reply, target) => {
    const checked = gate.check({
      method: target.method, url: target.url, authorization: request.headers.authorization
    });
    if (!checked) return false;

    const presentedSession = readSession(request);
    const sessionId = presentedSession ?? startSession(reply, target.protocol === 'https');
    const assessment = gate.assess({ sessionId, signalsHeader: request.headers[CLIENT_SIGNALS_HEADER] });
    const body = rejectionOf(assessment);
    if (body || gate.recordsAllowed) {
      recordWhenAnswered(request, reply, { ...checked, presentedSession, assessment }, context);
    }
    if (!body) return false;
    // The header for a browser that cannot read the body: a HEAD request, a download
    reply.code(body.statusCode).header(GATE_REFUSAL_HEADER, body.code).send(body);
    return true;
  };
}

/** The checks one after the other, until one of them answers. */
export function inTurn(checks: GatePreHandler[]): GatePreHandler {
  return (request, reply, target) => checks.reduce<Promise<boolean>>(
    async (earlier, check) => (await earlier) || check(request, reply, target),
    Promise.resolve(false)
  );
}
