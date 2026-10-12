import { describe, expect, it } from 'vitest';
import { RateLimit } from '../src/rate-limit.js';

describe('RateLimit', () => {
  it('allows up to the limit within the window', () => {
    const limit = new RateLimit(2, 1000);
    expect(limit.allow('a', 0)).toBe(true);
    expect(limit.allow('a', 10)).toBe(true);
    expect(limit.allow('a', 20)).toBe(false);
  });

  it('allows again as the window slides on', () => {
    const limit = new RateLimit(2, 1000);
    limit.allow('a', 0);
    limit.allow('a', 500);
    expect(limit.allow('a', 999)).toBe(false);
    expect(limit.allow('a', 1000)).toBe(true);
    expect(limit.allow('a', 1001)).toBe(false);
  });

  it('counts each key on its own', () => {
    const limit = new RateLimit(1, 1000);
    expect(limit.allow('a', 0)).toBe(true);
    expect(limit.allow('b', 0)).toBe(true);
    expect(limit.allow('a', 1)).toBe(false);
  });

  it('does not count what it refused', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);
    limit.allow('a', 100);
    limit.allow('a', 900);
    expect(limit.allow('a', 1000)).toBe(true);
  });

  it('forgets keys that have not acted within the window', () => {
    const limit = new RateLimit(1, 1000);
    limit.allow('a', 0);
    limit.prune(1000);
    expect((limit as unknown as { actions: Map<string, number[]> }).actions.size).toBe(0);
  });
});
