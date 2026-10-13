import type { HumanVerificationChallenge } from '@iqb/gate-protocol';
import { ProofOfWork } from '../proof-of-work.js';
import type { SessionVerificationState } from './session-verification-state.js';

/**
 * The ALTCHA challenge a session solves to show that a person is at work (`ProofOfWork`, for the
 * purpose `write` -- the name the challenges have carried since the write gate came first), and
 * marking the session that solved it as verified in the state the write and the read gate count in
 * (`SessionVerificationState`). A solved challenge counts once, for writes and reads alike.
 */
export class PersonVerification {
  private readonly proofOfWork: ProofOfWork;

  constructor(secret: string, private readonly sessions: SessionVerificationState) {
    this.proofOfWork = new ProofOfWork(secret, 'write');
  }

  async createChallenge(): Promise<HumanVerificationChallenge> {
    return this.proofOfWork.createChallenge();
  }

  /** Marks the session as verified when the payload holds a solution to one of the gate's challenges. */
  async verify(sessionId: string, payload: string, now = Date.now()): Promise<boolean> {
    if (!await this.proofOfWork.verify(payload, now)) return false;
    this.sessions.markVerified(sessionId, now);
    return true;
  }

  /** Forgets used challenges once they have expired. */
  prune(now = Date.now()): void {
    this.proofOfWork.prune(now);
  }
}
