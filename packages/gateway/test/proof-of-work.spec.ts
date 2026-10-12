import { beforeAll, describe, expect, it } from 'vitest';
import { ProofOfWork } from '../src/proof-of-work.js';
import { solvedPayload } from './support/solve-challenge.js';

const SECRET = 'test-secret-test-secret-test-secret';


describe('ProofOfWork', () => {
  const writes = new ProofOfWork(SECRET, 'write');
  let payload: string;

  // Solving takes about a second; one solution serves the tests that need it
  beforeAll(async () => {
    payload = await solvedPayload(await writes.createChallenge());
  }, 30_000);

  it('accepts no solution of a challenge for another purpose', async () => {
    expect(await new ProofOfWork(SECRET, 'page').verify(payload)).toBe(false);
  });

  it('accepts a solution of its own challenge once', async () => {
    expect(await writes.verify(payload)).toBe(true);
    expect(await writes.verify(payload)).toBe(false);
  });

  it('forgets used challenges once they have expired', () => {
    const proofOfWork = new ProofOfWork(SECRET, 'write');
    const used = (proofOfWork as unknown as { usedChallenges: Map<string, number> }).usedChallenges;
    used.set('old', 1_000);
    used.set('fresh', 500_000);

    proofOfWork.prune(100_000);

    expect([...used.keys()]).toEqual(['fresh']);
  });
});
