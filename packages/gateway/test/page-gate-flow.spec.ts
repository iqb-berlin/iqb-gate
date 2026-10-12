import {
  afterAll, beforeAll, describe, expect, it
} from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { HumanVerificationChallenge } from '@iqb/gate-protocol';
import { buildGateway } from '../src/gateway.js';
import type { GatewayConfig } from '../src/config.js';
import { compilePattern } from '../src/config-helpers.js';
import { deriveSecret } from '../src/proof-of-work.js';
import { issuePass } from '../src/page-gate/page-pass.js';
import { testConfig } from './support/test-config.js';
import { solvedPayload } from './support/solve-challenge.js';

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SECRET = 'test-secret-test-secret-test-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A browser opening a page over HTTPS, as the proxy in front reports it. */
const opening = (headers: Record<string, string> = {}) => ({
  'x-forwarded-proto': 'https',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'user-agent': BROWSER,
  ...headers
});

const upstreamHits: string[] = [];

function startUpstream(): Promise<Server> {
  const server = createServer((request, response) => {
    upstreamHits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<p>the application</p>');
  });
  return new Promise(resolve => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}

const origin = (address: AddressInfo) => `http://127.0.0.1:${address.port}`;


describe('the page gate', () => {
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  const startGateway = async (pageGate: Partial<GatewayConfig['pageGate']> = {}) => {
    const started = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      trustProxy: ['127.0.0.1'],
      secret: SECRET,
      pageGate: {
        enabled: true,
        passDays: 7,
        challengesPerAddressAndMinute: 120,
        policy: [
          { name: 'ai-crawlers', userAgent: compilePattern('GPTBot|CCBot', 'test'), action: 'deny' },
          {
            name: 'uptime',
            userAgent: compilePattern('^UptimeRobot/', 'test'),
            path: compilePattern('^/$', 'test'),
            action: 'allow'
          }
        ],
        ...pageGate
      }
    }), false);
    await started.listen({ host: '127.0.0.1', port: 0 });
    return { started, url: origin(started.server.address() as AddressInfo) };
  };

  /**
   * A request as a browser sends it. Not through `fetch`: it sets `Sec-Fetch-Mode: cors` itself,
   * as browsers keep those headers to themselves.
   */
  const open = async (url: string, headers: Record<string, string>, at = gateway) => {
    const response = await at.inject({ method: 'GET', url, headers });
    return { status: response.statusCode, headers: response.headers, text: response.body };
  };

  /** The pass a browser gets for a solved page challenge: the cookie to send from then on. */
  const passFor = async (userAgent = BROWSER, at = base): Promise<string> => {
    const challenge = await (await fetch(`${at}/.iqb-gate/page-challenge`)).json() as HumanVerificationChallenge;
    const response = await fetch(`${at}/.iqb-gate/pass`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'user-agent': userAgent },
      body: JSON.stringify({ payload: await solvedPayload(challenge) })
    });
    expect(response.status).toBe(200);
    return (response.headers.get('set-cookie') ?? '').split(';', 1)[0];
  };

  beforeAll(async () => {
    upstream = await startUpstream();
    ({ started: gateway, url: base } = await startGateway());
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
  });

  it('hands a browser opening a page the interstitial instead, locked down', async () => {
    const hits = upstreamHits.length;
    const response = await open('/?code=abc&state=xyz', opening());
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.headers['content-security-policy']).toMatch(/script-src 'self'.*worker-src blob:/);
    const page = response.text;
    expect(page).toContain('<altcha-widget id="iqb-gate-widget" challenge="/.iqb-gate/page-challenge" auto="off"');
    expect(page).toContain(`configuration='{"hideLogo":true,"hideFooter":true}'`);
    expect(upstreamHits.length).toBe(hits);
  });

  it('takes an Accept for HTML as a navigation when the browser says nothing else', async () => {
    const response = await open('/', { 'x-forwarded-proto': 'https', accept: 'text/html', 'user-agent': BROWSER });
    expect(response.text).toContain('iqb-gate-widget');
  });

  it('lets everything pass that is no navigation, and everything over plain HTTP', async () => {
    const api = await open('/api/units', {
      'x-forwarded-proto': 'https', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: 'text/html'
    });
    expect(api.text).toBe('<p>the application</p>');
    const plain = await open('/', opening({ 'x-forwarded-proto': 'http' }));
    expect(plain.text).toBe('<p>the application</p>');
  });

  // A crawler need not ask for HTML, nor come over HTTPS
  it('keeps out what the policy denies, whatever the request', async () => {
    const api = await open('/api/units', { 'user-agent': 'GPTBot/1.2', accept: '*/*' });
    expect(api.status).toBe(403);
    expect(JSON.parse(api.text)).toEqual(expect.objectContaining({ statusCode: 403 }));
  });

  it('links its scripts with their version, to be cached for good', async () => {
    const page = (await open('/', opening())).text;
    const [widgetUrl] = /\/\.iqb-gate\/static\/altcha\.js\?v=[0-9a-f]{12}/.exec(page) ?? [];
    const [scriptUrl] = /\/\.iqb-gate\/static\/page-gate\.js\?v=[0-9a-f]{12}/.exec(page) ?? [];
    expect(widgetUrl).toBeDefined();
    expect(scriptUrl).toBeDefined();
    const widget = await fetch(`${base}${widgetUrl}`);
    expect(widget.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  // A browser that does not keep the pass would otherwise solve and reload without end
  it('lets the page stop after one reload that did not bring a pass', async () => {
    const script = await (await fetch(`${base}/.iqb-gate/static/page-gate.js`)).text();
    expect(script).toContain("sessionStorage.setItem(KEY");
    expect(script).toContain('Date.now() - last < 60000');
    expect(script).toContain('widget.verify()');
  });

  it('follows the policy: keeps out what it denies, lets through what it allows', async () => {
    const denied = await open('/', opening({ 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' }));
    expect(denied.status).toBe(403);
    const allowed = await open('/', opening({ 'user-agent': 'UptimeRobot/2.0' }));
    expect(allowed.text).toBe('<p>the application</p>');
  });

  it('serves the widget and its own script', async () => {
    const widget = await fetch(`${base}/.iqb-gate/static/altcha.js`);
    expect(widget.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await widget.text()).toContain('customElements.define');
    const script = await fetch(`${base}/.iqb-gate/static/page-gate.js`);
    expect(await script.text()).toContain("fetch('/.iqb-gate/pass'");
  });

  it('lets the browser in with the pass it got for a solved challenge', async () => {
    const cookie = await passFor();
    expect(cookie).toMatch(/^__Host-iqb-gate-pass=/);
    const response = await open('/', opening({ cookie }));
    expect(response.text).toBe('<p>the application</p>');
  }, 30000);

  it('sets the pass as a secure, script-proof cookie for its days', async () => {
    const challenge = await (await fetch(`${base}/.iqb-gate/page-challenge`)).json() as HumanVerificationChallenge;
    const response = await fetch(`${base}/.iqb-gate/pass`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'user-agent': BROWSER },
      body: JSON.stringify({ payload: await solvedPayload(challenge) })
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/Max-Age=604800/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  }, 30000);

  it('does not let another browser in with a copied pass', async () => {
    const cookie = await passFor();
    const response = await open('/', opening({ cookie, 'user-agent': 'python-requests/2.32' }));
    expect(response.text).toContain('iqb-gate-widget');
  }, 30000);

  it('asks again once the pass has expired', async () => {
    const expired = issuePass(deriveSecret(SECRET, 'page-pass'), BROWSER, Date.now() - 8 * DAY_MS, 7);
    const response = await open('/', opening({ cookie: `__Host-iqb-gate-pass=${expired}` }));
    expect(response.text).toContain('iqb-gate-widget');
  });

  it('gives a pass only over HTTPS, and for a solution only once', async () => {
    const challenge = await (await fetch(`${base}/.iqb-gate/page-challenge`)).json() as HumanVerificationChallenge;
    const payload = await solvedPayload(challenge);
    const hand = (proto: string) => fetch(`${base}/.iqb-gate/pass`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': proto },
      body: JSON.stringify({ payload })
    });
    expect((await hand('http')).status).toBe(400);
    expect((await hand('https')).status).toBe(200);
    expect((await hand('https')).status).toBe(400);
  }, 30000);

  it('hands each address only so many challenges a minute', async () => {
    const { started, url } = await startGateway({ challengesPerAddressAndMinute: 2 });
    const statuses = await Array.from({ length: 3 }).reduce<Promise<number[]>>(
      async earlier => [...await earlier, (await fetch(`${url}/.iqb-gate/page-challenge`)).status],
      Promise.resolve([])
    );
    expect(statuses).toEqual([200, 200, 429]);
    await started.close();
  });

  it('changes nothing when it is off', async () => {
    const { started, url } = await startGateway({ enabled: false });
    expect((await open('/', opening(), started)).text).toBe('<p>the application</p>');
    expect((await fetch(`${url}/.iqb-gate/page-challenge`)).status).toBe(404);
    await started.close();
  });
});
