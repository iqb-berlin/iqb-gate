import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parsePageGate } from '../../src/page-gate/page-gate-config.js';

const gate = (yamlText: string) => parsePageGate((parse(yamlText) as { pageGate: unknown }).pageGate);

describe('parsePageGate', () => {
  it('is off without a section', () => {
    expect(parsePageGate(undefined)).toEqual({
      enabled: false, passDays: 7, challengesPerAddressAndMinute: 120, policy: []
    });
  });

  it('reads the settings and the policy', () => {
    const config = gate(`
pageGate:
  enabled: true
  passDays: 3
  challengesPerAddressAndMinute: 60
  policy:
    - { name: ai-crawlers, userAgent: 'GPTBot|CCBot', action: deny }
    - { name: uptime, userAgent: '^UptimeRobot/', path: '^/$', action: allow }
`);
    expect(config).toEqual({
      enabled: true,
      passDays: 3,
      challengesPerAddressAndMinute: 60,
      policy: [
        { name: 'ai-crawlers', userAgent: expect.any(RegExp), action: 'deny' },
        { name: 'uptime', userAgent: expect.any(RegExp), path: expect.any(RegExp), action: 'allow' }
      ]
    });
    expect(config.policy[0].userAgent?.test('mozilla gptbot')).toBe(true);
  });

  it('refuses what it cannot use', () => {
    expect(() => gate('pageGate:\n  enable: true\n')).toThrow(/unknown keys: enable/);
    expect(() => gate('pageGate:\n  enabled: yes please\n')).toThrow(/true or false/);
    expect(() => gate('pageGate:\n  passDays: 0\n')).toThrow(/passDays/);
    expect(() => gate('pageGate:\n  policy:\n    - { name: x, action: deny }\n')).toThrow(/needs userAgent or path/);
    expect(() => gate('pageGate:\n  policy:\n    - { name: x, path: ^/, action: block }\n')).toThrow(/one of allow/);
    expect(() => gate('pageGate:\n  policy:\n    - { name: x, path: "(" , action: deny }\n'))
      .toThrow(/no regular expression/);
    const twice = [
      'pageGate:',
      '  policy:',
      '    - { name: x, path: ^/a, action: deny }',
      '    - { name: x, path: ^/b, action: deny }'
    ].join('\n');
    expect(() => gate(twice)).toThrow(/names x twice/);
  });
});
