import { describe, expect, it } from 'vitest';
import { periodEnd, periodStart } from '../../src/audit/audit-period.js';

describe('audit period', () => {
  it('should start a day at its beginning, and take a moment as it is', () => {
    expect(periodStart('2026-10-01')).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(periodStart('2026-10-01T08:30:00Z')).toEqual(new Date('2026-10-01T08:30:00Z'));
  });

  // "up to the 8th" means the 8th as well
  it('should end a day without a time at its last moment', () => {
    expect(periodEnd('2026-10-08')).toEqual(new Date('2026-10-08T23:59:59.999Z'));
  });

  it('should end a moment with a time exactly there', () => {
    expect(periodEnd('2026-10-08T12:00:00Z')).toEqual(new Date('2026-10-08T12:00:00Z'));
  });

  it.each([undefined, '', 'yesterday'])('should leave out %p', value => {
    expect(periodStart(value)).toBeUndefined();
    expect(periodEnd(value)).toBeUndefined();
  });
});
