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

  it('fetches again for a key id it does not know, at most every thirty seconds', async () => {
    await check();
    await provider.addKey('key-2');
    const before = provider.jwksFetches;
    later(10 * 1000);
    await expect(check('key-2')).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(provider.jwksFetches - before).toBe(0);
    later(30 * 1000);
    await expect(check('key-2')).resolves.toBeDefined();
    expect(provider.jwksFetches - before).toBe(1);
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
