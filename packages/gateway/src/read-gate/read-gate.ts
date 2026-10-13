import { READING_METHODS } from '@iqb/gate-protocol';
import type { SessionVerificationState } from '../session/session-verification-state.js';
import { evaluateClientSignals } from '../session/client-signals.js';
import type { GateAssessment, Requester } from '../session/gate-assessment.js';
import { checkedRequest, type GateScope } from '../checked-request.js';
import type { CheckedRequest } from '../path-rules.js';
import type { Gate } from '../gate-pre-handler.js';

/**
 * Observations that say something about a write but nothing about a read: nobody types while they
 * read, and a page loads what it shows without input.
 */
const MEANINGLESS_FOR_READS = ['no-recent-input', 'untrusted-input'];

/**
 * Decides whether a read may go through: it has to come from a person's browser, not from a script
 * or an automated browser -- an agent that was handed a token should not be able to read the data.
 *
 * What the browser reported about itself decides first, as for writes: a browser that declares
 * itself automated, or a client that sends no report, is rejected. Input dispatched by a script is
 * no reason to ask a reader for a challenge. Then the session has to have solved a challenge --
 * the one of its login counts -- and must not read faster than a person since; past the read limit
 * it is asked again, for its reads and its writes (`SessionVerificationState`). No proof of work per
 * read: a person solves one challenge per session, not one per page. Only refused reads go to the
 * audit log.
 */
export class ReadGate implements Gate {
  readonly recordsAllowed = false;

  constructor(
    private readonly scope: GateScope,
    private readonly sessions: SessionVerificationState
  ) {}

  check(request: { method: string; url: string; authorization: string | undefined }): CheckedRequest | null {
    return checkedRequest(READING_METHODS, this.scope, request);
  }

  /** Decides one read; counts it, if it goes through, towards the session's read window. */
  assess(reader: Requester, now = Date.now()): GateAssessment {
    const { blocking, suspicious, logged } = evaluateClientSignals(reader.signalsHeader);
    const loggedSignals = [...suspicious, ...logged].filter(signal => !MEANINGLESS_FOR_READS.includes(signal));
    if (blocking.length) return { outcome: 'automation-detected', blockingSignals: blocking, loggedSignals };
    if (!this.sessions.recordRead(reader.sessionId, now)) {
      return { outcome: 'verification-required', blockingSignals: [], loggedSignals };
    }
    return { outcome: 'allowed', blockingSignals: [], loggedSignals };
  }
}
