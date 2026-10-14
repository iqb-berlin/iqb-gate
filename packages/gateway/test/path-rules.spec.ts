import { describe, expect, it } from 'vitest';
import {
  checksAnything, hasActiveRules, matchesBothSpellings, parseRules, ruleFor
} from '../src/path-rules.js';
import { ConfigError } from '../src/config-helpers.js';
import { pathVariants } from '../src/request-path.js';

const RULES_OFF = { setting: 'IQB_GATE_READ_RULES_OFF', value: undefined };

describe('parseRules', () => {
  it('reads the rules of a section, case-insensitive', () => {
    const rules = parseRules([{ name: 'workspace', path: '^/api/workspaces/' }], 'readGate', RULES_OFF);
    expect(rules).toEqual([{ name: 'workspace', path: /^\/api\/workspaces\//i }]);
  });

  it('switches off the rules the setting names, and only those', () => {
    const rules = parseRules(
      [{ name: 'workspace', path: '^/api/workspaces/' }, { name: 'other', path: '^/api/' }],
      'readGate',
      { setting: 'IQB_GATE_READ_RULES_OFF', value: ' workspace , ' }
    );
    expect(rules.map(rule => [rule.name, rule.off ?? false])).toEqual([['workspace', true], ['other', false]]);
  });

  it('stops at a name no rule of the section has, naming the setting and the section', () => {
    expect(() => parseRules([{ name: 'workspace', path: '^/api/' }], 'readGate', {
      setting: 'IQB_GATE_READ_RULES_OFF', value: 'workspaces'
    })).toThrow(new ConfigError('IQB_GATE_READ_RULES_OFF names workspaces, which no rule in readGate.rules has.'));
  });

  it('refuses a name used twice and a name that is no word', () => {
    expect(() => parseRules([{ name: 'a', path: 'x' }, { name: 'a', path: 'y' }], 'readGate', RULES_OFF))
      .toThrow('readGate.rules names a twice.');
    expect(() => parseRules([{ name: 'a b', path: 'x' }], 'readGate', RULES_OFF))
      .toThrow('readGate.rules[0].name has to be a word');
  });
});

describe('ruleFor', () => {
  const rules = [
    { name: 'administration', path: /^\/api\/admin\//i },
    { name: 'workspace', path: /^\/api\/workspaces\//i, off: true },
    { name: 'other', path: /^\/api\//i }
  ];

  it('finds the first matching rule that is on', () => {
    expect(ruleFor(rules, pathVariants('/api/admin/users'))?.name).toBe('administration');
    expect(ruleFor(rules, pathVariants('/api/my-data'))?.name).toBe('other');
  });

  it('lets a rule switched off claim its paths, so that a catch-all does not take them', () => {
    expect(ruleFor(rules, pathVariants('/api/workspaces/5'))).toBeUndefined();
  });

  it('checks a path whose other spelling matches a rule that is on', () => {
    expect(ruleFor(rules, pathVariants('/api/workspaces/5/../../admin/users'))?.name).toBe('administration');
  });

  it('tells whether any rule is left on', () => {
    expect(hasActiveRules(rules)).toBe(true);
    expect(hasActiveRules([{ name: 'a', path: /x/, off: true }])).toBe(false);
  });
});

describe('matchesBothSpellings', () => {
  it('holds a pattern only for both spellings of a path', () => {
    expect(matchesBothSpellings(/^\/api\/packages\//i, pathVariants('/api/packages/GeoGebra/x.js'))).toBe(true);
    expect(matchesBothSpellings(/^\/api\/packages\//i, pathVariants('/api/packages/../workspaces/5'))).toBe(false);
  });
});

describe('checksAnything', () => {
  const rule = { name: 'workspace', path: /^\/api\/workspaces\//i };

  it('is true for an enforced gate with a rule on', () => {
    expect(checksAnything({ enforce: true, rules: [rule] })).toBe(true);
  });

  it('is false when not enforced, without rules, or with every rule off', () => {
    expect(checksAnything({ enforce: false, rules: [rule] })).toBe(false);
    expect(checksAnything({ enforce: true, rules: [] })).toBe(false);
    expect(checksAnything({ enforce: true, rules: [{ ...rule, off: true }] })).toBe(false);
  });
});
