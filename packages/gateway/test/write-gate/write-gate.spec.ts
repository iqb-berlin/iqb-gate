import { describe, expect, it } from 'vitest';
import type { ClientSignals } from '@iqb/gate-protocol';
import { WriteGate } from '../../src/write-gate/write-gate.js';
import { SessionVerificationState } from '../../src/session/session-verification-state.js';

describe('WriteGate', () => {
  const SCOPE = { enforce: true, rules: [{ name: 'other', path: /^\/api\//i }], exempt: [] };
  const sessionsWith = (burst = { limit: 30, windowMs: 60_000 }): SessionVerificationState => (
    new SessionVerificationState(burst, { limit: 600, windowMs: 60_000 })
  );
  const gateWith = (sessions = sessionsWith()): WriteGate => new WriteGate(SCOPE, sessions);

  const person: ClientSignals = {
    webdriver: false,
    headless: false,
    untrustedInput: false,
    msSinceTrustedInput: 500,
    softwareRenderer: false,
    devtoolsProtocol: false
  };
  const signals = (changes: Partial<ClientSignals> = {}): string => JSON.stringify({ ...person, ...changes });

  it('should check writes under its rules, and write every one of them to the audit log', () => {
    const gate = gateWith();
    const request = (method: string) => ({ method, url: '/api/x', authorization: undefined });
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(method => gate.check(request(method))?.rule))
      .toEqual(['other', 'other', 'other', 'other']);
    expect(gate.check(request('GET'))).toBeNull();
    expect(gate.recordsAllowed).toBe(true);
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
      const sessions = sessionsWith({ limit: 2, windowMs: 60_000 });
      const service = gateWith(sessions);
      // Marking the session stands in for a solved challenge, which takes a second to compute
      sessions.markVerified('sid', 0);
      const save = (now: number) => service.assess({ sessionId: 'sid', signalsHeader: signals() }, now);

      expect((save(1)).outcome).toBe('allowed');
      expect((save(2)).outcome).toBe('allowed');
      expect((save(3)).outcome).toBe('verification-required');
      expect((save(4)).outcome).toBe('verification-required');
    });
  });

  describe('observations a person can show as well', () => {
    const gateVerifiedAt = (sid: string, now: number): WriteGate => {
      const sessions = sessionsWith();
      sessions.markVerified(sid, now);
      return gateWith(sessions);
    };

    // A password manager or writing aid dispatches key events; the person gets the challenge, not a 403
    it('should ask for a fresh challenge, even from a verified session', async () => {
      const service = gateVerifiedAt('sid', 0);

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
      const service = gateVerifiedAt('sid', 100_000);

      const assessment = service.assess(
        { sessionId: 'sid', signalsHeader: signals({ untrustedInput: true }) },
        130_000
      );

      expect(assessment).toEqual({ outcome: 'allowed', blockingSignals: [], loggedSignals: ['untrusted-input'] });
    });

    // Uploads that run one after another: the file was picked minutes before the last of them
    it('should keep a verified session verified when its last input was long ago', async () => {
      const service = gateVerifiedAt('sid', 0);
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
