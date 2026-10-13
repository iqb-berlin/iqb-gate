import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config.js';

const UPSTREAM = { IQB_GATE_UPSTREAM: 'http://frontend:8080' };
const SECRET = 'a-secret-of-at-least-32-characters!';

const parseTimeouts = (text: string | undefined) => parseConfig(UPSTREAM, text).timeouts;

describe('parseConfig', () => {
  it('fills in the defaults around the upstream', () => {
    expect(parseConfig(UPSTREAM)).toEqual({
      upstream: 'http://frontend:8080',
      upstreams: [],
      host: '0.0.0.0',
      port: 8080,
      trustProxy: false,
      timeouts: { defaultSeconds: 600, paths: [] },
      secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      writeGate: {
        enforce: true, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined
      },
      pageGate: { enabled: false, passDays: 7, challengesPerAddressAndMinute: 120, policy: [] },
      oidc: undefined,
      audit: { file: '/var/lib/iqb-gate/audit.sqlite', retentionDays: 90, key: undefined }
    });
  });

  it('wants a secret and the proxy in front once pages are gated', () => {
    const pages = 'pageGate:\n  enabled: true\n';
    const behindProxy = { ...UPSTREAM, IQB_GATE_TRUST_PROXY: '172.16.0.0/12' };
    expect(() => parseConfig(behindProxy, pages)).toThrow(/IQB_GATE_SECRET is required/);
    expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_SECRET: SECRET }, pages))
      .toThrow(/pageGate needs IQB_GATE_TRUST_PROXY/);
    expect(parseConfig({ ...behindProxy, IQB_GATE_SECRET: SECRET }, pages).pageGate.enabled).toBe(true);
  });

  it('switches the page gate off with IQB_GATE_ENFORCE=off, for test runs', () => {
    const pages = 'pageGate:\n  enabled: true\n';
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_ENFORCE: 'off' }, pages).pageGate.enabled).toBe(false);
  });

  it('wants a secret once writes are checked, and a long one', () => {
    const rules = 'writeGate:\n  rules:\n    - { name: admin, path: ^/api/admin/ }\n';
    expect(() => parseConfig(UPSTREAM, rules)).toThrow(/IQB_GATE_SECRET is required/);
    expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_SECRET: 'short' }, rules)).toThrow(/at least 32/);
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_SECRET: SECRET }, rules).secret).toBe(SECRET);
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_ENFORCE: 'off' }, rules).writeGate.enforce).toBe(false);
  });

  it('wants no secret when every rule is switched off', () => {
    const rules = 'writeGate:\n  rules:\n    - { name: admin, path: ^/api/admin/ }\n';
    const config = parseConfig({ ...UPSTREAM, IQB_GATE_RULES_OFF: 'admin' }, rules);
    expect(config.writeGate.rules).toEqual([{ name: 'admin', path: expect.any(RegExp), off: true }]);
  });

  it('reads the audit settings', () => {
    const config = parseConfig({
      ...UPSTREAM,
      IQB_GATE_AUDIT_FILE: '/data/audit.sqlite',
      IQB_GATE_AUDIT_RETENTION_DAYS: '30',
      IQB_GATE_AUDIT_KEY: SECRET
    });
    expect(config.audit).toEqual({ file: '/data/audit.sqlite', retentionDays: 30, key: SECRET });
    expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_AUDIT_RETENTION_DAYS: '0' })).toThrow(/no number of days/);
    expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_AUDIT_KEY: 'short' })).toThrow(/at least 32/);
  });

  it('requires the upstream', () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    expect(() => parseConfig({})).toThrow(/IQB_GATE_UPSTREAM is required/);
  });

  it('accepts only an http(s) origin as upstream', () => {
    expect(() => parseConfig({ IQB_GATE_UPSTREAM: 'frontend:8080' })).toThrow(/http or https/);
    expect(() => parseConfig({ IQB_GATE_UPSTREAM: 'not a url' })).toThrow(/no URL/);
    expect(() => parseConfig({ IQB_GATE_UPSTREAM: 'ftp://frontend' })).toThrow(/http or https/);
    expect(() => parseConfig({ IQB_GATE_UPSTREAM: 'http://frontend:8080/app' })).toThrow(/without path/);
    expect(() => parseConfig({ IQB_GATE_UPSTREAM: 'http://frontend:8080?a=1' })).toThrow(/without path/);
    expect(parseConfig({ IQB_GATE_UPSTREAM: 'https://frontend/' }).upstream).toBe('https://frontend');
  });

  it('reads host and port', () => {
    const config = parseConfig({ ...UPSTREAM, IQB_GATE_HOST: '127.0.0.1', IQB_GATE_PORT: '3000' });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
  });

  it('rejects a port that is none', () => {
    ['0', '65536', '80.5', 'http'].forEach(port => {
      expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_PORT: port })).toThrow(/no port/);
    });
  });

  it('trusts a proxy in front only when told so', () => {
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_TRUST_PROXY: '' }).trustProxy).toBe(false);
    expect(() => parseConfig({ ...UPSTREAM, IQB_GATE_TRUST_PROXY: 'true' })).toThrow(/names the proxies/);
    expect(parseConfig({ ...UPSTREAM, IQB_GATE_TRUST_PROXY: '10.0.0.0/8, 172.16.0.1' }).trustProxy)
      .toEqual(['10.0.0.0/8', '172.16.0.1']);
  });

  it('gives path prefixes an upstream of their own', () => {
    const text = 'upstreams:\n  - { prefix: /api/, upstream: "http://backend:3333/" }\n'
      + '  - { prefix: /files, upstream: "https://files.example.org" }\n';
    expect(parseConfig(UPSTREAM, text).upstreams).toEqual([
      { prefix: '/api', upstream: 'http://backend:3333' },
      { prefix: '/files', upstream: 'https://files.example.org' }
    ]);
  });

  it('rejects path upstreams that are no origin, no plain prefix, or named twice', () => {
    const parseUpstreams = (entries: string) => parseConfig(UPSTREAM, `upstreams:\n${entries}`).upstreams;
    expect(() => parseUpstreams('  - { prefix: /api }\n')).toThrow(/upstreams\[0\].upstream is required/);
    expect(() => parseUpstreams('  - { prefix: /api, upstream: backend }\n'))
      .toThrow(/upstreams\[0\].upstream is no URL/);
    expect(() => parseUpstreams('  - { prefix: /api, upstream: "ftp://backend" }\n'))
      .toThrow(/upstreams\[0\].upstream has to be http or https/);
    expect(() => parseUpstreams('  - { prefix: /api, upstream: "http://backend:3333/api" }\n'))
      .toThrow(/upstreams\[0\].upstream is an origin/);
    ['api', '/', '/api/:id', '/.iqb-gate/x'].forEach(prefix => {
      expect(() => parseUpstreams(`  - { prefix: "${prefix}", upstream: "http://backend:3333" }\n`))
        .toThrow(/upstreams\[0\].prefix/);
    });
    expect(() => parseUpstreams('  - { prefix: /api, upstream: "http://a", url: x }\n'))
      .toThrow(/upstreams\[0\] has unknown keys: url/);
    const twice = '  - { prefix: /api, upstream: "http://a" }\n  - { prefix: /api/, upstream: "http://b" }\n';
    expect(() => parseUpstreams(twice)).toThrow(/upstreams names \/api twice/);
    expect(() => parseConfig(UPSTREAM, 'upstreams: /api\n')).toThrow(/upstreams has to be a list/);
  });

  it('takes the timeouts from the file', () => {
    const config = parseConfig(UPSTREAM, 'timeouts:\n  default: 120\n');
    expect(config.timeouts.defaultSeconds).toBe(120);
  });
});

