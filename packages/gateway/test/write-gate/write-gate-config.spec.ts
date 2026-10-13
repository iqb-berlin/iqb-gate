import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseWriteGate } from '../../src/write-gate/write-gate-config.js';

const section = (yamlText: string): unknown => (parse(yamlText) as { writeGate: unknown }).writeGate;
const gate = (yamlText: string, enforce?: string) => parseWriteGate(section(yamlText), enforce);

const STUDIO_LITE = `
writeGate:
  rules:
    - { name: administration, path: '^/api/(admin|group-admin|workspace-groups)/' }
    - { name: workspace, path: '^/api/workspaces/[^/]+(/|$)' }
  exempt:
    - { method: POST, path: '^/api/workspaces/[^/]+/download-units$' }
    - { bearerPrefix: 'sl_' }
  burst: { limit: 10, windowSeconds: 30 }
  userClaim: username
`;

describe('parseWriteGate', () => {
  it('checks nothing without a section, but is on', () => {
    expect(parseWriteGate(undefined, undefined)).toEqual({
      enforce: true, rules: [], exempt: [], burst: { limit: 30, windowSeconds: 60 }, userClaim: undefined
    });
  });

  it('reads rules, exemptions, burst and the user claim', () => {
    const config = gate(STUDIO_LITE);
    expect(config.rules.map(rule => rule.name)).toEqual(['administration', 'workspace']);
    expect(config.rules[0].path.test('/API/Admin/users')).toBe(true);
    expect(config.exempt).toEqual([
      { method: 'POST', path: expect.any(RegExp) }, { bearerPrefix: 'sl_' }
    ]);
    expect(config.burst).toEqual({ limit: 10, windowSeconds: 30 });
    expect(config.userClaim).toBe('username');
  });

  it('switches off the rules IQB_GATE_RULES_OFF names, and only those', () => {
    const rules = (off?: string) => parseWriteGate(section(STUDIO_LITE), undefined, off).rules
      .map(rule => [rule.name, rule.off ?? false]);
    expect(rules()).toEqual([['administration', false], ['workspace', false]]);
    expect(rules('')).toEqual([['administration', false], ['workspace', false]]);
    expect(rules(' workspace ,')).toEqual([['administration', false], ['workspace', true]]);
    expect(rules('workspace,administration')).toEqual([['administration', true], ['workspace', true]]);
  });

  it('refuses a rule name in IQB_GATE_RULES_OFF that no rule has', () => {
    expect(() => parseWriteGate(section(STUDIO_LITE), undefined, 'workspaces'))
      .toThrow(/IQB_GATE_RULES_OFF names workspaces/);
  });

  it('follows IQB_GATE_ENFORCE', () => {
    expect(gate(STUDIO_LITE, 'off').enforce).toBe(false);
    expect(gate(STUDIO_LITE, ' ON ').enforce).toBe(true);
    expect(gate(STUDIO_LITE, '').enforce).toBe(true);
    expect(() => gate(STUDIO_LITE, 'yes')).toThrow(/on or off/);
  });

  it('stops at a broken regular expression', () => {
    expect(() => gate("writeGate:\n  rules:\n    - { name: x, path: '^/api/(' }\n"))
      .toThrow(/writeGate.rules\[0\].path is no regular expression/);
  });

  it('refuses an exemption that names nothing, which would exempt every write', () => {
    expect(() => gate('writeGate:\n  exempt:\n    - {}\n')).toThrow(/needs method, path or bearerPrefix/);
  });

  it('refuses what it cannot use', () => {
    expect(() => gate('writeGate:\n  rule: []\n')).toThrow(/unknown keys: rule/);
    expect(() => gate('writeGate: []\n')).toThrow(/has to be a mapping/);
    expect(() => gate('writeGate:\n  rules:\n    - { name: x, path: ^/a, method: POST }\n'))
      .toThrow(/unknown keys: method/);
    expect(() => gate('writeGate:\n  rules:\n    - { name: "a b", path: ^/a }\n')).toThrow(/name has to be a word/);
    expect(() => gate('writeGate:\n  rules:\n    - { name: x, path: ^/a }\n    - { name: x, path: ^/b }\n'))
      .toThrow(/names x twice/);
    expect(() => gate('writeGate:\n  exempt:\n    - { method: GET }\n')).toThrow(/method has to be one of/);
    expect(() => gate('writeGate:\n  exempt:\n    - { bearerPrefix: s }\n')).toThrow(/at least three/);
    expect(() => gate('writeGate:\n  burst: { limit: 0 }\n')).toThrow(/burst.limit/);
    expect(() => gate('writeGate:\n  burst: { window: 5 }\n')).toThrow(/unknown keys: window/);
    expect(() => gate('writeGate:\n  userClaim: ""\n')).toThrow(/userClaim/);
  });
});
