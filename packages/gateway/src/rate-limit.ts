/**
 * Allows a key -- a client address -- at most `limit` actions within a sliding window. Kept in
 * memory: there is one gateway instance.
 */
export class RateLimit {
  private readonly actions = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Whether the key may act now; an action that is allowed is counted. */
  allow(key: string, now: number): boolean {
    const recent = (this.actions.get(key) ?? []).filter(at => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.actions.set(key, recent);
      return false;
    }
    this.actions.set(key, [...recent, now]);
    return true;
  }

  /** Forgets the keys that have not acted within the window. */
  prune(now: number): void {
    this.actions.forEach((times, key) => {
      if (times.every(at => now - at >= this.windowMs)) this.actions.delete(key);
    });
  }
}
