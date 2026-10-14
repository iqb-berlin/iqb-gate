import {
  afterAll, beforeAll, describe, expect, it, vi
} from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import {
  CHALLENGE_PATH, type ClientSignals, type HumanVerificationChallenge, VERIFY_PATH
} from '@iqb/gate-protocol';
import { buildGateway } from '../src/gateway.js';
import type { GatewayConfig } from '../src/config.js';
import { AuditLog, type AuditEntry } from '../src/audit/audit-log.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePattern } from '../src/config-helpers.js';
import { DEFAULT_PAGE_TEXTS } from '../src/page-gate/page-texts.js';
import { Writable } from 'node:stream';
import { testConfig } from './support/test-config.js';
import { FakeProvider, foreignToken } from '@iqb/gate-oidc/testing';
import { STREAM_BODY } from './support/stream-body.js';
import { solvedPayload } from './support/solve-challenge.js';

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

  const startGateway = async (
    changes: Partial<GatewayConfig['writeGate']> = {},
    audit = {},
    gatewayChanges: Partial<GatewayConfig> = {}
  ) => {
    const started = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      writeGate: {
        enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: 'username', ...STUDIO_LITE_RULES, ...changes
      },
      audit: { file: ':memory:', retentionDays: 90, key: AUDIT_KEY, ...audit },
      ...gatewayChanges
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

  it('leaves a write the page policy kept out alone: no gate checks it after the answer', async () => {
    // The checks run in turn until one answers. A check that answered used to hand back the reply,
    // which a promise settles only once it is sent -- and then as undefined: the write gate ran on
    // and sent its own answer on top of the page policy's.
    const warnings: string[] = [];
    const logged = new Writable({
      write(chunk: Buffer, _encoding, done) {
        warnings.push(chunk.toString());
        done();
      }
    });
    const crawlerGateway = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      trustProxy: ['127.0.0.1'],
      writeGate: {
        enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined, ...STUDIO_LITE_RULES
      },
      pageGate: {
        enabled: true,
        passDays: 7,
        challengesPerAddressAndMinute: 120,
        texts: DEFAULT_PAGE_TEXTS,
        policy: [{ name: 'ai-crawlers', userAgent: compilePattern('GPTBot', 'test'), action: 'deny' }]
      }
    }), { level: 'warn', stream: logged });
    try {
      const hits = upstreamHits.length;
      const response = await crawlerGateway.inject({
        method: 'PATCH', url: '/api/admin/users/3', headers: { 'user-agent': 'GPTBot/1.0' }, payload: '{}'
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(expect.objectContaining({ message: 'This client is not allowed here.' }));
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(upstreamHits.length).toBe(hits);
      expect(warnings.join('')).not.toMatch(/already sent/i);
    } finally {
      await crawlerGateway.close();
    }
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
  it('hands each address only as many challenges a minute as configured', async () => {
    const { started, url } = await startGateway({}, {}, { challenges: { perAddressAndMinute: 5 } });
    const cookie = await startedSession(url);
    const statuses = await Array.from({ length: 6 }).reduce<Promise<number[]>>(
      async (earlier) => [...await earlier, (await fetch(`${url}${CHALLENGE_PATH}`, { headers: { cookie } })).status],
      Promise.resolve([])
    );
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
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

  // A script can put a new name into an unsigned token for every request
  it('folds the rejections of names nobody verified, coming from one address', async () => {
    const { started, url } = await startGateway();
    try {
      const reject = (user: string) => fetch(`${url}/api/admin/groups/1`, {
        method: 'PUT', headers: { authorization: bearer(user) }, body: '{}'
      });
      await reject('bert');
      await reject('carla');
      await vi.waitFor(async () => {
        const entries = (await auditEntries(url)).filter(entry => entry.path === '/api/admin/groups/1');
        expect(entries).toEqual([expect.objectContaining({ user: 'bert', repeated: 1 })]);
      });
    } finally {
      await started.close();
    }
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
      trustProxy: ['127.0.0.1'],
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
      expect(await response.text()).toContain('<title>iqb-gate · Zugriffe</title>');
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

describe('the write gate with an OpenID Connect provider', () => {
  const provider = new FakeProvider();
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    await provider.start();
    upstream = await startUpstream();
    gateway = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      writeGate: {
        enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: 'preferred_username', ...STUDIO_LITE_RULES
      },
      oidc: { issuer: provider.issuer, clientId: 'studio' },
      audit: { file: ':memory:', retentionDays: 90, key: AUDIT_KEY }
    }), false);
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    base = origin(gateway.server.address() as AddressInfo);
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
    await provider.stop();
  });

  const entriesFor = async (path: string): Promise<AuditEntry[]> => {
    const response = await fetch(`${base}/.iqb-gate/admin/audit`, {
      headers: { authorization: `Bearer ${AUDIT_KEY}` }
    });
    return (await response.json() as AuditEntry[]).filter(entry => entry.path === path);
  };

  it('names the writer of a token the provider signed as verified, and any other as not', async () => {
    await fetch(`${base}/api/admin/users/1`, {
      method: 'PATCH', headers: { authorization: `Bearer ${await provider.sign()}` }, body: '{}'
    });
    // A forged token may name anyone; the log says it was not checked
    const forged = await foreignToken(provider.issuer, { preferred_username: 'anna' });
    await fetch(`${base}/api/admin/users/2`, {
      method: 'PATCH', headers: { authorization: `Bearer ${forged}` }, body: '{}'
    });
    await vi.waitFor(async () => {
      expect(await entriesFor('/api/admin/users/1')).toEqual([
        expect.objectContaining({ user: 'anna', userVerified: true, statusCode: 403 })
      ]);
      expect(await entriesFor('/api/admin/users/2')).toEqual([
        expect.objectContaining({ user: 'anna', userVerified: false, statusCode: 403 })
      ]);
    });
  });
});

describe('the write gate closing', () => {
  it('writes the entries whose writer is still being named before the log closes', async () => {
    // A provider that answers its discovery late: the writer is still being named when the gateway closes
    const slow = createServer((_request, response) => {
      setTimeout(() => response.writeHead(503).end(), 500);
    });
    await new Promise<void>(resolve => { slow.listen(0, '127.0.0.1', () => resolve()); });
    const upstream = await startUpstream();
    const directory = mkdtempSync(join(tmpdir(), 'iqb-gate-close-'));
    const file = join(directory, 'audit.sqlite');
    const gateway = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      writeGate: { enforce: true, burst: { limit: 30, windowSeconds: 60 }, userClaim: 'sub', ...STUDIO_LITE_RULES },
      oidc: { issuer: `http://127.0.0.1:${(slow.address() as AddressInfo).port}/realms/iqb` },
      audit: { file, retentionDays: 90, key: undefined }
    }), false);

    await gateway.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${origin(gateway.server.address() as AddressInfo)}/api/admin/users/1`, {
      method: 'PATCH', headers: { authorization: bearer('closing') }, body: '{}'
    });
    expect(response.status).toBe(403);
    await gateway.close();

    const reopened = new AuditLog(file, 90 * 24 * 60 * 60 * 1000, () => {});
    expect(reopened.find()).toEqual([expect.objectContaining({ path: '/api/admin/users/1', statusCode: 403 })]);
    reopened.close();
    await new Promise(resolve => { upstream.close(resolve); });
    await new Promise(resolve => { slow.close(resolve); });
    rmSync(directory, { recursive: true });
  });
});
