import { SAVING_METHODS, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';
import type { SessionVerificationState } from '../session/session-verification-state.js';
import { evaluateClientSignals } from '../session/client-signals.js';
import type { GateAssessment, Requester } from '../session/gate-assessment.js';
import { checkedRequest, type GateScope } from '../checked-request.js';
import type { CheckedRequest } from '../path-rules.js';
import type { Gate } from '../gate-pre-handler.js';

/**
 * Decides whether a write may go through: it has to come from a person, not from an automated
 * browser or a script.
 *
 * What the browser reported about itself decides first (`evaluateClientSignals`): a browser that
 * declares itself automated, or a client that sends no report, is rejected -- what a client
 * reports is its own word, so this stops automation that does not lie. Observations a person's
 * browser can show as well -- input an extension dispatched -- ask for a fresh challenge instead,
 * which a person can solve. Then the session has to have solved a proof-of-work challenge and must
 * not have written faster than a person since (`SessionVerificationState`). Every checked write goes
 * to the audit log.
 */
export class WriteGate implements Gate {
  readonly recordsAllowed = true;

  constructor(
    private readonly scope: GateScope,
    private readonly sessions: SessionVerificationState
  ) {}

  check(request: { method: string; url: string; authorization: string | undefined }): CheckedRequest | null {
    return checkedRequest(SAVING_METHODS, this.scope, request);
  }

  /** Decides one write; counts it, if it goes through, towards the session's burst window. */
  assess(writer: Requester, now = Date.now()): GateAssessment {
    const { blocking, suspicious, logged } = evaluateClientSignals(writer.signalsHeader);
    if (blocking.length) {
      return {
        outcome: 'automation-detected', blockingSignals: blocking, loggedSignals: [...suspicious, ...logged]
      };
    }
    const { sessions } = this;
    // A freshly solved challenge answers what the suspicious observations ask
    if (suspicious.length && !sessions.isVerifiedSince(writer.sessionId, now - TRUSTED_INPUT_WINDOW_MS)) {
      sessions.revoke(writer.sessionId);
      return { outcome: 'verification-required', blockingSignals: suspicious, loggedSignals: logged };
    }
    if (!sessions.recordSave(writer.sessionId, now)) {
      return { outcome: 'verification-required', blockingSignals: [], loggedSignals: [...suspicious, ...logged] };
    }
    return { outcome: 'allowed', blockingSignals: [], loggedSignals: [...suspicious, ...logged] };
  }
}
