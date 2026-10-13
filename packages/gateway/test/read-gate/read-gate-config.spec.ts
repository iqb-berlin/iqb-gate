import { describe, expect, it } from 'vitest';
import { parseReadGate } from '../../src/read-gate/read-gate-config.js';

describe('parseReadGate', () => {
  it('checks no read without a section', () => {
    expect(parseReadGate(undefined, undefined)).toEqual({
      enforce: true, rules: [], exempt: [], limit: { limit: 600, windowSeconds: 60 }, userClaim: undefined
    });
  });

  it('reads rules, exemptions, limit and the user claim', () => {
    const gate = parseReadGate({
      rules: [{ name: 'workspace', path: '^/api/workspaces/' }],
      exempt: [{ path: '^/api/packages/' }, { bearerPrefix: 'sl_' }],
      limit: { limit: 100 },
      userClaim: 'username'
    }, 'on');
    expect(gate).toEqual({
      enforce: true,
      rules: [{ name: 'workspace', path: /^\/api\/workspaces\//i }],
      exempt: [{ path: /^\/api\/packages\//i }, { bearerPrefix: 'sl_' }],
      limit: { limit: 100, windowSeconds: 60 },
      userClaim: 'username'
    });
  });

  it('switches off what IQB_GATE_READ_RULES_OFF names', () => {
    const gate = parseReadGate({ rules: [{ name: 'workspace', path: '^/api/workspaces/' }] }, 'on', 'workspace');
    expect(gate.rules[0].off).toBe(true);
  });

  it('is switched off with IQB_GATE_ENFORCE=off', () => {
    expect(parseReadGate({ rules: [{ name: 'a', path: 'x' }] }, 'off').enforce).toBe(false);
  });

  it('refuses what it does not know or cannot use', () => {
    expect(() => parseReadGate({ burst: {} }, 'on')).toThrow('readGate has unknown keys: burst');
    expect(() => parseReadGate({ exempt: [{ method: 'GET', path: 'x' }] }, 'on'))
      .toThrow('readGate.exempt[0] has unknown keys: method');
    expect(() => parseReadGate({ exempt: [{}] }, 'on')).toThrow('an empty one would exempt every read');
    expect(() => parseReadGate({ exempt: [{ bearerPrefix: 's' }] }, 'on'))
      .toThrow('readGate.exempt[0].bearerPrefix has to be at least three characters.');
    expect(() => parseReadGate({ limit: { limit: 0 } }, 'on'))
      .toThrow('readGate.limit.limit has to be a positive whole number.');
    expect(() => parseReadGate({ userClaim: '' }, 'on')).toThrow('readGate.userClaim has to be the name of a claim');
    expect(() => parseReadGate([], 'on')).toThrow('readGate has to be a mapping.');
  });
});
