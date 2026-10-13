import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditLog } from './audit-log.js';
import type { AuditUserNames } from './audit-user-names.js';
import type { CheckedRequest } from '../path-rules.js';
import type { GateAssessment } from '../session/gate-assessment.js';

/** The status recorded for a client that went away before its answer was sent (nginx's convention). */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The audit entries still waiting for their person to be named -- the gateway closes the log only
 * once they are written.
 */
export type PendingEntries = Set<Promise<void>>;

/** Where a gate's entries go, and how their person is named. */
export interface AuditContext {
  audit: AuditLog;
  names: AuditUserNames;
  pending: PendingEntries;
}

/**
 * Writes the audit entry of a checked request once its answer is final -- whether the application
 * answered, failed, or the gateway rejected it, and also when the client left before (499). The
 * person is named from the token alongside the request, so that the request does not wait for the
 * provider's keys; the entry keeps the time the answer was final.
 */
export function recordWhenAnswered(
  request: FastifyRequest,
  reply: FastifyReply,
  checked: CheckedRequest & { presentedSession: string | null; assessment: GateAssessment },
  context: AuditContext
): void {
  const named = context.names.name(request.headers.authorization);
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const now = Date.now();
    const statusCode = reply.raw.writableFinished ? reply.raw.statusCode : CLIENT_CLOSED_REQUEST;
    const entry = named.then(({ user, userVerified }) => context.audit.record({
      sessionId: checked.presentedSession,
      user,
      userVerified,
      method: request.method,
      path: checked.path,
      rule: checked.rule,
      statusCode,
      outcome: checked.assessment.outcome,
      blockingSignals: checked.assessment.blockingSignals,
      loggedSignals: checked.assessment.loggedSignals
    }, now), error => request.log.error({ err: error }, 'naming the person for the audit log failed'));
    context.pending.add(entry);
    entry.finally(() => context.pending.delete(entry));
  };
  reply.raw.once('finish', record);
  reply.raw.once('close', record);
}
