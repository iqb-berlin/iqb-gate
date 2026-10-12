import type { GatewayConfig } from '../../src/config.js';

/** A gateway configuration for tests: no checked writes, the audit log in memory. */
export function testConfig(upstream: string, changes: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    upstream,
    host: '127.0.0.1',
    port: 0,
    trustProxy: false,
    timeouts: { defaultSeconds: 5, paths: [] },
    secret: 'test-secret-test-secret-test-secret',
    writeGate: { enforce: true, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined },
    pageGate: { enabled: false, passDays: 7, challengesPerAddressAndMinute: 120, policy: [] },
    oidc: undefined,
    audit: { file: ':memory:', retentionDays: 90, key: undefined },
    ...changes
  };
}
