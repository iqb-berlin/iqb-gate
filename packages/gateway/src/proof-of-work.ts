import { createHmac } from 'node:crypto';
import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { HumanVerificationChallenge } from '@iqb/gate-protocol';
import { decodeAltchaPayload } from './altcha-payload.js';

/** The challenge's difficulty: about a second in a browser, measured against altcha-lib 2.6. */
const CHALLENGE_ALGORITHM = 'PBKDF2/SHA-256';
const CHALLENGE_COST = 2000;
const CHALLENGE_COUNTER_MIN = 2000;
const CHALLENGE_COUNTER_MAX = 5000;
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

/** A key for one purpose, derived from the gateway's secret. */
export function deriveSecret(secret: string, purpose: string): string {
  return createHmac('sha256', secret).update(purpose).digest('hex');
}

/**
 * ALTCHA proof-of-work challenges for one purpose -- the write gate's or the page gate's -- signed
 * with keys derived from the gateway's secret and that purpose, so that a solution counts only
 * where its challenge came from. A solved challenge counts once.
 */
export class ProofOfWork {
  private readonly hmacSignatureSecret: string;
  private readonly hmacKeySignatureSecret: string;
  /** Signatures of solved challenges, with when they expire -- a solution is accepted once. */
  private readonly usedChallenges = new Map<string, number>();

  constructor(secret: string, purpose: string) {
    this.hmacSignatureSecret = deriveSecret(secret, `${purpose}:altcha-signature`);
    this.hmacKeySignatureSecret = deriveSecret(secret, `${purpose}:altcha-key-signature`);
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
   * Whether the widget's payload holds a solution to one of these challenges that has not been used
   * before. The challenge is reserved before it is checked, so that the same solution sent several
   * times at once counts once only.
   */
  async verify(payload: string, now = Date.now()): Promise<boolean> {
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
    // A wrong answer does not use the challenge up: its signature may be forged
    if (!verified) this.usedChallenges.delete(challenge.signature);
    return verified;
  }

  /** Forgets used challenges once they have expired. */
  prune(now = Date.now()): void {
    this.usedChallenges.forEach((expiresAt, signature) => {
      if (expiresAt <= now) this.usedChallenges.delete(signature);
    });
  }
}
