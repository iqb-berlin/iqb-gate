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
import type { AuditEntry } from '../src/audit/audit-log.js';
import { compilePattern } from '../src/config-helpers.js';
import { testConfig } from './support/test-config.js';
import { solvedPayload } from './support/solve-challenge.js';

const AUDIT_KEY = 'audit-key-audit-key-audit-key-1234';

const PERSON: ClientSignals = {
  webdriver: false,
  headless: false,
  untrustedInput: false,
  msSinceTrustedInput: null,
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

/** The stub application: records what reaches it and answers every request with 200. */
const upstreamHits: string[] = [];

function startUpstream(): Promise<Server> {
  const server = createServer((request, response) => {
    upstreamHits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"data":true}');
  });
  return new Promise(resolve => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}

const origin = (address: AddressInfo) => `http://127.0.0.1:${address.port}`;

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0];
}

const rule = (name: string, path: string) => ({ name, path: compilePattern(path, 'test') });

/** The rules studio-lite gives its reads, and what it leaves open. */
const STUDIO_LITE_READS: Pick<GatewayConfig['readGate'], 'rules' | 'exempt'> = {
  rules: [rule('administration', '^/api/(admin|group-admin|workspace-groups)/'), rule('workspace', '^/api/workspaces/'),
    rule('other', '^/api/')],
  exempt: [
    { path: compilePattern('^/api/admin/settings/(config|app-logo)$', 'test') },
    { path: compilePattern('^/api/packages/', 'test') }
  ]
};

