import { describe, expect, it } from 'vitest';
import { pathVariants } from '../src/request-path.js';

describe('pathVariants', () => {
  it('keeps the raw path and the path the application reads', () => {
    expect(pathVariants('/api/%61dmin//users/./3?x=1')).toEqual({
      raw: '/api/%61dmin//users/./3', normalised: '/api/admin/users/3'
    });
    expect(pathVariants('/api/x/../admin/users')).toEqual({
      raw: '/api/x/../admin/users', normalised: '/api/admin/users'
    });
    expect(pathVariants('/api\\admin\\users').normalised).toBe('/api/admin/users');
    expect(pathVariants('/api/%E0%A4%A').normalised).toBe('/api/%E0%A4%A');
  });
});
