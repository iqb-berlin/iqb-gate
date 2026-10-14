import {
  afterAll, beforeAll, describe, expect, it, vi
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import {
  CHALLENGE_PATH, type ClientSignals, type HumanVerificationChallenge, VERIFY_PATH
} from '@iqb/gate-protocol';
import { buildGateway } from '../src/gateway.js';
import type { AuditEntry } from '../src/audit/audit-log.js';
import { compilePattern } from '../src/config-helpers.js';
import { FORWARD_AUTH_PATH } from '../src/forward-auth-route.js';
import { DEFAULT_PAGE_TEXTS } from '../src/page-gate/page-texts.js';
import { testConfig } from './support/test-config.js';
import { solvedPayload } from './support/solve-challenge.js';

const AUDIT_KEY = 'audit-key-audit-key-audit-key-1234';
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

const PERSON: ClientSignals = {
  webdriver: false,
  headless: false,
  untrustedInput: false,
  msSinceTrustedInput: 500,
  softwareRenderer: false,
  devtoolsProtocol: false
};
const signals = (changes: Partial<ClientSignals> = {}) => JSON.stringify({ ...PERSON, ...changes });

/** A browser opening a page, as Traefik forwards its headers. */
const OPENING = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': BROWSER };

describe('the gateway as Traefik\'s ForwardAuth', () => {
  let gateway: FastifyInstance;

  /**
   * Traefik's subrequest about a request: always a GET to the gateway's auth path, the request it is
   * about in X-Forwarded-*, the client's own headers alongside.
   */
  const asked = (
    method: string,
    uri: string,
    headers: Record<string, string> = {},
    protocol = 'https'
  ) => gateway.inject({
    method: 'GET',
    url: FORWARD_AUTH_PATH,
    headers: { 'x-forwarded-method': method, 'x-forwarded-uri': uri, 'x-forwarded-proto': protocol, ...headers }
  });

  /** The cookie an answer set, ready to send back. */
  const cookieOf = (setCookie: string | string[] | number | undefined) => String(setCookie ?? '').split(';', 1)[0];

  /** A session that solved its challenge, asked for and answered at the gateway's own paths. */
  const verifiedSession = async (): Promise<string> => {
    const cookie = cookieOf((await asked('PATCH', '/api/admin/users/3', { 'x-client-signals': signals() }))
      .headers['set-cookie']);
    const challenge = (await gateway.inject({ method: 'GET', url: CHALLENGE_PATH, headers: { cookie } }))
      .json<HumanVerificationChallenge>();
    const verified = await gateway.inject({
      method: 'POST',
      url: VERIFY_PATH,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ payload: await solvedPayload(challenge) })
    });
    expect(verified.statusCode).toBe(200);
    return cookie;
  };

  /** The pass a browser gets for a solved page challenge. */
  const pass = async (): Promise<string> => {
    const challenge = (await gateway.inject({ method: 'GET', url: '/.iqb-gate/page-challenge' }))
      .json<HumanVerificationChallenge>();
    const response = await gateway.inject({
      method: 'POST',
      url: '/.iqb-gate/pass',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'user-agent': BROWSER },
      payload: JSON.stringify({ payload: await solvedPayload(challenge) })
    });
    expect(response.statusCode).toBe(200);
    return cookieOf(response.headers['set-cookie']);
  };

  const auditEntries = async (): Promise<AuditEntry[]> => (await gateway.inject({
    method: 'GET', url: '/.iqb-gate/admin/audit', headers: { authorization: `Bearer ${AUDIT_KEY}` }
  })).json<AuditEntry[]>();

  beforeAll(async () => {
    gateway = await buildGateway(testConfig(undefined, {
      forwardAuth: true,
      trustProxy: ['127.0.0.1'],
      writeGate: {
        enforce: true,
        rules: [{ name: 'administration', path: compilePattern('^/api/admin/', 'test') }],
        exempt: [],
        burst: { limit: 30, windowSeconds: 60 },
        userClaim: undefined
      },
      readGate: {
        enforce: true,
        rules: [{ name: 'units', path: compilePattern('^/api/units(/|$)', 'test') }],
        exempt: [],
        limit: { limit: 600, windowSeconds: 60 },
        userClaim: undefined
      },
      pageGate: {
        enabled: true,
        passDays: 7,
        challengesPerAddressAndMinute: 120,
        texts: DEFAULT_PAGE_TEXTS,
        policy: [{ name: 'ai-crawlers', userAgent: compilePattern('GPTBot', 'test'), action: 'deny' }]
      },
      audit: { file: ':memory:', retentionDays: 90, key: AUDIT_KEY }
    }), false);
    await gateway.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await gateway.close();
  });

  it('answers 400 to a request without the X-Forwarded-* headers Traefik sets', async () => {
    const response = await gateway.inject({ method: 'GET', url: FORWARD_AUTH_PATH });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({ message: expect.stringMatching(/X-Forwarded-Method/) }));
  });

  it('answers 400 when Traefik\'s headers name no single request', async () => {
    const joined = await asked('POST, GET', '/api/admin/users/3', { 'x-client-signals': signals() });
    expect(joined.statusCode).toBe(400);
  });

  it('decides without reading a body Traefik might pass on', async () => {
    // With forwardBody or preserveRequestMethod Traefik sends one; parsed, it would be answered 415 or 400
    const withBody = (headers: Record<string, string>, payload: string) => gateway.inject({
      method: 'POST',
      url: FORWARD_AUTH_PATH,
      headers: {
        'x-forwarded-method': 'POST',
        'x-forwarded-uri': '/api/admin/users',
        'x-forwarded-proto': 'https',
        'x-client-signals': signals(),
        ...headers
      },
      payload
    });
    expect((await withBody({ 'content-type': 'application/json' }, '{ broken')).statusCode).toBe(428);
    expect((await withBody({ 'content-type': 'multipart/form-data; boundary=x' }, '--x--')).statusCode).toBe(428);
    expect((await withBody({}, 'x'.repeat(2 * 1024 * 1024))).statusCode).toBe(428);
  });

  it('is not there unless switched on, and a proxy alone stays as it was', async () => {
    const proxyOnly = await buildGateway(testConfig('http://127.0.0.1:9'), false);
    try {
      const response = await proxyOnly.inject({
        method: 'GET',
        url: FORWARD_AUTH_PATH,
        headers: { 'x-forwarded-method': 'GET', 'x-forwarded-uri': '/', 'x-forwarded-proto': 'https' }
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await proxyOnly.close();
    }
  });

  it('warns at start when it has nothing to check and lets every request through', async () => {
    const logged: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logged.push(chunk.toString());
        done();
      }
    });
    const idle = await buildGateway(testConfig(undefined, { forwardAuth: true }), { level: 'warn', stream });
    try {
      expect(logged.join('')).toMatch(/nothing to check: every request is let through/);
    } finally {
      await idle.close();
    }
  });

  it('lets through what no gate checks, with 200 and nothing else', async () => {
    const response = await asked('GET', '/api/other');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a checked write without a solved challenge, and starts the session for it', async () => {
    const response = await asked('PATCH', '/api/admin/users/3', { 'x-client-signals': signals() });
    expect(response.statusCode).toBe(428);
    expect(response.json()).toEqual(expect.objectContaining({ code: 'human-verification-required' }));
    expect(String(response.headers['set-cookie'])).toMatch(/^__Host-iqb-gate-session=.*; Secure/);
    const plain = await asked('PATCH', '/api/admin/users/3', { 'x-client-signals': signals() }, 'http');
    expect(String(plain.headers['set-cookie'])).toMatch(/^iqb-gate-session=/);
  });

  it('decides on the request Traefik asks about, not on its own subrequest', async () => {
    // The subrequest is a GET to the gateway's own path; the write it asks about is checked
    expect((await asked('DELETE', '/api/admin/users/3', { 'x-client-signals': signals() })).statusCode).toBe(428);
    expect((await asked('GET', '/api/admin/users/3')).statusCode).toBe(200);
  });

  it('refuses a write from an automated browser with 403', async () => {
    const response = await asked('PATCH', '/api/admin/users/3', { 'x-client-signals': signals({ webdriver: true }) });
    expect(response.statusCode).toBe(403);
  });

  it('lets writes and checked reads through once the session solved its challenge', async () => {
    const cookie = await verifiedSession();
    const write = await asked('PATCH', '/api/admin/users/3', { cookie, 'x-client-signals': signals() });
    expect(write.statusCode).toBe(200);
    expect(write.body).toBe('');
    // Traefik would not pass a cookie of a 200 on to the client; none is needed
    expect(write.headers['set-cookie']).toBeUndefined();
    expect((await asked('GET', '/api/units/7', { cookie, 'x-client-signals': signals() })).statusCode).toBe(200);
  });

  it('refuses a checked read of a session without a solved challenge', async () => {
    expect((await asked('GET', '/api/units/7', { 'x-client-signals': signals() })).statusCode).toBe(428);
  });

  it('answers a page opened without a pass with the interstitial, as 401 so that Traefik shows it', async () => {
    const response = await asked('GET', '/workspace?x=1', OPENING);
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('iqb-gate');
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.body).toContain(DEFAULT_PAGE_TEXTS.title.replace('…', '&hellip;').slice(0, 10));
  });

  it('lets a page through with a pass, and leaves plain HTTP alone', async () => {
    const cookie = await pass();
    expect((await asked('GET', '/workspace', { ...OPENING, cookie })).statusCode).toBe(200);
    expect((await asked('GET', '/workspace', OPENING, 'http')).statusCode).toBe(200);
  });

  it('keeps a client the page policy denies out with 403', async () => {
    const response = await asked('GET', '/workspace', { ...OPENING, 'user-agent': 'GPTBot/1.0' });
    expect(response.statusCode).toBe(403);
  });

  it('records the request Traefik asked about, with the gateway\'s own answer', async () => {
    // Over HTTP: an entry takes its status once the answer is sent, which an injected request never is
    const { port } = gateway.server.address() as AddressInfo;
    const askedOverHttp = (method: string, uri: string, headers: Record<string, string>) => fetch(
      `http://127.0.0.1:${port}${FORWARD_AUTH_PATH}`,
      { headers: { 'x-forwarded-method': method, 'x-forwarded-uri': uri, 'x-forwarded-proto': 'https', ...headers } }
    );
    const cookie = await verifiedSession();
    expect((await askedOverHttp('PUT', '/api/admin/settings', { cookie, 'x-client-signals': signals() })).status)
      .toBe(200);
    expect((await askedOverHttp('POST', '/api/admin/groups', { 'x-client-signals': signals() })).status).toBe(428);
    await vi.waitFor(async () => {
      expect(await auditEntries()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: 'PUT', path: '/api/admin/settings', rule: 'administration', statusCode: 200
        }),
        expect.objectContaining({ method: 'POST', path: '/api/admin/groups', statusCode: 428 })
      ]));
    });
  });
});
