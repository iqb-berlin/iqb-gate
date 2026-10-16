import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest';
import { errors, jwtVerify } from 'jose';
import { ProviderKeys } from '../src/provider-keys.js';
import { FakeProvider } from '../src/testing/fake-provider.js';

const MINUTE_MS = 60 * 1000;

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
    provider.keysDown = false;
    vi.useRealTimers();
  });

  it('fetches the keys once and uses them while they are fresh', async () => {
    const before = provider.jwksFetches;
    await check();
    later(9 * MINUTE_MS);
    await check();
    expect(provider.jwksFetches - before).toBe(1);
  });

  it('fetches them again once they are ten minutes old', async () => {
    await check();
    const before = provider.jwksFetches;
    later(10 * MINUTE_MS + 1);
    await check();
    expect(provider.jwksFetches - before).toBe(1);
  });

  it('asks a provider whose keys cannot be fetched again only after a pause, not for every token', async () => {
    provider.keysDown = true;
    const before = provider.jwksFetches;
    await expect(check()).rejects.toThrow(/503/);
    await expect(check()).rejects.toThrow(/503/);
    expect(provider.jwksFetches - before).toBe(1);
    later(30 * 1000 + 1);
    await expect(check()).rejects.toThrow(/503/);
    expect(provider.jwksFetches - before).toBe(2);
  });

  it('keeps using its keys while the provider cannot be reached, and says so once per attempt', async () => {
    await check();
    provider.keysDown = true;
    later(11 * MINUTE_MS);
    await expect(check()).resolves.toBeDefined();
    await expect(check()).resolves.toBeDefined();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith(expect.stringContaining('503'));
  });

  it('refuses once its keys are a day old and the provider still cannot be reached', async () => {
    await check();
    provider.keysDown = true;
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
});
