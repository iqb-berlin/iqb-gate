import { type HumanVerificationChallenge, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';
import { ProofOfWork } from '../proof-of-work.js';
import { SessionVerificationState } from './session-verification-state.js';
import { evaluateClientSignals } from './client-signals.js';

/** How a checked write was decided. */
export type WriteOutcome = 'allowed' | 'automation-detected' | 'verification-required';

/** How a write is decided, and on which observations. */
export interface WriteAssessment {
  outcome: WriteOutcome;
  blockingSignals: string[];
  loggedSignals: string[];
}

/** Who writes -- the session of the gateway's cookie -- and what their browser reported. */
export interface Writer {
  sessionId: string;
  signalsHeader: string | string[] | undefined;
}

/** How long a session that has not been seen is remembered: it would have to verify again anyway. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decides whether a write may go through: it has to come from a person, not from an automated
 * browser or a script.
 *
 * What the browser reported about itself decides first (`evaluateClientSignals`): a browser that
 * declares itself automated, or a client that sends no report, is rejected -- what a client
 * reports is its own word, so this stops automation that does not lie. Observations a person's
 * browser can show as well -- input an extension dispatched -- ask for a fresh challenge instead,
 * which a person can solve. Then the session has to have solved a proof-of-work challenge and must
 * not have written faster than a person since (`SessionVerificationState`).
 *
 * The challenge is ALTCHA's (`ProofOfWork`, for the purpose `write`). A solved challenge counts once.
 */
export class WriteGate {
  private readonly state: SessionVerificationState;
  private readonly proofOfWork: ProofOfWork;

  constructor(secret: string, burst: { limit: number; windowSeconds: number }) {
    this.state = new SessionVerificationState(burst.limit, burst.windowSeconds * 1000);
    this.proofOfWork = new ProofOfWork(secret, 'write');
  }

  async createChallenge(): Promise<HumanVerificationChallenge> {
    return this.proofOfWork.createChallenge();
  }

  /** Marks the session as verified when the payload holds a solution to one of the gate's challenges. */
  async verify(sessionId: string, payload: string, now = Date.now()): Promise<boolean> {
    if (!await this.proofOfWork.verify(payload, now)) return false;
    this.state.markVerified(sessionId, now);
    return true;
  }

  /** Decides one write; counts it, if it goes through, towards the session's burst window. */
  assess(writer: Writer, now = Date.now()): WriteAssessment {
    const { blocking, suspicious, logged } = evaluateClientSignals(writer.signalsHeader);
    if (blocking.length) {
      return {
        outcome: 'automation-detected', blockingSignals: blocking, loggedSignals: [...suspicious, ...logged]
      };
    }
    // A freshly solved challenge answers what the suspicious observations ask
    if (suspicious.length && !this.state.isVerifiedSince(writer.sessionId, now - TRUSTED_INPUT_WINDOW_MS)) {
      this.state.revoke(writer.sessionId);
      return { outcome: 'verification-required', blockingSignals: suspicious, loggedSignals: logged };
    }
    if (!this.state.recordSave(writer.sessionId, now)) {
      return { outcome: 'verification-required', blockingSignals: [], loggedSignals: [...suspicious, ...logged] };
    }
    return { outcome: 'allowed', blockingSignals: [], loggedSignals: [...suspicious, ...logged] };
  }

  /** Forgets sessions not seen for {@link SESSION_IDLE_MS} and expired used challenges. */
  prune(now = Date.now()): void {
    this.state.prune(now, SESSION_IDLE_MS);
    this.proofOfWork.prune(now);
  }
}
