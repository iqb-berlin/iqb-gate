import {
  afterAll, beforeAll, describe, expect, it
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { forwardedTarget, proxiedTarget } from '../src/check-target.js';

describe('the target of a check', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify({ trustProxy: ['127.0.0.1'] });
    server.all('/proxied/*', async request => proxiedTarget(request));
    server.all('/forwarded', async request => forwardedTarget(request) ?? { none: true });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  const forwarded = async (headers: Record<string, string | string[]>) => (await server.inject({
    method: 'GET', url: '/forwarded', headers
  })).json();

  it('is the request itself in the proxy, over HTTPS as the proxy in front reports it', async () => {
    const response = await server.inject({
      method: 'PATCH', url: '/proxied/api?x=1', headers: { 'x-forwarded-proto': 'https' }
    });
    expect(response.json()).toEqual({
      method: 'PATCH', url: '/proxied/api?x=1', protocol: 'https', forwardAuth: false
    });
  });

  it('is the request Traefik names under ForwardAuth, not its own subrequest', async () => {
    expect(await forwarded({
      'x-forwarded-method': 'patch', 'x-forwarded-uri': '/api/admin/users/3?x=1', 'x-forwarded-proto': 'HTTPS'
    })).toEqual({ method: 'PATCH', url: '/api/admin/users/3?x=1', protocol: 'https', forwardAuth: true });
  });

  it('believes HTTPS only from a proxy the gateway trusts, as the pass route does', async () => {
    const untrusting = Fastify();
    untrusting.get('/forwarded', async request => forwardedTarget(request));
    try {
      const response = await untrusting.inject({
        method: 'GET',
        url: '/forwarded',
        headers: { 'x-forwarded-method': 'GET', 'x-forwarded-uri': '/', 'x-forwarded-proto': 'https' }
      });
      expect(response.json()).toEqual(expect.objectContaining({ protocol: 'http' }));
    } finally {
      await untrusting.close();
    }
  });

  it('is none when Traefik\'s headers are missing or make no sense', async () => {
    const complete = { 'x-forwarded-method': 'GET', 'x-forwarded-uri': '/', 'x-forwarded-proto': 'http' };
    expect(await forwarded(complete)).toEqual({ method: 'GET', url: '/', protocol: 'http', forwardAuth: true });
    expect(await forwarded({})).toEqual({ none: true });
    expect(await forwarded({ ...complete, 'x-forwarded-method': '' })).toEqual({ none: true });
    expect(await forwarded({ ...complete, 'x-forwarded-uri': 'api/units' })).toEqual({ none: true });
    expect(await forwarded({ ...complete, 'x-forwarded-proto': 'ftp' })).toEqual({ none: true });
    expect(await forwarded({ ...complete, 'x-forwarded-proto': 'https, http' })).toEqual({ none: true });
    // A list, as a proxy that appends makes it, names no request; nor does an address with a space
    expect(await forwarded({ ...complete, 'x-forwarded-method': 'POST, GET' })).toEqual({ none: true });
    expect(await forwarded({ ...complete, 'x-forwarded-uri': '/api/a /api/b' })).toEqual({ none: true });
  });
});
