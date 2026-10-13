import {
  afterAll, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest';
import { OidcVerifier } from '@iqb/gate-oidc';
import { FakeProvider } from '@iqb/gate-oidc/testing';
import { AuditUserNames } from '../../src/audit/audit-user-names.js';

describe('AuditUserNames', () => {
  const provider = new FakeProvider();
  const MINUTE = 60 * 1000;
  let verifier: OidcVerifier;
  let authorization: string;

  beforeAll(async () => {
    await provider.start();
    verifier = new OidcVerifier({ issuer: provider.issuer, clientId: 'studio' });
    authorization = `Bearer ${await provider.sign()}`;
  });
  afterAll(() => provider.stop());
  beforeEach(() => vi.restoreAllMocks());

  // A script in a loop sends the same token again and again; its rejections fold into one entry
  it('checks a token once within the while, and names its person each time', async () => {
    const verify = vi.spyOn(verifier, 'verify');
    const names = new AuditUserNames(verifier, 'preferred_username', MINUTE);

    const named = await Promise.all([0, 1000, 59000].map(at => names.name(authorization, at)));

    expect(named).toEqual(Array(3).fill({ user: 'anna', userVerified: true }));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('checks the token again once the while is over', async () => {
    const verify = vi.spyOn(verifier, 'verify');
    const names = new AuditUserNames(verifier, 'preferred_username', MINUTE);

    await names.name(authorization, 0);
    await names.name(authorization, MINUTE);

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('forgets what it kept once the while is over', async () => {
    const verify = vi.spyOn(verifier, 'verify');
    const names = new AuditUserNames(verifier, 'preferred_username', MINUTE);
    await names.name(authorization, 0);

    names.prune(MINUTE);
    await names.name(authorization, 1000);

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing without a provider: an unchecked claim costs nothing', async () => {
    const names = new AuditUserNames(undefined, 'preferred_username', MINUTE);
    expect(await names.name(authorization, 0)).toEqual({ user: 'anna', userVerified: false });
    expect(await names.name(undefined, 0)).toEqual({ user: null, userVerified: false });
  });
});
