import { describe, expect, it } from 'vitest';
import { decodeAltchaPayload } from '../../src/write-gate/altcha-payload.js';

describe('decodeAltchaPayload', () => {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64');
  const challenge = { parameters: { algorithm: 'PBKDF2/SHA-256', nonce: 'n' }, signature: 'sig' };
  const solution = { counter: 3, derivedKey: '00ab' };

  it('should read what the widget hands over', () => {
    expect(decodeAltchaPayload(encode({ challenge, solution }))).toEqual({ challenge, solution });
  });

  it('should refuse the test mode of the widget, which has no challenge', () => {
    expect(decodeAltchaPayload(encode({ challenge: null, solution: null, test: true }))).toBeNull();
  });

  it('should refuse a challenge without signature or a missing solution', () => {
    expect(decodeAltchaPayload(encode({ challenge: { parameters: {} }, solution }))).toBeNull();
    expect(decodeAltchaPayload(encode({ challenge }))).toBeNull();
  });

  it('should refuse what is not base64 JSON', () => {
    expect(decodeAltchaPayload('not base64 json')).toBeNull();
    expect(decodeAltchaPayload('')).toBeNull();
    expect(decodeAltchaPayload(encode('a string'))).toBeNull();
  });
});
