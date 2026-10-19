import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/** Keys younger than this are used without asking the provider. */
const FRESH_MS = 10 * 60 * 1000;

/**
 * A fetch that failed stands this long, and a key id not known yet is asked for at most this
 * often: while the provider is down, not every token sends another request after it. The
 * verifier pauses its discovery as long.
 */
export const RETRY_PAUSE_MS = 30 * 1000;

/** How long the keys outlive a provider that cannot be asked, before its tokens are refused. */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5000;

type LocalKeys = ReturnType<typeof createLocalJWKSet>;

/**
 * The published keys of one provider, kept between tokens. Fresh keys are used without a request;
 * older ones are fetched again before the token is checked, so that a key the provider removed
 * holds no longer than ten minutes. Only a key set the provider answers with replaces the keys:
 * a provider removes a key by publishing the set without it. Anything else -- no connection, a
 * status other than 200 (a proxy answers 404 while the provider restarts), a redirect, what is no
 * key set -- leaves the keys fetched before checking tokens, for up to a day, and is not tried
 * again before a pause. (jose's remote key set fetches before every token while it cannot, and
 * then drops what it has.)
 *
 * Not done: a key address that moved is not looked up again through discovery -- the keys go
 * stale and, after a day, refused; a restart finds the new one.
 */
export class ProviderKeys {
  private keys: LocalKeys | null = null;
  private fetchedAt = 0;
  /** When a key id not known yet last sent a request -- not when the keys were last fetched. */
  private keyIdFetchedAt = 0;
  private failedAt = 0;
  private failure: Error | null = null;
  private pending: Promise<void> | null = null;

  /** `onStale` hears of a fetch that failed while the keys fetched before go on checking tokens. */
  constructor(private readonly uri: string, private readonly onStale: (reason: string) => void = () => {}) {}

  /** The key for a token's header, as `jwtVerify` asks for it. */
  readonly getKey: JWTVerifyGetKey = async (header, token) => {
    const fetchedBefore = this.fetchedAt;
    const keys = await this.current();
    try {
      return await keys(header, token);
    } catch (error) {
      // A key id not known yet: the provider may have added a key since the last fetch -- a routine
      // one too, as it may sign with a new key at once. Not when the keys were just fetched for this
      // token, nor while a failed fetch stands: that would send no request, only use up the pause.
      if (!(error instanceof errors.JWKSNoMatchingKey) || this.fetchedAt !== fetchedBefore) throw error;
      if (this.failing() || Date.now() - this.keyIdFetchedAt < RETRY_PAUSE_MS) throw error;
      this.keyIdFetchedAt = Date.now();
      // A provider that cannot be asked leaves the key unknown -- the token's fault, not an outage
      await this.refresh().catch(() => {
        throw error;
      });
      return (await this.current())(header, token);
    }
  };

  private async current(): Promise<LocalKeys> {
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

  /** The keys fetched before, while the provider cannot be asked -- until they are a day old. */
  private keysWhileStale(): LocalKeys | null {
    return this.keys && Date.now() - this.fetchedAt < STALE_LIMIT_MS ? this.keys : null;
  }

  /** A failed fetch that stands: the provider is not asked again before {@link RETRY_PAUSE_MS}. */
  private failing(): boolean {
    return this.failure !== null && Date.now() - this.failedAt < RETRY_PAUSE_MS;
  }

  /** Fetches the keys, once for all who ask at the same time; a failure stands for {@link RETRY_PAUSE_MS}. */
  private refresh(): Promise<void> {
    if (this.failure && this.failing()) return Promise.reject(this.failure);
    this.pending ??= this.fetchKeys().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchKeys(): Promise<void> {
    try {
      this.keys = await this.fetchKeySet();
      this.fetchedAt = Date.now();
      this.failure = null;
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      this.failedAt = Date.now();
      if (this.keysWhileStale()) this.onStale(`${this.failure.message}; the keys fetched before go on checking tokens`);
      throw this.failure;
    }
  }

  private async fetchKeySet(): Promise<LocalKeys> {
    const response = await fetch(this.uri, {
      headers: { accept: 'application/json, application/jwk-set+json' },
      // Keys from wherever a redirect points are no keys of the provider's
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (response.status !== 200) {
      // An unread body holds its connection; a failed cancel does not hide the status
      await response.body?.cancel().catch(() => {});
      throw new Error(`the provider's keys at ${this.uri} answered ${response.status}`);
    }
    // Refuses what is no key set
    return createLocalJWKSet(await response.json() as JSONWebKeySet);
  }
}
