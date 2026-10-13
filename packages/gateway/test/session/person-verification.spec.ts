import {
  beforeAll, describe, expect, it
} from 'vitest';
import { PersonVerification } from '../../src/session/person-verification.js';
import { SessionVerificationState } from '../../src/session/session-verification-state.js';
import { solvedPayload } from '../support/solve-challenge.js';

describe('PersonVerification', () => {
  const sessions = new SessionVerificationState({ limit: 30, windowMs: 60_000 }, { limit: 600, windowMs: 60_000 });
  const gateWith = (options: { secret?: string } = {}): PersonVerification => new PersonVerification(
    options.secret ?? 'test-secret-test-secret-test-secret',
    sessions
  );

  describe('challenge and solution', () => {
    let service: PersonVerification;
    let payload: string;

    // Solving takes about a second; one solution serves the tests that need it
    beforeAll(async () => {
      service = gateWith();
      payload = await solvedPayload(await service.createChallenge());
    }, 30_000);

    it('should hand out a signed challenge', async () => {
      const challenge = await service.createChallenge();
      expect(challenge.signature).toEqual(expect.any(String));
      expect(challenge.parameters).toEqual(expect.objectContaining({ algorithm: 'PBKDF2/SHA-256' }));
    });

    it('should verify a session with a solved challenge, for its saves and its reads', async () => {
      expect(await service.verify('sid-solved', payload)).toBe(true);
      expect(sessions.recordSave('sid-solved', Date.now())).toBe(true);
      expect(sessions.recordRead('sid-solved', Date.now())).toBe(true);
    });

    it('should accept a solution only once', async () => {
      expect(await service.verify('sid-second', payload)).toBe(false);
    });

    it('should not accept a challenge signed with another secret', async () => {
      const other = gateWith({ secret: 'other-secret-other-secret-other-secret' });
      expect(await other.verify('sid', payload)).toBe(false);
    });

    it('should reject what is not a payload of the widget', async () => {
      expect(await service.verify('sid', 'not base64 json')).toBe(false);
      expect(await service.verify('sid', '')).toBe(false);
      // The widget's test mode hands over no challenge at all
      const testMode = Buffer.from(JSON.stringify({ challenge: null, solution: null, test: true })).toString('base64');
      expect(await service.verify('sid', testMode)).toBe(false);
    });

    // The same solution sent from several sessions at once must count for one of them only
    it('should accept a solution for one session when it is sent for several at once', async () => {
      const shared = await solvedPayload(await service.createChallenge());

      const results = await Promise.all(['sid-a', 'sid-b', 'sid-c'].map(sid => service.verify(sid, shared)));

      expect(results.filter(verified => verified)).toHaveLength(1);
    }, 30_000);

    it('should reject a wrong solution', async () => {
      const solved = await solvedPayload(await service.createChallenge());
      const decoded = JSON.parse(Buffer.from(solved, 'base64').toString());
      // The server checks the derived key against the signature it put into the challenge
      decoded.solution.derivedKey = '00'.repeat(decoded.solution.derivedKey.length / 2);
      const wrong = Buffer.from(JSON.stringify(decoded)).toString('base64');
      expect(await service.verify('sid', wrong)).toBe(false);
    }, 30_000);
  });

});
