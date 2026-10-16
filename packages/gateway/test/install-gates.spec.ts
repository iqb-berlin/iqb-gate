import { describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { FakeProvider } from '@iqb/gate-oidc/testing';
import { buildGateway } from '../src/gateway.js';
import { testConfig } from './support/test-config.js';

/** The gateway's warnings at start, as its logger writes them. */
const warningsAtStart = async (trustProxy: false | string[]): Promise<string[]> => {
  const lines: string[] = [];
  const gateway = await buildGateway(testConfig('http://127.0.0.1:9', {
    trustProxy,
    writeGate: {
      enforce: true,
      rules: [{ name: 'administration', path: /^\/api\/admin\//i }],
      exempt: [],
      burst: { limit: 30, windowSeconds: 60 },
      userClaim: undefined
    }
  }), { level: 'warn', stream: { write: (line: string) => { lines.push(line); } } });
  await gateway.close();
  return lines.map(line => (JSON.parse(line) as { msg: string }).msg);
};

describe('installGates', () => {
  // Behind Traefik without it, the gateway sees Traefik's address for everyone
  it('warns when gates check and no proxy is trusted', async () => {
    expect(await warningsAtStart(false)).toEqual([expect.stringContaining('IQB_GATE_TRUST_PROXY')]);
  });

  it('says nothing when the proxy in front is trusted', async () => {
    expect(await warningsAtStart(['172.18.0.0/16'])).toEqual([]);
  });

  // Tokens still name their writers then, but someone should look at the provider
  it('warns when the provider\'s keys cannot be fetched again and the ones fetched before are used', async () => {
    const provider = new FakeProvider();
    await provider.start();
    const lines: string[] = [];
    const gateway = await buildGateway(testConfig('http://127.0.0.1:9', {
      trustProxy: ['127.0.0.1/32'],
      writeGate: {
        enforce: true,
        rules: [{ name: 'administration', path: /^\/api\/admin\//i }],
        exempt: [],
        burst: { limit: 30, windowSeconds: 60 },
        userClaim: 'sub'
      },
      oidc: { issuer: provider.issuer, clientId: 'studio' }
    }), { level: 'warn', stream: { write: (line: string) => { lines.push(line); } } });
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    const url = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
    // Refused without the browser's report; the audit log names the writer through the token
    const write = async () => fetch(`${url}/api/admin/users`, {
      method: 'POST', headers: { authorization: `Bearer ${await provider.sign()}` }
    });
    try {
      await write();
      await vi.waitFor(() => expect(provider.jwksFetches).toBe(1));
      provider.keysAnswer = 503;
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60 * 1000 });
      await write();
      // The writer is named once the answer is out
      await vi.waitFor(() => expect(lines.map(line => (JSON.parse(line) as { msg: string }).msg))
        .toContainEqual(expect.stringContaining('keys are not current')));
    } finally {
      vi.useRealTimers();
      await gateway.close();
      await provider.stop();
    }
  });
});
