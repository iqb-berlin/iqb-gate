import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/** Keys younger than this are used without asking the provider. */
const FRESH_MS = 10 * 60 * 1000;

/** A fetch that failed stands this long; a key id not known yet is asked for at most this often. */
const PAUSE_MS = 30 * 1000;

/** How long the keys outlive a provider that cannot be reached, before its tokens are refused. */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;

/**
 * The published keys of one provider, kept between tokens. Fresh keys are used without a request,
 * older ones are fetched again, and a fetch that failed is not repeated before a pause -- not with
 * every token while the provider is down. Keys already known go on checking tokens through an
 * outage of up to a day; a key the provider drops while it can be reached is gone with the next
 * fetch. (jose's remote key set fetches before every token while it cannot, and then drops what it
 * has.)
 */
export class ProviderKeys {
  private keys: ReturnType<typeof createLocalJWKSet> | null = null;
  private fetchedAt = 0;
  private failedAt = 0;
  private failure: Error | null = null;
  private pending: Promise<void> | null = null;

  /** `onStale` hears of a fetch that failed while the keys it has are still used. */
  constructor(private readonly uri: string, private readonly onStale: (reason: string) => void = () => {}) {}

  /** The key for a token's header, as `jwtVerify` asks for it. */
  readonly getKey: JWTVerifyGetKey = async (header, token) => {
    const keys = await this.current();
    try {
      return await keys(header, token);
    } catch (error) {
      // A key id not known yet: the provider may have added a key since the last fetch
      if (!(error instanceof errors.JWKSNoMatchingKey) || Date.now() - this.fetchedAt < PAUSE_MS) throw error;
      await this.refresh();
      return (await this.current())(header, token);
    }
  };

  private async current(): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (this.keys && Date.now() - this.fetchedAt < FRESH_MS) return this.keys;
    try {
      await this.refresh();
    } catch (error) {
      const stale = this.keysWhileStale();
      if (stale) return stale;
      throw error;
    }
    if (!this.keys) throw new Error(`the provider's keys at ${this.uri} could not be read`);
    return this.keys;
  }

  /** The keys while the provider cannot be reached -- until they are a day old. */
  private keysWhileStale(): ReturnType<typeof createLocalJWKSet> | null {
    return this.keys && Date.now() - this.fetchedAt < STALE_LIMIT_MS ? this.keys : null;
  }

  /** Fetches the keys, once for all who ask at the same time; a failure stands for {@link PAUSE_MS}. */
  private refresh(): Promise<void> {
    if (this.failure && Date.now() - this.failedAt < PAUSE_MS) return Promise.reject(this.failure);
    this.pending ??= this.fetchKeys().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchKeys(): Promise<void> {
    try {
      const response = await fetch(this.uri, {
        headers: { accept: 'application/json, application/jwk-set+json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`the provider's keys at ${this.uri} answered ${response.status}`);
      // Refuses what is no key set
      this.keys = createLocalJWKSet(await response.json() as JSONWebKeySet);
      this.fetchedAt = Date.now();
      this.failure = null;
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      this.failedAt = Date.now();
      if (this.keysWhileStale()) this.onStale(`${this.failure.message}; the keys fetched before are used`);
      throw this.failure;
    }
  }
}
