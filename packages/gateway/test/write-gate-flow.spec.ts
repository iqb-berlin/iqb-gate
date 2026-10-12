import {
  afterAll, beforeAll, describe, expect, it, vi
} from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import {
  CHALLENGE_PATH, type ClientSignals, type HumanVerificationChallenge, VERIFY_PATH
} from '@iqb/gate-protocol';
import { buildGateway } from '../src/gateway.js';
import type { GatewayConfig } from '../src/config.js';
import type { AuditEntry } from '../src/audit/audit-log.js';
import { compilePattern } from '../src/config-helpers.js';
import { testConfig } from './support/test-config.js';
import { STREAM_BODY } from './support/stream-body.js';

const AUDIT_KEY = 'audit-key-audit-key-audit-key-1234';

const PERSON: ClientSignals = {
  webdriver: false,
  headless: false,
  untrustedInput: false,
  msSinceTrustedInput: 500,
  softwareRenderer: false,
  devtoolsProtocol: false
};
const signals = (changes: Partial<ClientSignals> = {}) => JSON.stringify({ ...PERSON, ...changes });

/** A JWT as studio-lite issues it; the gateway reads its claim without verifying it. */
const bearer = (username: string) => `Bearer ${[
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ username })).toString('base64url'),
  'signature'
].join('.')}`;

/** The stub application: counts what reaches it and how many bytes; `/hang` never answers. */
const upstreamHits: string[] = [];
let firstChunkArrived: () => void = () => {};

function startUpstream(): Promise<Server> {
  const server = createServer((request, response) => {
    upstreamHits.push(`${request.method} ${request.url}`);
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      firstChunkArrived();
    });
    if (request.url?.endsWith('/hang')) return;
    request.on('end', () => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ saved: true, bytes }));
    });
  });
  return new Promise(resolve => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}

const origin = (address: AddressInfo) => `http://127.0.0.1:${address.port}`;

/** The cookie a response set, ready to send back. */
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';', 1)[0];
}

/** What the ALTCHA widget hands over after solving a challenge. */
async function solvedPayload(challenge: HumanVerificationChallenge): Promise<string> {
  const solution = await solveChallenge({
    challenge: challenge as Parameters<typeof solveChallenge>[0]['challenge'],
    deriveKey
  });
  return Buffer.from(JSON.stringify({
    challenge: { parameters: challenge.parameters, signature: challenge.signature },
    solution
  })).toString('base64');
}

const STUDIO_LITE_RULES: Pick<GatewayConfig['writeGate'], 'rules' | 'exempt'> = {
  rules: [
    { name: 'administration', path: compilePattern('^/api/(admin|group-admin|workspace-groups)/', 'test') },
    { name: 'workspace', path: compilePattern('^/api/workspaces/[^/]+(/|$)', 'test') }
  ],
  exempt: [
    { method: 'POST', path: compilePattern('^/api/workspaces/[^/]+/download-units$', 'test') },
    { bearerPrefix: 'sl_' }
  ]
};

