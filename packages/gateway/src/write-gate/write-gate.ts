import { createHmac } from 'node:crypto';
import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { type HumanVerificationChallenge, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';
import { SessionVerificationState } from './session-verification-state.js';
import { evaluateClientSignals } from './client-signals.js';
import { decodeAltchaPayload } from './altcha-payload.js';

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

/** The challenge's difficulty: about a second in a browser, measured against altcha-lib 2.6. */
const CHALLENGE_ALGORITHM = 'PBKDF2/SHA-256';
const CHALLENGE_COST = 2000;
const CHALLENGE_COUNTER_MIN = 2000;
const CHALLENGE_COUNTER_MAX = 5000;
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

/** How long a session that has not been seen is remembered: it would have to verify again anyway. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** A key for one purpose, derived from the gateway's secret. */
export function deriveSecret(secret: string, purpose: string): string {
  return createHmac('sha256', secret).update(purpose).digest('hex');
}

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
 * The challenge is ALTCHA's, verified with HMAC keys derived from the gateway's secret. A solved
 * challenge counts once.
 */
export class WriteGate {
  private readonly state: SessionVerificationState;
  private readonly hmacSignatureSecret: string;
  private readonly hmacKeySignatureSecret: string;
  /** Signatures of solved challenges, with when they expire -- a solution is accepted once. */
  private readonly usedChallenges = new Map<string, number>();

  constructor(secret: string, burst: { limit: number; windowSeconds: number }) {
    this.state = new SessionVerificationState(burst.limit, burst.windowSeconds * 1000);
    this.hmacSignatureSecret = deriveSecret(secret, 'altcha-signature');
    this.hmacKeySignatureSecret = deriveSecret(secret, 'altcha-key-signature');
  }

  async createChallenge(): Promise<HumanVerificationChallenge> {
    return createChallenge({
      algorithm: CHALLENGE_ALGORITHM,
      cost: CHALLENGE_COST,
      counter: randomInt(CHALLENGE_COUNTER_MIN, CHALLENGE_COUNTER_MAX),
      deriveKey,
      expiresAt: new Date(Date.now() + CHALLENGE_LIFETIME_MS),
      hmacSignatureSecret: this.hmacSignatureSecret,
      hmacKeySignatureSecret: this.hmacKeySignatureSecret
    });
  }

  /**
   * Checks the widget's payload and, if it holds a solution to one of our challenges that has not
   * been used before, marks the session as verified. The challenge is reserved before it is checked,
   * so that the same solution sent from several sessions at once counts for one of them only.
   */
  async verify(sessionId: string, payload: string, now = Date.now()): Promise<boolean> {
    const decoded = decodeAltchaPayload(payload);
    if (!decoded) return false;
    const { challenge, solution } = decoded;
    if (this.usedChallenges.has(challenge.signature)) return false;
    this.usedChallenges.set(challenge.signature, now + CHALLENGE_LIFETIME_MS);
    const verified = await verifySolution({
      challenge,
      solution,
      deriveKey,
      hmacSignatureSecret: this.hmacSignatureSecret,
      hmacKeySignatureSecret: this.hmacKeySignatureSecret
    }).then(result => result.verified, () => false);
    if (!verified) {
      // A wrong answer does not use the challenge up: its signature may be forged
      this.usedChallenges.delete(challenge.signature);
      return false;
    }
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
    this.usedChallenges.forEach((expiresAt, signature) => {
      if (expiresAt <= now) this.usedChallenges.delete(signature);
    });
  }
}
