import { describe, expect, it } from 'vitest';
import { timeoutSecondsFor } from '../src/timeouts.js';

const TIMEOUTS = {
  defaultSeconds: 60,
  paths: [
    { prefix: '/api', seconds: 120 },
    { prefix: '/api/admin/workspace', seconds: 1800 }
  ]
};

describe('timeoutSecondsFor', () => {
  it('takes the default outside every prefix', () => {
    expect(timeoutSecondsFor('/', TIMEOUTS)).toBe(60);
    expect(timeoutSecondsFor('/assets/main.js', TIMEOUTS)).toBe(60);
  });

  it('covers the prefix itself and what lies below it', () => {
    expect(timeoutSecondsFor('/api', TIMEOUTS)).toBe(120);
    expect(timeoutSecondsFor('/api/units', TIMEOUTS)).toBe(120);
  });

  // The application reads /API/admin/workspace as /api/admin/workspace: a long export there needs its time
  it('covers a path spelled in other case, or with dot segments, slashes and escapes', () => {
    expect(timeoutSecondsFor('/API/Admin/Workspace/5/export', TIMEOUTS)).toBe(1800);
    expect(timeoutSecondsFor('//api/admin/workspace/5', TIMEOUTS)).toBe(1800);
    expect(timeoutSecondsFor('/api/x/../admin/workspace/5', TIMEOUTS)).toBe(1800);
    expect(timeoutSecondsFor('/api/%61dmin/workspace/5', TIMEOUTS)).toBe(1800);
  });

  it('does not cover a path that only begins with the same letters', () => {
    expect(timeoutSecondsFor('/apis', TIMEOUTS)).toBe(60);
    expect(timeoutSecondsFor('/api/admin/workspaces', TIMEOUTS)).toBe(120);
  });

  it('takes the longest prefix, whatever the order', () => {
    expect(timeoutSecondsFor('/api/admin/workspace/3/import', TIMEOUTS)).toBe(1800);
    expect(timeoutSecondsFor('/api/admin/workspace/3/import', {
      ...TIMEOUTS, paths: [...TIMEOUTS.paths].reverse()
    })).toBe(1800);
  });

  it('ignores the query', () => {
    expect(timeoutSecondsFor('/api/admin/workspace?x=/api', TIMEOUTS)).toBe(1800);
    expect(timeoutSecondsFor('/other?next=/api/admin/workspace', TIMEOUTS)).toBe(60);
  });
});
