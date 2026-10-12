import {
  beforeAll, describe, expect, it
} from 'vitest';
import type { ClientSignals } from '@iqb/gate-protocol';
import { WriteGate } from '../../src/write-gate/write-gate.js';
import { solvedPayload } from '../support/solve-challenge.js';

describe('WriteGate', () => {
  const gateWith = (
    options: { secret?: string; burst?: { limit: number; windowSeconds: number } } = {}
  ): WriteGate => new WriteGate(
    options.secret ?? 'test-secret-test-secret-test-secret',
    options.burst ?? { limit: 30, windowSeconds: 60 }
  );


  const person: ClientSignals = {
    webdriver: false,
    headless: false,
    untrustedInput: false,
    msSinceTrustedInput: 500,
    softwareRenderer: false,
    devtoolsProtocol: false
  };
  const signals = (changes: Partial<ClientSignals> = {}): string => JSON.stringify({ ...person, ...changes });

  describe('challenge and solution', () => {
    let service: WriteGate;
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

    it('should verify a session with a solved challenge, and let it write', async () => {
      expect(await service.verify('sid-solved', payload)).toBe(true);
      expect((service.assess({ sessionId: 'sid-solved', signalsHeader: signals() })).outcome)
        .toBe('allowed');
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

  describe('assess', () => {
    it('should ask a session that solved no challenge for one', () => {
      const assessment = gateWith().assess({ sessionId: 'sid', signalsHeader: signals() });
      expect(assessment).toEqual({ outcome: 'verification-required', blockingSignals: [], loggedSignals: [] });
    });

    it('should reject a browser that reports automation, naming why', () => {
      const assessment = gateWith().assess({
        sessionId: 'sid', signalsHeader: signals({ webdriver: true, softwareRenderer: true })
      });
      expect(assessment).toEqual({
        outcome: 'automation-detected',
        blockingSignals: ['webdriver'],
        loggedSignals: ['software-renderer']
      });
    });

    it('should reject a client that sends no report', () => {
      const assessment = gateWith().assess({ sessionId: 'sid', signalsHeader: undefined });
      expect(assessment.outcome).toBe('automation-detected');
      expect(assessment.blockingSignals).toEqual(['signals-missing']);
    });

    it('should take the verification back after a burst of writes', async () => {
      const service = gateWith({ burst: { limit: 2, windowSeconds: 60 } });
      // Reaching into the state stands in for a solved challenge, which takes a second to compute
      (service as unknown as { state: { markVerified(sid: string, now: number): void } })
        .state.markVerified('sid', 0);
      const save = (now: number) => service.assess({ sessionId: 'sid', signalsHeader: signals() }, now);

      expect((save(1)).outcome).toBe('allowed');
      expect((save(2)).outcome).toBe('allowed');
      expect((save(3)).outcome).toBe('verification-required');
      expect((save(4)).outcome).toBe('verification-required');
    });
  });

  describe('observations a person can show as well', () => {
    const verifiedAt = (service: WriteGate, sid: string, now: number): void => {
      (service as unknown as { state: { markVerified(sid: string, now: number): void } })
        .state.markVerified(sid, now);
    };

    // A password manager or writing aid dispatches key events; the person gets the challenge, not a 403
    it('should ask for a fresh challenge, even from a verified session', async () => {
      const service = gateWith();
      verifiedAt(service, 'sid', 0);

      const assessment = service.assess(
        { sessionId: 'sid', signalsHeader: signals({ untrustedInput: true }) },
        120_000
      );

      expect(assessment).toEqual({
        outcome: 'verification-required', blockingSignals: ['untrusted-input'], loggedSignals: []
      });
      expect((service.assess({ sessionId: 'sid', signalsHeader: signals() }, 121_000)).outcome)
        .toBe('verification-required');
    });

    it('should let the write through right after the challenge is solved', async () => {
      const service = gateWith();
      verifiedAt(service, 'sid', 100_000);

      const assessment = service.assess(
        { sessionId: 'sid', signalsHeader: signals({ untrustedInput: true }) },
        130_000
      );

      expect(assessment).toEqual({ outcome: 'allowed', blockingSignals: [], loggedSignals: ['untrusted-input'] });
    });

    // Uploads that run one after another: the file was picked minutes before the last of them
    it('should keep a verified session verified when its last input was long ago', async () => {
      const service = gateWith();
      verifiedAt(service, 'sid', 0);
      const longAfterInput = signals({ msSinceTrustedInput: 300_000 });

      expect(service.assess({ sessionId: 'sid', signalsHeader: longAfterInput }, 300_000))
        .toEqual({ outcome: 'allowed', blockingSignals: [], loggedSignals: ['no-recent-input'] });
      expect(service.assess({ sessionId: 'sid', signalsHeader: longAfterInput }, 301_000).outcome)
        .toBe('allowed');
    });

    it('should still ask a session that never solved a challenge, whatever its input', async () => {
      const assessment = gateWith().assess(
        { sessionId: 'sid', signalsHeader: signals({ msSinceTrustedInput: null }) },
        1_000
      );

      expect(assessment).toEqual({
        outcome: 'verification-required', blockingSignals: [], loggedSignals: ['no-recent-input']
      });
    });
  });

});
