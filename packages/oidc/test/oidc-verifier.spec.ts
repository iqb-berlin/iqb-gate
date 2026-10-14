import {
  afterAll, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest';
import { SignJWT, UnsecuredJWT } from 'jose';
import { OidcVerifier } from '../src/oidc-verifier.js';
import { FakeProvider, foreignToken } from '../src/testing/fake-provider.js';

describe('OidcVerifier', () => {
  const provider = new FakeProvider();
  let onRejected: ReturnType<typeof vi.fn<(reason: string, error?: unknown) => void>>;
  let onUnavailable: ReturnType<typeof vi.fn<(reason: string, error?: unknown) => void>>;

  const verifier = (options: Partial<ConstructorParameters<typeof OidcVerifier>[0]> = {}) => new OidcVerifier({
    issuer: provider.issuer, clientId: 'studio', onRejected, onUnavailable, ...options
  });

  beforeAll(() => provider.start());
  afterAll(() => provider.stop());
  beforeEach(() => {
    onRejected = vi.fn<(reason: string, error?: unknown) => void>();
    onUnavailable = vi.fn<(reason: string, error?: unknown) => void>();
  });

  it('names the person of a token that holds, finding the keys through discovery', async () => {
    const identity = await verifier().verify(await provider.sign({
      given_name: 'Anna', family_name: 'Arendt',
      realm_access: { roles: ['admin'] }, resource_access: { studio: { roles: ['editor'] }, other: { roles: ['x'] } }
    }));
    expect(identity).toEqual({
      issuer: provider.issuer,
      subject: 'f3b1c0de-anna',
      username: 'anna',
      email: 'anna@example.org',
      givenName: 'Anna',
      familyName: 'Arendt',
      roles: ['admin', 'editor'],
      claims: expect.objectContaining({ sub: 'f3b1c0de-anna', azp: 'studio' })
    });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('falls back to the e-mail address, then the subject, for a name', async () => {
    const byMail = await verifier().verify(await provider.sign({ preferred_username: undefined }));
    expect(byMail?.username).toBe('anna@example.org');
    const bySubject = await verifier().verify(await provider.sign({ preferred_username: undefined, email: undefined }));
    expect(bySubject?.username).toBe('f3b1c0de-anna');
  });

  it('refuses a token of another issuer', async () => {
    expect(await verifier().verify(await provider.sign({ iss: 'https://evil.example.org/realms/iqb' }))).toBeNull();
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('issuer'), expect.anything());
  });

  // coding-box took the issuer with or without the slash at its end
  it('takes the issuer with or without a slash at its end', async () => {
    expect(await verifier({ issuer: `${provider.issuer}/` }).verify(await provider.sign())).not.toBeNull();
    expect(await verifier().verify(await provider.sign({ iss: `${provider.issuer}/` }))).not.toBeNull();
  });

  // Keycloak's ID tokens are for the client as well, but no key to an API
  it('refuses a token that says it is no access token', async () => {
    expect(await verifier().verify(await provider.sign({ typ: 'ID', aud: 'studio' }))).toBeNull();
    expect(await verifier().verify(await provider.sign({ typ: 'Refresh' }))).toBeNull();
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('no access token'), expect.anything());
  });

  // A provider other than Keycloak writes no typ: its ID token names the client in aud as well
  it('refuses an ID token of a provider that does not say what its tokens are', async () => {
    const idToken = await provider.sign({ typ: undefined, azp: undefined, aud: 'studio', at_hash: 'x1' });
    expect(await verifier().verify(idToken)).toBeNull();
    expect(await verifier().verify(await provider.sign({ typ: undefined, c_hash: 'x2' }))).toBeNull();
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('an ID token'), expect.anything());
  });

  it('refuses a token without an expiry, which would never expire', async () => {
    expect(await verifier().verify(await provider.sign({}, { expiresIn: null }))).toBeNull();
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('exp'), expect.anything());
  });

  it('refuses a token for another client, and takes it when the client is named in aud', async () => {
    expect(await verifier().verify(await provider.sign({ azp: 'coding-box' }))).toBeNull();
    const namedInAudience = await provider.sign({ azp: 'coding-box', aud: ['account', 'studio'] });
    expect(await verifier().verify(namedInAudience)).not.toBeNull();
  });

  it('checks a configured audience strictly', async () => {
    const strict = verifier({ audience: 'studio-api' });
    expect(await strict.verify(await provider.sign({ aud: 'studio-api' }))).not.toBeNull();
    expect(await strict.verify(await provider.sign({ aud: 'account' }))).toBeNull();
  });

  it('refuses an expired token, and one not yet valid, beyond the leeway', async () => {
    expect(await verifier().verify(await provider.sign({}, { expiresIn: '-1m' }))).toBeNull();
    const now = Math.floor(Date.now() / 1000);
    expect(await verifier().verify(await provider.sign({ nbf: now + 120 }))).toBeNull();
    expect(await verifier().verify(await provider.sign({ nbf: now + 10 }))).not.toBeNull();
  });

  it('refuses a token signed with a key the provider does not have, as the token\'s fault', async () => {
    expect(await verifier().verify(await foreignToken(provider.issuer))).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('refuses a token that is not signed, or signed with a shared secret', async () => {
    const unsigned = new UnsecuredJWT({ sub: 'mallory', azp: 'studio' })
      .setIssuer(provider.issuer).setExpirationTime('5m').encode();
    expect(await verifier().verify(unsigned)).toBeNull();
    const hmac = await new SignJWT({ sub: 'mallory', azp: 'studio' })
      .setProtectedHeader({ alg: 'HS256', kid: 'key-1' })
      .setIssuer(provider.issuer).setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-secret-a-secret-a-secret-a-secret'));
    expect(await verifier().verify(hmac)).toBeNull();
  });

  it('refuses a token without a subject, and what is no token at all', async () => {
    expect(await verifier().verify(await provider.sign({ sub: undefined }))).toBeNull();
    expect(await verifier().verify('not.a.token')).toBeNull();
    expect(await verifier().verify('')).toBeNull();
  });

  it('keeps the keys, and fetches them again for a key it does not know yet', async () => {
    const keeping = verifier();
    await keeping.verify(await provider.sign());
    const fetches = provider.jwksFetches;
    await keeping.verify(await provider.sign());
    expect(provider.jwksFetches).toBe(fetches);

    // The keys are fetched again for an unknown key id -- once a cooldown of 30 s after the last fetch is over
    await provider.addKey('key-2');
    const rotated = await provider.sign({}, { kid: 'key-2' });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
    try {
      expect(await keeping.verify(rotated)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(provider.jwksFetches).toBe(fetches + 1);
  });

  it('takes the keys from a given address without discovery', async () => {
    const direct = verifier({ jwksUri: `${provider.issuer}/protocol/openid-connect/certs` });
    expect(await direct.verify(await provider.sign())).not.toBeNull();
  });

  it('refuses a discovery document that names another issuer, and says the provider is unusable', async () => {
    provider.announcedIssuer = 'https://evil.example.org/realms/iqb';
    expect(await verifier().verify(await provider.sign())).toBeNull();
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('names the issuer'), expect.anything());
    expect(onRejected).not.toHaveBeenCalled();
    provider.announcedIssuer = null;
  });

  it('answers null when the provider cannot be reached, and asks again only after a pause', async () => {
    const unreachable = verifier({ issuer: 'http://127.0.0.1:1/realms/iqb' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await unreachable.verify(await provider.sign())).toBeNull();
      expect(await unreachable.verify(await provider.sign())).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(onUnavailable).toHaveBeenCalledTimes(2);

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
      expect(await unreachable.verify(await provider.sign())).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
    }
  });
});
