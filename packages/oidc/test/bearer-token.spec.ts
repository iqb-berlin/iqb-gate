import { describe, expect, it } from 'vitest';
import { bearerToken } from '../src/bearer-token.js';

describe('bearerToken', () => {
  it('takes the token of a Bearer header, whatever the case of the scheme', () => {
    expect(bearerToken('Bearer sl_1_x')).toBe('sl_1_x');
    expect(bearerToken('bearer eyJ.a.b')).toBe('eyJ.a.b');
  });

  it('takes nothing from another scheme, a header without a token, or none', () => {
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('takes the first of a header sent twice', () => {
    expect(bearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });
});