describe('the write gate', () => {
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  const startGateway = async (changes: Partial<GatewayConfig['writeGate']> = {}, audit = {}) => {
    const started = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      writeGate: {
        enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: 'username', ...STUDIO_LITE_RULES, ...changes
      },
      audit: { file: ':memory:', retentionDays: 90, key: AUDIT_KEY, ...audit }
    }), false);
    await started.listen({ host: '127.0.0.1', port: 0 });
    return { started, url: origin(started.server.address() as AddressInfo) };
  };

  const auditEntries = async (at = base): Promise<AuditEntry[]> => {
    const response = await fetch(`${at}/.iqb-gate/admin/audit`, { headers: { authorization: `Bearer ${AUDIT_KEY}` } });
    return await response.json() as AuditEntry[];
  };

  /** A session as a checked write starts it, with its 428: the cookie to send from then on. */
  const startedSession = async (at = base): Promise<string> => cookieFrom(await fetch(`${at}/api/admin/users/3`, {
    method: 'PATCH', headers: { 'x-client-signals': signals() }, body: '{}'
  }));

  /** A session that solved its challenge: the cookie to send with its writes. */
  const verifiedSession = async (at = base): Promise<string> => {
    const cookie = await startedSession(at);
    const challengeResponse = await fetch(`${at}${CHALLENGE_PATH}`, { headers: { cookie } });
    const payload = await solvedPayload(await challengeResponse.json() as HumanVerificationChallenge);
    const verified = await fetch(`${at}${VERIFY_PATH}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ payload })
    });
    expect(verified.status).toBe(200);
    return cookie;
  };

  beforeAll(async () => {
    upstream = await startUpstream();
    ({ started: gateway, url: base } = await startGateway());
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
  });

  it('never checks a read, nor a write outside the rules', async () => {
    expect((await fetch(`${base}/api/admin/users`)).status).toBe(201);
    expect((await fetch(`${base}/api/login`, { method: 'POST', body: '{}' })).status).toBe(201);
  });

  it('rejects a write without the browser\'s report as automated, before it reaches the application', async () => {
    const hits = upstreamHits.length;
    const response = await fetch(`${base}/api/admin/users/3`, { method: 'PATCH', body: '{}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'automation-detected', signals: ['signals-missing']
    }));
    expect(upstreamHits.length).toBe(hits);
  });

  it('rejects a browser that reports automation, naming why', async () => {
    const response = await fetch(`${base}/api/admin/users/3`, {
      method: 'PATCH', headers: { 'x-client-signals': signals({ webdriver: true }) }, body: '{}'
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { signals: string[] }).signals).toEqual(['webdriver']);
  });

  it('asks a person without a session for the challenge, and starts the session', async () => {
    const hits = upstreamHits.length;
    const response = await fetch(`${base}/api/admin/users/3`, {
      method: 'PATCH', headers: { 'x-client-signals': signals() }, body: '{}'
    });
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'human-verification-required' }));
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^iqb-gate-session=[^;]+;/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(upstreamHits.length).toBe(hits);
  });

  it('lets the write through once the session solved its challenge, and logs who wrote', async () => {
    const cookie = await verifiedSession();
    const response = await fetch(`${base}/api/workspaces/5/units/9?x=1`, {
      method: 'PATCH', headers: { cookie, 'x-client-signals': signals(), authorization: bearer('anna') }, body: '{}'
    });
    expect(response.status).toBe(201);
    expect(upstreamHits).toContain('PATCH /api/workspaces/5/units/9?x=1');
    await vi.waitFor(async () => {
      expect(await auditEntries()).toContainEqual(expect.objectContaining({
        outcome: 'allowed', statusCode: 201, user: 'anna', rule: 'workspace', path: '/api/workspaces/5/units/9'
      }));
    });
  }, 30000);

  it('accepts a solution only with the session cookie, and only a real one', async () => {
    const noSession = await fetch(`${base}${VERIFY_PATH}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"payload":"x"}'
    });
    expect(noSession.status).toBe(400);
    const wrong = await fetch(`${base}${VERIFY_PATH}`, {
      method: 'POST',
      headers: { cookie: await startedSession(), 'content-type': 'application/json' },
      body: '{"payload":"bm90IGEgcGF5bG9hZA=="}'
    });
    expect(wrong.status).toBe(400);
  });

  it('hands a challenge only to a session the gateway started', async () => {
    expect((await fetch(`${base}${CHALLENGE_PATH}`)).status).toBe(400);
    const forged = await fetch(`${base}${CHALLENGE_PATH}`, {
      headers: { cookie: 'iqb-gate-session=forged.signature' }
    });
    expect(forged.status).toBe(400);
  });

  // A challenge costs the gateway a key derivation: a loop must not keep it busy
  it('hands each address only so many challenges a minute', async () => {
    const { started, url } = await startGateway();
    const cookie = await startedSession(url);
    const statuses = await Array.from({ length: 31 }).reduce<Promise<number[]>>(
      async (earlier) => [...await earlier, (await fetch(`${url}${CHALLENGE_PATH}`, { headers: { cookie } })).status],
      Promise.resolve([])
    );
    expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    await started.close();
  });

  it('streams a checked upload on to the application, not after buffering it', async () => {
    const cookie = await verifiedSession();
    const arrived = new Promise<void>(resolve => { firstChunkArrived = resolve; });
    let sent = 0;
    // The rest of the body is only sent once the application has the first chunk
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === 16) {
          controller.close();
          return;
        }
        if (sent === 1) await arrived;
        sent += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      }
    });
    const response = await fetch(`${base}/api/admin/upload`, {
      method: 'POST', headers: { cookie, 'x-client-signals': signals() }, body, ...STREAM_BODY
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { bytes: number }).bytes).toBe(16 * 1024 * 1024);
    firstChunkArrived = () => {};
  }, 30000);

  it('answers 428 to a large upload without a session at once, without passing it on', async () => {
    const hits = upstreamHits.length;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        Array.from({ length: 64 }).forEach(() => controller.enqueue(new Uint8Array(1024 * 1024)));
        controller.close();
      }
    });
    const response = await fetch(`${base}/api/admin/upload`, {
      method: 'POST', headers: { 'x-client-signals': signals() }, body, ...STREAM_BODY
    });
    expect(response.status).toBe(428);
    expect(upstreamHits.length).toBe(hits);
  }, 30000);

  it('does not take a cookie it did not sign', async () => {
    const response = await fetch(`${base}/api/admin/users/3`, {
      method: 'PATCH',
      headers: { cookie: 'iqb-gate-session=forged.signature', 'x-client-signals': signals() },
      body: '{}'
    });
    expect(response.status).toBe(428);
    expect(cookieFrom(response)).not.toBe('iqb-gate-session=forged.signature');
  });

  it('lets exempted writes through unchecked', async () => {
    const script = await fetch(`${base}/api/workspaces/5/units/9/properties`, {
      method: 'PATCH', headers: { authorization: 'Bearer sl_1_secret' }, body: '{}'
    });
    expect(script.status).toBe(201);
    const download = await fetch(`${base}/api/workspaces/5/download-units`, { method: 'POST', body: '{}' });
    expect(download.status).toBe(201);
  });

  it('folds identical rejections into one entry, also of a client that keeps no cookie', async () => {
    const reject = (path: string) => fetch(`${base}${path}`, {
      method: 'PUT', headers: { authorization: bearer('looping-script') }, body: '{}'
    });
    await reject('/api/admin/settings/1');
    // A script that varies the path cannot write a row per request either
    await reject('/api/admin/settings/2');
    await reject('/api/admin/settings/3');
    await vi.waitFor(async () => {
      const entries = (await auditEntries()).filter(entry => entry.user === 'looping-script');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(expect.objectContaining({
        path: '/api/admin/settings/1', statusCode: 403, repeated: 2, sessionId: null
      }));
    });
  });

  it('keeps the rejections of different users apart', async () => {
    const reject = (user: string) => fetch(`${base}/api/admin/groups/1`, {
      method: 'PUT', headers: { authorization: bearer(user) }, body: '{}'
    });
    await reject('bert');
    await reject('carla');
    await vi.waitFor(async () => {
      const users = (await auditEntries())
        .filter(entry => entry.path === '/api/admin/groups/1')
        .map(entry => entry.user);
      expect(users.sort()).toEqual(['bert', 'carla']);
    });
  });

  it('logs a write whose client left before the answer as 499', async () => {
    const cookie = await verifiedSession();
    const abort = new AbortController();
    const pending = fetch(`${base}/api/admin/users/hang`, {
      method: 'POST', headers: { cookie, 'x-client-signals': signals() }, body: '{}', signal: abort.signal
    }).catch(() => undefined);
    await vi.waitFor(() => expect(upstreamHits).toContain('POST /api/admin/users/hang'));
    abort.abort();
    await pending;
    await vi.waitFor(async () => {
      expect(await auditEntries())
        .toContainEqual(expect.objectContaining({ path: '/api/admin/users/hang', statusCode: 499 }));
    });
  }, 30000);

  it('asks for the challenge again after a burst of writes', async () => {
    const { started, url } = await startGateway({ burst: { limit: 2, windowSeconds: 60 } });
    const cookie = await verifiedSession(url);
    const write = () => fetch(`${url}/api/admin/users/3`, {
      method: 'PATCH', headers: { cookie, 'x-client-signals': signals() }, body: '{}'
    });
    expect((await write()).status).toBe(201);
    expect((await write()).status).toBe(201);
    expect((await write()).status).toBe(428);
    await started.close();
  }, 30000);

  it('names the session cookie __Host- and Secure over HTTPS', async () => {
    const https = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      trustProxy: true,
      writeGate: { enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined, ...STUDIO_LITE_RULES }
    }), false);
    const response = await https.inject({
      method: 'PATCH',
      url: '/api/admin/users/3',
      headers: { 'x-forwarded-proto': 'https', 'x-client-signals': signals() },
      payload: '{}'
    });
    expect(response.statusCode).toBe(428);
    expect(response.headers['set-cookie']).toMatch(/^__Host-iqb-gate-session=[^;]+;.*Secure/);
    await https.close();
  });

  it('checks nothing when not enforced, and offers no challenge', async () => {
    const { started, url } = await startGateway({ enforce: false });
    const write = await fetch(`${url}/api/admin/users/3`, { method: 'PATCH', body: '{}' });
    expect(write.status).toBe(201);
    expect((await fetch(`${url}${CHALLENGE_PATH}`)).status).toBe(404);
    await started.close();
  });

  describe('the audit page', () => {
    it('wants the key, and asks the browser for it', async () => {
      const response = await fetch(`${base}/.iqb-gate/admin/audit`);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/^Basic realm="iqb-gate audit"/);
      const wrongKey = await fetch(`${base}/.iqb-gate/admin/`, { headers: { authorization: 'Bearer wrong' } });
      expect(wrongKey.status).toBe(401);
    });

    it('serves the page for the key as password, locked down', async () => {
      const authorization = `Basic ${Buffer.from(`admin:${AUDIT_KEY}`).toString('base64')}`;
      const response = await fetch(`${base}/.iqb-gate/admin/`, { headers: { authorization } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/html/);
      expect(response.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toContain('<title>iqb-gate · Schreibzugriffe</title>');
    });

    it('does not exist without a key', async () => {
      const { started, url } = await startGateway({}, { key: undefined });
      const entries = await fetch(`${url}/.iqb-gate/admin/audit`, { headers: { authorization: 'Bearer x' } });
      expect(entries.status).toBe(404);
      expect((await fetch(`${url}/.iqb-gate/admin/`)).status).toBe(404);
      await started.close();
    });
  });
});
