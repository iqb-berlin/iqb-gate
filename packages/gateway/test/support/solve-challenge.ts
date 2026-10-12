import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { HumanVerificationChallenge } from '@iqb/gate-protocol';

/** What the ALTCHA widget hands over after solving a challenge: about a second of work. */
export async function solvedPayload(challenge: HumanVerificationChallenge): Promise<string> {
  const solution = await solveChallenge({
    challenge: challenge as Parameters<typeof solveChallenge>[0]['challenge'],
    deriveKey
  });
  return Buffer.from(JSON.stringify({
    challenge: { parameters: challenge.parameters, signature: challenge.signature },
    solution
  })).toString('base64');
}
