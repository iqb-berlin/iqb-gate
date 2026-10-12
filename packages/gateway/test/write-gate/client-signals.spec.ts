import { describe, expect, it } from 'vitest';
import { type ClientSignals, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';
import { evaluateClientSignals } from '../../src/write-gate/client-signals.js';

describe('evaluateClientSignals', () => {
  // What a person's browser reports: nothing automated, a click a moment ago
  const person: ClientSignals = {
    webdriver: false,
    headless: false,
    untrustedInput: false,
    msSinceTrustedInput: 800,
    softwareRenderer: false,
    devtoolsProtocol: false
  };
  const header = (signals: Partial<ClientSignals>): string => JSON.stringify({ ...person, ...signals });

  it('should let a person through without any observation', () => {
    expect(evaluateClientSignals(header({}))).toEqual({ blocking: [], suspicious: [], logged: [] });
  });

  // A script calling the API, like eatPrepTBA, sends no report at all
  it('should reject a request without the report', () => {
    expect(evaluateClientSignals(undefined)).toEqual({ blocking: ['signals-missing'], suspicious: [], logged: [] });
    expect(evaluateClientSignals('')).toEqual({ blocking: ['signals-missing'], suspicious: [], logged: [] });
  });

  it('should reject a report that is not what the frontend sends', () => {
    expect(evaluateClientSignals('not json').blocking).toEqual(['signals-missing']);
    expect(evaluateClientSignals('42').blocking).toEqual(['signals-missing']);
  });

  it('should read the first value of a repeated header', () => {
    expect(evaluateClientSignals([header({}), 'other']).blocking).toEqual([]);
  });

  it.each([
    ['webdriver', { webdriver: true }],
    ['headless', { headless: true }]
  ])('should reject %s', (signal, signals) => {
    expect(evaluateClientSignals(header(signals)).blocking).toEqual([signal]);
  });

  // Password managers and writing aids dispatch key events too: a person must have a way through
  it('should only call script-dispatched input suspicious', () => {
    const verdict = evaluateClientSignals(header({ untrustedInput: true }));
    expect(verdict.blocking).toEqual([]);
    expect(verdict.suspicious).toEqual(['untrusted-input']);
  });

  // Uploads that run one after another take longer than the window after the file was picked
  it('should only record a save without trusted input, or with input too long ago', () => {
    expect(evaluateClientSignals(header({ msSinceTrustedInput: null })))
      .toEqual({ blocking: [], suspicious: [], logged: ['no-recent-input'] });
    expect(evaluateClientSignals(header({ msSinceTrustedInput: TRUSTED_INPUT_WINDOW_MS + 1 })).logged)
      .toEqual(['no-recent-input']);
    expect(evaluateClientSignals(header({ msSinceTrustedInput: -5 })).logged).toEqual(['no-recent-input']);
  });

  it('should accept input right at the end of the window', () => {
    expect(evaluateClientSignals(header({ msSinceTrustedInput: TRUSTED_INPUT_WINDOW_MS })).logged).toEqual([]);
  });

  // Remote desktops render in software, and a developer may have DevTools open
  it('should only record a software renderer and the DevTools protocol', () => {
    expect(evaluateClientSignals(header({ softwareRenderer: true, devtoolsProtocol: true })))
      .toEqual({ blocking: [], suspicious: [], logged: ['software-renderer', 'devtools-protocol'] });
  });

  it('should name every observation at once', () => {
    const verdict = evaluateClientSignals(header({
      webdriver: true, headless: true, untrustedInput: true, msSinceTrustedInput: null
    }));
    expect(verdict.blocking).toEqual(['webdriver', 'headless']);
    expect(verdict.suspicious).toEqual(['untrusted-input']);
    expect(verdict.logged).toEqual(['no-recent-input']);
  });
});
