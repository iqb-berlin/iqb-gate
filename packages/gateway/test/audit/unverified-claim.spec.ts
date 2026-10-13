import { describe, expect, it } from 'vitest';
import { unverifiedBearerClaim } from '../../src/audit/unverified-claim.js';

const jwt = (payload: object) => [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'signature'
].join('.');

describe('unverifiedBearerClaim', () => {
  it('reads a claim of the Bearer JWT', () => {
    expect(unverifiedBearerClaim(`Bearer ${jwt({ username: 'anna', sub: 7 })}`, 'username')).toBe('anna');
    expect(unverifiedBearerClaim(`Bearer ${jwt({ username: 'anna', sub: 7 })}`, 'sub')).toBe('7');
  });

  it('gives nothing without a JWT or the claim', () => {
    expect(unverifiedBearerClaim(undefined, 'sub')).toBeNull();
    expect(unverifiedBearerClaim('Bearer sl_1_secret', 'sub')).toBeNull();
    expect(unverifiedBearerClaim(`Basic ${jwt({ sub: 1 })}`, 'sub')).toBeNull();
    expect(unverifiedBearerClaim(`Bearer ${jwt({ sub: 1 })}`, 'username')).toBeNull();
    expect(unverifiedBearerClaim(`Bearer ${jwt({ sub: { nested: 1 } })}`, 'sub')).toBeNull();
    expect(unverifiedBearerClaim('Bearer a.!!!.c', 'sub')).toBeNull();
    expect(unverifiedBearerClaim(`Bearer a.${Buffer.from('not json').toString('base64url')}.c`, 'sub')).toBeNull();
  });

  it('cuts a long claim', () => {
    expect(unverifiedBearerClaim(`Bearer ${jwt({ sub: 'x'.repeat(500) })}`, 'sub')).toHaveLength(200);
  });
});