describe('parseTimeouts', () => {
  it('defaults to 600 seconds without a file, or with one that sets no timeouts', () => {
    [undefined, '', '# only a comment\n', '{}\n', 'timeouts: {}\n'].forEach(text => {
      expect(parseTimeouts(text)).toEqual({ defaultSeconds: 600, paths: [] });
    });
  });

  it('reads a timeout per path prefix', () => {
    const text = [
      'timeouts:',
      '  default: 120',
      '  paths:',
      '    - prefix: /api/admin/workspace/',
      '      seconds: 1800'
    ].join('\n');
    expect(parseTimeouts(text)).toEqual({
      defaultSeconds: 120,
      paths: [{ prefix: '/api/admin/workspace', seconds: 1800 }]
    });
  });

  it('accepts only whole positive seconds', () => {
    ['0', '-1', '1.5', 'long'].forEach(value => {
      expect(() => parseTimeouts(`timeouts:\n  default: ${value}\n`)).toThrow(/timeouts.default/);
      expect(() => parseTimeouts(`timeouts:\n  paths:\n    - prefix: /api\n      seconds: ${value}\n`))
        .toThrow(/timeouts.paths\[0\].seconds/);
    });
  });

  it('wants the paths as a list', () => {
    expect(() => parseTimeouts('timeouts:\n  paths: /api\n')).toThrow(/has to be a list/);
  });

  it('wants a plain path below the root as prefix', () => {
    ['/', '//', 'api', '', '7', '/api/:id', '/api/*/export', '/api?x', '/api #x', '/a b'].forEach(prefix => {
      expect(() => parseTimeouts(`timeouts:\n  paths:\n    - prefix: "${prefix}"\n      seconds: 5\n`))
        .toThrow(/prefix has to be a plain path below/);
    });
  });

  it('keeps a prefix without its trailing slash', () => {
    expect(parseTimeouts('timeouts:\n  paths:\n    - { prefix: /api/upload//, seconds: 5 }\n').paths)
      .toEqual([{ prefix: '/api/upload', seconds: 5 }]);
  });

  it('keeps the gateway\'s own paths out', () => {
    expect(() => parseTimeouts('timeouts:\n  paths:\n    - prefix: /.iqb-gate/x\n      seconds: 5\n'))
      .toThrow(/gateway's own/);
  });

  it('refuses a prefix named twice, with or without a trailing slash', () => {
    const text = 'timeouts:\n  paths:\n    - { prefix: /api, seconds: 5 }\n    - { prefix: /api/, seconds: 9 }\n';
    expect(() => parseTimeouts(text)).toThrow(/names \/api twice/);
  });

  it('refuses keys it does not know rather than fall back to a default', () => {
    expect(() => parseTimeouts('timeout:\n  default: 5\n')).toThrow(/unknown keys: timeout\b/);
    expect(() => parseTimeouts('timeouts:\n  defaults: 5\n')).toThrow(/timeouts has unknown keys: defaults/);
    expect(() => parseTimeouts('timeouts:\n  paths:\n    - { prefix: /api, second: 5 }\n'))
      .toThrow(/timeouts.paths\[0\] has unknown keys: second/);
  });

  it('refuses a file of the wrong shape', () => {
    expect(() => parseTimeouts('- timeouts\n')).toThrow(/file has to be a mapping/);
    expect(() => parseTimeouts('just text\n')).toThrow(/file has to be a mapping/);
    expect(() => parseTimeouts('timeouts: 5\n')).toThrow(/timeouts has to be a mapping/);
    expect(() => parseTimeouts('timeouts:\n  paths:\n    - /api\n')).toThrow(/paths\[0\] has to be a mapping/);
  });
});
