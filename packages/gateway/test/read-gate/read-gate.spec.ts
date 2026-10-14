import { describe, expect, it } from 'vitest';
import type { ClientSignals } from '@iqb/gate-protocol';
import { ReadGate } from '../../src/read-gate/read-gate.js';
import { SessionVerificationState } from '../../src/session/session-verification-state.js';

describe('ReadGate', () => {
  const person: ClientSignals = {
    webdriver: false,
    headless: false,
    untrustedInput: false,
    msSinceTrustedInput: null,
    softwareRenderer: false,
    devtoolsProtocol: false
  };
  const signals = (changes: Partial<ClientSignals> = {}): string => JSON.stringify({ ...person, ...changes });

  const SCOPE = { enforce: true, rules: [{ name: 'other', path: /^\/api\//i }], exempt: [] };
  const sessionsWith = (readLimit = 600): SessionVerificationState => new SessionVerificationState(
    { limit: 30, windowMs: 60_000 },
    { limit: readLimit, windowMs: 60_000 }
  );
  const gateWith = (sessions = sessionsWith()): ReadGate => new ReadGate(SCOPE, sessions);

  it('should check reads under its rules, and write only those it refuses to the audit log', () => {
    const gate = gateWith();
    const request = (method: string) => ({ method, url: '/api/x', authorization: undefined });
    expect(gate.check(request('GET'))).toEqual({ rule: 'other', method: 'GET', path: '/api/x' });
    expect(gate.check(request('HEAD'))?.rule).toBe('other');
    expect(gate.check(request('POST'))).toBeNull();
    expect(gate.recordsAllowed).toBe(false);
  });

  it('should reject a browser that reports automation, naming why', () => {
    const assessment = gateWith().assess({
      sessionId: 'sid', signalsHeader: signals({ headless: true, devtoolsProtocol: true })
    });
    expect(assessment).toEqual({
      outcome: 'automation-detected', blockingSignals: ['headless'], loggedSignals: ['devtools-protocol']
    });
  });

  it('should reject a client that sends no report, as a script does', () => {
    const assessment = gateWith().assess({ sessionId: 'sid', signalsHeader: undefined });
    expect(assessment).toEqual({
      outcome: 'automation-detected', blockingSignals: ['signals-missing'], loggedSignals: []
    });
  });

  it('should ask a session that solved no challenge for one', () => {
    const assessment = gateWith().assess({ sessionId: 'sid', signalsHeader: signals() });
    expect(assessment).toEqual({ outcome: 'verification-required', blockingSignals: [], loggedSignals: [] });
  });

  // Nobody types while reading: neither old input nor script-dispatched input is held against a reader
  it('should let a verified session read without recent input, and without recording that', () => {
    const sessions = sessionsWith();
    sessions.markVerified('sid', 0);

    const assessment = gateWith(sessions).assess(
      { sessionId: 'sid', signalsHeader: signals({ untrustedInput: true }) },
      1_000
    );

    expect(assessment).toEqual({ outcome: 'allowed', blockingSignals: [], loggedSignals: [] });
  });

  it('should ask again past the read limit, for the session\'s writes as well', () => {
    const sessions = sessionsWith(2);
    sessions.markVerified('sid', 0);
    const gate = gateWith(sessions);
    const read = (now: number) => gate.assess({ sessionId: 'sid', signalsHeader: signals() }, now).outcome;

    expect([read(1), read(2), read(3)]).toEqual(['allowed', 'allowed', 'verification-required']);
    expect(sessions.recordSave('sid', 4)).toBe(false);
  });
});
