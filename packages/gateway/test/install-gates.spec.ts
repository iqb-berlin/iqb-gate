import { describe, expect, it } from 'vitest';
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
});
