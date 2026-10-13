import type { GatewayConfig } from '../../src/config.js';

/** A gateway configuration for tests: no checked writes or reads, the audit log in memory. */
export function testConfig(upstream: string, changes: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    upstream,
    upstreams: [],
    host: '127.0.0.1',
    port: 0,
    trustProxy: false,
    timeouts: { defaultSeconds: 5, paths: [] },
    secret: 'test-secret-test-secret-test-secret',
    writeGate: { enforce: true, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined },
    readGate: { enforce: true, rules: [], exempt: [], limit: { limit: 600, windowSeconds: 60 }, userClaim: undefined },
    challenges: { perAddressAndMinute: 120 },
    pageGate: { enabled: false, passDays: 7, challengesPerAddressAndMinute: 120, policy: [] },
    oidc: undefined,
    audit: { file: ':memory:', retentionDays: 90, key: undefined },
    ...changes
  };
}
