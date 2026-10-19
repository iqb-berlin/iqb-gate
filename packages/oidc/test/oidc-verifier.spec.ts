import {
  afterAll, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, UnsecuredJWT } from 'jose';
import { OidcVerifier, type OidcVerifierOptions } from '../src/oidc-verifier.js';
import { FakeProvider, foreignToken } from '../src/testing/fake-provider.js';

describe('OidcVerifier', () => {
  const provider = new FakeProvider();
  let onRejected: ReturnType<typeof vi.fn<(reason: string, error?: unknown) => void>>;
  let onUnavailable: ReturnType<typeof vi.fn<(reason: string, error?: unknown) => void>>;
  let onStaleKeys: ReturnType<typeof vi.fn<(reason: string) => void>>;

  const verifier = (options: Partial<ConstructorParameters<typeof OidcVerifier>[0]> = {}) => new OidcVerifier({
    issuer: provider.issuer, clientId: 'studio', onRejected, onUnavailable, onStaleKeys, ...options
  });

  beforeAll(() => provider.start());
  afterAll(() => provider.stop());
  beforeEach(() => {
    onRejected = vi.fn<(reason: string, error?: unknown) => void>();
    onUnavailable = vi.fn<(reason: string, error?: unknown) => void>();
    onStaleKeys = vi.fn<(reason: string) => void>();
  });

  it('names the person of a token that holds, finding the keys through discovery', async () => {
    const verification = await verifier().verify(await provider.sign({
      given_name: 'Anna', family_name: 'Arendt',
      realm_access: { roles: ['admin'] }, resource_access: { studio: { roles: ['editor'] }, other: { roles: ['x'] } }
    }));
    expect(verification).toEqual({
      status: 'verified',
      identity: {
        issuer: provider.issuer,
        subject: 'f3b1c0de-anna',
        username: 'anna',
        email: 'anna@example.org',
        givenName: 'Anna',
        familyName: 'Arendt',
        roles: ['admin', 'editor'],
        claims: expect.objectContaining({ sub: 'f3b1c0de-anna', azp: 'studio' })
      }
    });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('falls back to the e-mail address, then the subject, for a name', async () => {
    const byMail = await verifier().verify(await provider.sign({ preferred_username: undefined }));
    expect(byMail).toMatchObject({ status: 'verified', identity: { username: 'anna@example.org' } });
    const bySubject = await verifier().verify(await provider.sign({ preferred_username: undefined, email: undefined }));
    expect(bySubject).toMatchObject({ status: 'verified', identity: { username: 'f3b1c0de-anna' } });
  });

  it('refuses a token of another issuer', async () => {
    expect(await verifier().verify(await provider.sign({ iss: 'https://evil.example.org/realms/iqb' })))
      .toEqual({ status: 'rejected', reason: expect.stringContaining('issuer') });
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('issuer'), expect.anything());
  });

  // coding-box took the issuer with or without the slash at its end
  it('takes the issuer with or without a slash at its end', async () => {
    expect((await verifier({ issuer: `${provider.issuer}/` }).verify(await provider.sign())).status).toBe('verified');
    expect((await verifier().verify(await provider.sign({ iss: `${provider.issuer}/` }))).status).toBe('verified');
  });

  // Keycloak's ID tokens are for the client as well, but no key to an API
  it('refuses a token that says it is no access token', async () => {
    expect((await verifier().verify(await provider.sign({ typ: 'ID', aud: 'studio' }))).status).toBe('rejected');
    expect((await verifier().verify(await provider.sign({ typ: 'Refresh' }))).status).toBe('rejected');
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('no access token'), expect.anything());
  });

  // A provider other than Keycloak writes no typ: its ID token names the client in aud as well
  it('refuses an ID token of a provider that does not say what its tokens are', async () => {
    const idToken = await provider.sign({ typ: undefined, azp: undefined, aud: 'studio', at_hash: 'x1' });
    expect((await verifier().verify(idToken)).status).toBe('rejected');
    expect((await verifier().verify(await provider.sign({ typ: undefined, c_hash: 'x2' }))).status).toBe('rejected');
    expect((await verifier().verify(await provider.sign({ typ: undefined, s_hash: 'x3' }))).status).toBe('rejected');
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('an ID token'), expect.anything());
  });

  it('refuses a token without an expiry, which would never expire', async () => {
    expect((await verifier().verify(await provider.sign({}, { expiresIn: null }))).status).toBe('rejected');
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining('exp'), expect.anything());
  });

  it('refuses a token for another client, and takes it when the client is named in aud', async () => {
    expect((await verifier().verify(await provider.sign({ azp: 'coding-box' }))).status).toBe('rejected');
    const namedInAudience = await provider.sign({ azp: 'coding-box', aud: ['account', 'studio'] });
    expect((await verifier().verify(namedInAudience)).status).toBe('verified');
  });

  // Without a client, the token of any other client of the realm would hold
  it('needs the client the tokens have to be for', () => {
    expect(() => new OidcVerifier({ issuer: provider.issuer } as OidcVerifierOptions)).toThrow(/clientId/);
    expect(() => verifier({ clientId: '' })).toThrow(/clientId/);
  });

  it('checks a configured audience strictly', async () => {
    const strict = verifier({ audience: 'studio-api' });
    expect((await strict.verify(await provider.sign({ aud: 'studio-api' }))).status).toBe('verified');
    expect((await strict.verify(await provider.sign({ aud: 'account' }))).status).toBe('rejected');
  });

  it('refuses an expired token, and one not yet valid, beyond the leeway', async () => {
    expect((await verifier().verify(await provider.sign({}, { expiresIn: '-1m' }))).status).toBe('rejected');
    const now = Math.floor(Date.now() / 1000);
    expect((await verifier().verify(await provider.sign({ nbf: now + 120 }))).status).toBe('rejected');
    expect((await verifier().verify(await provider.sign({ nbf: now + 10 }))).status).toBe('verified');
  });

  it('refuses a token signed with a key the provider does not have, as the token\'s fault', async () => {
    expect((await verifier().verify(await foreignToken(provider.issuer))).status).toBe('rejected');
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('refuses a token that is not signed, or signed with a shared secret', async () => {
    const unsigned = new UnsecuredJWT({ sub: 'mallory', azp: 'studio' })
      .setIssuer(provider.issuer).setExpirationTime('5m').encode();
    expect((await verifier().verify(unsigned)).status).toBe('rejected');
    const hmac = await new SignJWT({ sub: 'mallory', azp: 'studio' })
      .setProtectedHeader({ alg: 'HS256', kid: 'key-1' })
      .setIssuer(provider.issuer).setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-secret-a-secret-a-secret-a-secret'));
    expect((await verifier().verify(hmac)).status).toBe('rejected');
  });

  it('refuses a token without a subject, and what is no token at all', async () => {
    expect((await verifier().verify(await provider.sign({ sub: undefined }))).status).toBe('rejected');
    expect((await verifier().verify('not.a.token')).status).toBe('rejected');
    expect((await verifier().verify('')).status).toBe('rejected');
  });

  it('keeps the keys, and fetches them again for a key it does not know yet', async () => {
    const keeping = verifier();
    await keeping.verify(await provider.sign());
    const fetches = provider.jwksFetches;
    await keeping.verify(await provider.sign());
    expect(provider.jwksFetches).toBe(fetches);

    // The keys are fetched again for an unknown key id, at once: the provider may sign with a new key
    await provider.addKey('key-2');
    const rotated = await provider.sign({}, { kid: 'key-2' });
    expect((await keeping.verify(rotated)).status).toBe('verified');
    expect(provider.jwksFetches).toBe(fetches + 1);
  });

  it('keeps checking tokens with the keys it has while the provider\'s keys cannot be fetched', async () => {
    const keeping = verifier();
    expect((await keeping.verify(await provider.sign())).status).toBe('verified');
    provider.keysAnswer = 503;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60 * 1000 });
    try {
      expect((await keeping.verify(await provider.sign())).status).toBe('verified');
      expect(onStaleKeys).toHaveBeenCalledTimes(1);
      const fetches = provider.jwksFetches;
      expect((await keeping.verify(await provider.sign())).status).toBe('verified');
      expect(provider.jwksFetches).toBe(fetches);
      // Tokens still hold: no outage to report
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      provider.keysAnswer = null;
    }
  });

  it('refuses a token of a key it does not know during an outage, as the token\'s fault', async () => {
    const keeping = verifier();
    expect((await keeping.verify(await provider.sign())).status).toBe('verified');
    provider.keysAnswer = 503;
    await provider.addKey('key-forged');
    const forged = await provider.sign({}, { kid: 'key-forged' });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
    try {
      expect((await keeping.verify(forged)).status).toBe('rejected');
      expect(onRejected).toHaveBeenCalledTimes(1);
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      provider.keysAnswer = null;
    }
  });

  it('says once per failed fetch that the keys cannot be fetched, while it has none to go on with', async () => {
    const keyless = verifier();
    provider.keysAnswer = 503;
    try {
      expect((await keyless.verify(await provider.sign())).status).toBe('unavailable');
      expect((await keyless.verify(await provider.sign())).status).toBe('unavailable');
      expect(onUnavailable).toHaveBeenCalledTimes(1);
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
      expect((await keyless.verify(await provider.sign())).status).toBe('unavailable');
      expect(onUnavailable).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      provider.keysAnswer = null;
    }
  });

  it('takes the keys from a given address without discovery', async () => {
    const direct = verifier({ jwksUri: `${provider.issuer}/protocol/openid-connect/certs` });
    expect((await direct.verify(await provider.sign())).status).toBe('verified');
  });

  it('refuses a discovery document that names another issuer, and says the provider is unusable', async () => {
    provider.announcedIssuer = 'https://evil.example.org/realms/iqb';
    expect(await verifier().verify(await provider.sign()))
      .toEqual({ status: 'unavailable', reason: expect.stringContaining('names the issuer') });
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('names the issuer'), expect.anything());
    expect(onRejected).not.toHaveBeenCalled();
    provider.announcedIssuer = null;
  });

  // An application checks its own tokens when the provider refuses one: they must not wait for the provider
  it('refuses a token of another issuer, or with a shared secret, while the provider cannot be asked', async () => {
    const issuer = 'http://127.0.0.1:1/realms/iqb';
    const unreachable = verifier({ issuer });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect((await unreachable.verify(await provider.sign())).status).toBe('rejected');
      const own = await new SignJWT({ sub: 'workspace-7' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(issuer).setExpirationTime('5m')
        .sign(new TextEncoder().encode('a-secret-a-secret-a-secret-a-secret'));
      expect(await unreachable.verify(own)).toEqual({ status: 'rejected', reason: expect.stringContaining('HS256') });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // A redirect on the issuer's host -- an open redirect, a proxy -- would hand over another provider's keys
  it('refuses a discovery document behind a redirect, and says the provider is unusable', async () => {
    const other = new FakeProvider();
    await other.start();
    const relay = createServer((_request, response) => {
      response.writeHead(302, { location: `${other.issuer}/.well-known/openid-configuration` }).end();
    });
    await new Promise<void>(resolve => { relay.listen(0, '127.0.0.1', () => resolve()); });
    const issuer = `http://127.0.0.1:${(relay.address() as AddressInfo).port}/realms/iqb`;
    other.announcedIssuer = issuer;
    try {
      expect((await verifier({ issuer }).verify(await other.sign({ iss: issuer }))).status).toBe('unavailable');
      expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('302 -- a redirect'), expect.anything());
    } finally {
      await new Promise(resolve => { relay.close(resolve); });
      await other.stop();
    }
  });

  // An API answers the outage with 503: a 401 would send the browser to log in again, for nothing
  it('says the provider is unavailable when it cannot be reached, and asks again only after a pause', async () => {
    const issuer = 'http://127.0.0.1:1/realms/iqb';
    const unreachable = verifier({ issuer });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect((await unreachable.verify(await provider.sign({ iss: issuer }))).status).toBe('unavailable');
      expect((await unreachable.verify(await provider.sign({ iss: issuer }))).status).toBe('unavailable');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Once for the failed attempt, not for every token it refuses: a log would fill with it
      expect(onUnavailable).toHaveBeenCalledTimes(1);

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
      expect((await unreachable.verify(await provider.sign({ iss: issuer }))).status).toBe('unavailable');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(onUnavailable).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
    }
  });
});