describe('the read gate', () => {
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  const startGateway = async (config: Partial<GatewayConfig> = {}) => {
    const started = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      writeGate: {
        enforce: true,
        rules: [rule('login', '^/api/login$')],
        exempt: [],
        burst: { limit: 30, windowSeconds: 60 },
        userClaim: 'username'
      },
      readGate: {
        enforce: true, limit: { limit: 600, windowSeconds: 60 }, userClaim: 'username', ...STUDIO_LITE_READS
      },
      audit: { file: ':memory:', retentionDays: 90, key: AUDIT_KEY },
      ...config
    }), false);
    await started.listen({ host: '127.0.0.1', port: 0 });
    return { started, url: origin(started.server.address() as AddressInfo) };
  };

  const auditEntries = async (at = base): Promise<AuditEntry[]> => {
    const response = await fetch(`${at}/.iqb-gate/admin/audit`, { headers: { authorization: `Bearer ${AUDIT_KEY}` } });
    return await response.json() as AuditEntry[];
  };

  /** Solves the challenge for the session of `cookie`. */
  const verify = async (cookie: string, at = base): Promise<void> => {
    const challengeResponse = await fetch(`${at}${CHALLENGE_PATH}`, { headers: { cookie } });
    const payload = await solvedPayload(await challengeResponse.json() as HumanVerificationChallenge);
    const verified = await fetch(`${at}${VERIFY_PATH}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ payload })
    });
    expect(verified.status).toBe(200);
  };

  /** A read as the library in a person's browser sends it. */
  const read = (path: string, cookie?: string, at = base) => fetch(`${at}${path}`, {
    headers: { 'x-client-signals': signals(), authorization: bearer('anna'), ...(cookie ? { cookie } : {}) }
  });

  beforeAll(async () => {
    upstream = await startUpstream();
    ({ started: gateway, url: base } = await startGateway());
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
  });

  it('rejects a read without the browser\'s report as automated, before it reaches the application', async () => {
    const hits = upstreamHits.length;
    const response = await fetch(`${base}/api/workspaces/5/units`, { headers: { authorization: bearer('agent') } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'automation-detected', signals: ['signals-missing']
    }));
    expect(upstreamHits.length).toBe(hits);
    await vi.waitFor(async () => {
      expect(await auditEntries()).toContainEqual(expect.objectContaining({
        method: 'GET', path: '/api/workspaces/5/units', rule: 'workspace', statusCode: 403, user: 'agent',
        outcome: 'automation-detected'
      }));
    });
  });

  it('rejects a browser that reports automation, naming why', async () => {
    const response = await fetch(`${base}/api/admin/users`, {
      headers: { 'x-client-signals': signals({ webdriver: true }) }
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { signals: string[] }).signals).toEqual(['webdriver']);
  });

  it('asks a person\'s browser without a solved challenge for one, and starts the session', async () => {
    const response = await read('/api/workspaces/5');
    expect(response.status).toBe(428);
    expect(cookieFrom(response)).toMatch(/^iqb-gate-session=/);
  });

  it('lets the reads of a session through once it solved the challenge, and logs none of them', async () => {
    const cookie = cookieFrom(await read('/api/workspaces/6'));
    await verify(cookie);

    const response = await read('/api/workspaces/6/units?x=1', cookie);

    expect(response.status).toBe(200);
    expect(upstreamHits).toContain('GET /api/workspaces/6/units?x=1');
    expect((await auditEntries()).filter(entry => entry.path.startsWith('/api/workspaces/6/units'))).toEqual([]);
  }, 30000);

  // A person solves one challenge, at the login, and then reads without being asked again
  it('counts the challenge solved for a login for the reads as well', async () => {
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'x-client-signals': signals() } });
    expect(login.status).toBe(428);
    const cookie = cookieFrom(login);
    await verify(cookie);

    expect((await read('/api/my-data', cookie)).status).toBe(200);
  }, 30000);

  it('lets exempted reads and reads outside the rules through without a report', async () => {
    expect((await fetch(`${base}/api/admin/settings/config`)).status).toBe(200);
    expect((await fetch(`${base}/api/packages/GeoGebra/deployggb.js`)).status).toBe(200);
    expect((await fetch(`${base}/assets/i18n/de.json`)).status).toBe(200);
    expect((await fetch(`${base}/api/packages/../workspaces/5`)).status).toBe(403);
  });

  // A gateway of its own: the refusals of the other tests come from the same address and would fold in
  it('folds the same refused read, repeated within a minute, into one entry', async () => {
    const { started, url } = await startGateway();
    try {
      const paths = ['/api/workspaces/7/a', '/api/workspaces/7/b', '/api/workspaces/7/c'];
      await paths.reduce(async (earlier, path) => {
        await earlier;
        await fetch(`${url}${path}`, { headers: { authorization: bearer('looper') } });
      }, Promise.resolve());
      await vi.waitFor(async () => {
        const entries = await auditEntries(url);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual(expect.objectContaining({ user: 'looper', repeated: 2 }));
      });
    } finally {
      await started.close();
    }
  });

  it('asks for the challenge again past the read limit', async () => {
    const { started, url } = await startGateway({
      readGate: { enforce: true, limit: { limit: 2, windowSeconds: 60 }, userClaim: 'username', ...STUDIO_LITE_READS }
    });
    try {
      const cookie = cookieFrom(await read('/api/workspaces/5', undefined, url));
      await verify(cookie, url);
      const statuses = [];
      statuses.push((await read('/api/workspaces/5', cookie, url)).status);
      statuses.push((await read('/api/workspaces/5', cookie, url)).status);
      statuses.push((await read('/api/workspaces/5', cookie, url)).status);
      expect(statuses).toEqual([200, 200, 428]);
    } finally {
      await started.close();
    }
  }, 30000);

  it('works without any write rule: challenge and audit page are there for the reads', async () => {
    const { started, url } = await startGateway({
      writeGate: { enforce: true, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined }
    });
    try {
      const cookie = cookieFrom(await read('/api/workspaces/5', undefined, url));
      expect((await fetch(`${url}${CHALLENGE_PATH}`, { headers: { cookie } })).status).toBe(200);
      expect((await auditEntries(url)).length).toBe(1);
    } finally {
      await started.close();
    }
  });

  it('checks no read when not enforced', async () => {
    const { started, url } = await startGateway({
      readGate: {
        enforce: false, limit: { limit: 600, windowSeconds: 60 }, userClaim: undefined, ...STUDIO_LITE_READS
      },
      writeGate: {
        enforce: false, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined
      }
    });
    try {
      expect((await fetch(`${url}/api/workspaces/5`)).status).toBe(200);
      expect((await fetch(`${url}${CHALLENGE_PATH}`)).status).toBe(404);
    } finally {
      await started.close();
    }
  });
});
