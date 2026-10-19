import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { errors, jwtVerify } from 'jose';
import { ProviderKeys } from '../src/provider-keys.js';
import { FakeProvider } from '../src/testing/fake-provider.js';

const MINUTE_MS = 60 * 1000;

/** Stands in front of the provider's keys and answers with a redirect to them. */
class RedirectingRelay {
  private server: Server | null = null;

  async start(target: string): Promise<string> {
    this.server = createServer((_request, response) => {
      response.writeHead(302, { location: target }).end();
    });
    await new Promise<void>(resolve => { this.server?.listen(0, '127.0.0.1', () => resolve()); });
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/certs`;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => { this.server?.close(resolve); });
  }
}

describe('ProviderKeys', () => {
  const provider = new FakeProvider();
  let onStale: ReturnType<typeof vi.fn<(reason: string) => void>>;
  let keys: ProviderKeys;

  /** Checks a token signed now -- by the provider's newest key, or the one named. */
  const check = async (kid?: string) => jwtVerify(await provider.sign({}, { kid }), keys.getKey);
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

  beforeAll(() => provider.start());
  afterAll(() => provider.stop());
  beforeEach(() => {
    // Only the clock: the provider answers over a real socket
    vi.useFakeTimers({ toFake: ['Date'] });
    onStale = vi.fn<(reason: string) => void>();
    keys = new ProviderKeys(`${provider.issuer}/protocol/openid-connect/certs`, onStale);
  });
  afterEach(() => {
    provider.keysAnswer = null;
    vi.useRealTimers();
  });

  it('fetches the keys once and uses them while they are fresh', async () => {
    const before = provider.jwksFetches;
    await check();
    later(9 * MINUTE_MS);
    await check();
    expect(provider.jwksFetches - before).toBe(1);
  });

  it('fetches them again before checking a token once they are ten minutes old', async () => {
    await check();
    const before = provider.jwksFetches;
    later(10 * MINUTE_MS + 1);
    await check();
    expect(provider.jwksFetches - before).toBe(1);
  });

  // A provider removes a key by publishing its set without it
  it('refuses a key the provider removed, once its keys are fetched again', async () => {
    await provider.addKey('key-rotated-out');
    await check('key-rotated-out');
    provider.removeKey('key-rotated-out');
    later(10 * MINUTE_MS + 1);
    await expect(check('key-rotated-out')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
  });

  it('asks a provider whose keys cannot be fetched again only after a pause, not for every token', async () => {
    provider.keysAnswer = 503;
    const before = provider.jwksFetches;
    await expect(check()).rejects.toThrow(/503/);
    await expect(check()).rejects.toThrow(/503/);
    expect(provider.jwksFetches - before).toBe(1);
    later(30 * 1000 + 1);
    await expect(check()).rejects.toThrow(/503/);
    expect(provider.jwksFetches - before).toBe(2);
  });

  // 503 from a provider that is down, 404 from a proxy while the provider restarts behind it
  it.each([503, 404])('keeps checking with its keys while their address answers %i, and says so once per attempt',
    async status => {
      await check();
      provider.keysAnswer = status;
      later(11 * MINUTE_MS);
      await expect(check()).resolves.toBeDefined();
      const before = provider.jwksFetches;
      await expect(check()).resolves.toBeDefined();
      expect(provider.jwksFetches).toBe(before);
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledWith(expect.stringContaining(String(status)));
    });

  it('takes an unknown key id during an outage for the token\'s fault, not for the outage', async () => {
    await check();
    provider.keysAnswer = 503;
    await provider.addKey('key-forged');
    later(31 * 1000);
    await expect(check('key-forged')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('refuses once its keys are a day old and the provider still cannot be reached', async () => {
    await check();
    provider.keysAnswer = 503;
    later(24 * 60 * MINUTE_MS + 1);
    await expect(check()).rejects.toThrow(/503/);
  });

  // A provider may sign with a new key at once, seconds after the routine fetch
  it('fetches at once for a key id it does not know, after a routine fetch too, then at most every thirty seconds',
    async () => {
      await check();
      later(10 * MINUTE_MS + 1);
      await check();
      await provider.addKey('key-2');
      const before = provider.jwksFetches;
      later(5 * 1000);
      await expect(check('key-2')).resolves.toBeDefined();
      expect(provider.jwksFetches - before).toBe(1);
      await provider.addKey('key-3');
      later(10 * 1000);
      await expect(check('key-3')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
      expect(provider.jwksFetches - before).toBe(1);
      later(20 * 1000);
      await expect(check('key-3')).resolves.toBeDefined();
      expect(provider.jwksFetches - before).toBe(2);
    });

  // The first requests after a rotation run side by side
  it('lets tokens with the same new key id at the same time share one fetch, and holds them all', async () => {
    await check();
    await provider.addKey('key-together');
    const before = provider.jwksFetches;
    await expect(Promise.all([check('key-together'), check('key-together'), check('key-together')]))
      .resolves.toHaveLength(3);
    expect(provider.jwksFetches - before).toBe(1);
  });

  it('lets tokens with the same new key id wait for one failed fetch, not send one each', async () => {
    await check();
    await provider.addKey('key-while-down');
    provider.keysAnswer = 503;
    later(31 * 1000);
    const before = provider.jwksFetches;
    const checks = await Promise.allSettled([1, 2, 3].map(() => check('key-while-down')));
    expect(checks.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(provider.jwksFetches - before).toBe(1);
  });

  it('does not fetch again for a key id the keys just fetched for the same token do not know', async () => {
    await provider.addKey('key-unpublished');
    provider.removeKey('key-unpublished');
    await check();
    const before = provider.jwksFetches;
    later(10 * MINUTE_MS + 1);
    await expect(check('key-unpublished')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(provider.jwksFetches - before).toBe(1);
  });

  // A pause sends no request: a key id that meets it must not hold off the next one
  it('fetches for a key id it does not know though another one met a failed fetch shortly before', async () => {
    await provider.addKey('key-unknown');
    provider.removeKey('key-unknown');
    await check();
    provider.keysAnswer = 503;
    later(10 * MINUTE_MS + 1);
    await expect(check()).resolves.toBeDefined();
    later(29 * 1000);
    const before = provider.jwksFetches;
    await expect(check('key-unknown')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(provider.jwksFetches).toBe(before);
    provider.keysAnswer = null;
    later(2 * 1000);
    await expect(check()).resolves.toBeDefined();
    await provider.addKey('key-late');
    later(1000);
    await expect(check('key-late')).resolves.toBeDefined();
  });

  // An unread body holds its connection: a provider that is down would collect them
  it('cancels the body of an answer that holds no keys', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true;
      }
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 503 }));
    try {
      await expect(check()).rejects.toThrow(/503/);
      expect(cancelled).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('says what the provider answered, though the body cannot be cancelled', async () => {
    const body = new ReadableStream({
      cancel: () => {
        throw new Error('terminated');
      }
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 503 }));
    try {
      await expect(check()).rejects.toThrow(/answered 503/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Keys from wherever a redirect points are no keys of the provider's
  it('refuses keys behind a redirect', async () => {
    const relay = new RedirectingRelay();
    keys = new ProviderKeys(await relay.start(`${provider.issuer}/protocol/openid-connect/certs`), onStale);
    try {
      await expect(check()).rejects.toThrow(/302/);
    } finally {
      await relay.stop();
    }
  });
});
