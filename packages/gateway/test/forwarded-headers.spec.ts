import { describe, expect, it } from 'vitest';
import { forwardedHeaders } from '../src/forwarded-headers.js';

const REQUEST = { chain: ['203.0.113.7'], protocol: 'https', host: 'studio.example.org' };

describe('forwardedHeaders', () => {
  it('keeps the client\'s headers and adds where the request came from', () => {
    expect(forwardedHeaders({ accept: 'text/html', cookie: 'a=1' }, REQUEST)).toEqual({
      accept: 'text/html',
      cookie: 'a=1',
      'x-forwarded-for': '203.0.113.7',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'studio.example.org'
    });
  });

  it('writes the chain it was given, from the client to the peer', () => {
    const headers = forwardedHeaders({}, { ...REQUEST, chain: ['198.51.100.1', '10.0.0.2'] });
    expect(headers['x-forwarded-for']).toBe('198.51.100.1, 10.0.0.2');
  });

  it('replaces whatever origin the client claims', () => {
    const headers = forwardedHeaders({
      'x-forwarded-for': '10.0.0.1',
      'X-Forwarded-Proto': 'http',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-port': '1',
      forwarded: 'for=10.0.0.1',
      'X-Real-IP': '10.0.0.1'
    }, REQUEST);
    expect(headers).toEqual({
      'x-forwarded-for': '203.0.113.7',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'studio.example.org'
    });
  });

  it('drops a claimed host even when it knows none of its own', () => {
    const headers = forwardedHeaders({ 'x-forwarded-host': 'evil.example' }, { ...REQUEST, host: undefined });
    expect(headers['x-forwarded-host']).toBeUndefined();
  });

  it('drops every header in the gateway\'s own namespace, whatever its case', () => {
    const headers = forwardedHeaders({ 'x-iqb-gate-identity': 'forged', 'X-Iqb-Gate-User': 'forged', a: 'b' }, REQUEST);
    expect(Object.keys(headers)).not.toContain('x-iqb-gate-identity');
    expect(Object.keys(headers)).not.toContain('X-Iqb-Gate-User');
    expect(headers.a).toBe('b');
  });

  it('leaves out what it does not know', () => {
    const headers = forwardedHeaders({}, { chain: [''], protocol: 'http', host: undefined });
    expect(headers).toEqual({ 'x-forwarded-proto': 'http' });
  });
});
