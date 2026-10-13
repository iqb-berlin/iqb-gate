import {
  afterAll, beforeAll, describe, expect, it
} from 'vitest';
import { OidcVerifier } from '@iqb/gate-oidc';
import { nameAuditUser } from '../../src/audit/audit-user.js';
import { FakeProvider, foreignToken } from '@iqb/gate-oidc/testing';

describe('nameAuditUser', () => {
  const provider = new FakeProvider();
  let verifier: OidcVerifier;

  beforeAll(async () => {
    await provider.start();
    verifier = new OidcVerifier({ issuer: provider.issuer, clientId: 'studio' });
  });
  afterAll(() => provider.stop());

  it('names the person of a token the provider signed, as verified', async () => {
    expect(await nameAuditUser(`Bearer ${await provider.sign()}`, verifier, 'preferred_username'))
      .toEqual({ user: 'anna', userVerified: true });
  });

  // One person, one name in the log, whether the token was checked or not
  it('names a verified user by the same claim as an unverified one', async () => {
    expect(await nameAuditUser(`Bearer ${await provider.sign()}`, verifier, 'email'))
      .toEqual({ user: 'anna@example.org', userVerified: true });
    expect(await nameAuditUser(`Bearer ${await provider.sign()}`, verifier, 'no-such-claim'))
      .toEqual({ user: 'anna', userVerified: true });
  });

  it('falls back to the claim nobody checked for any other token', async () => {
    expect(await nameAuditUser(`Bearer ${await foreignToken(provider.issuer)}`, verifier, 'sub'))
      .toEqual({ user: 'mallory', userVerified: false });
  });

  it('reads only the claim without a provider, and nothing without a JWT', async () => {
    expect(await nameAuditUser(`Bearer ${await provider.sign()}`, undefined, 'preferred_username'))
      .toEqual({ user: 'anna', userVerified: false });
    expect(await nameAuditUser('Bearer sl_1_secret', verifier, 'sub')).toEqual({ user: null, userVerified: false });
    expect(await nameAuditUser(undefined, verifier, 'sub')).toEqual({ user: null, userVerified: false });
  });
});
