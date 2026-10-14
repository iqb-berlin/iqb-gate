import {
  describe, expect, it, vi
} from 'vitest';
import { decidePage } from '../../src/page-gate/page-policy.js';
import type { PagePolicyRule } from '../../src/page-gate/page-gate-config.js';

const POLICY: PagePolicyRule[] = [
  { name: 'private', path: /^\/private/i, action: 'deny' },
  { name: 'ai-crawlers', userAgent: /GPTBot|CCBot/i, action: 'deny' },
  { name: 'uptime', userAgent: /^UptimeRobot\//i, path: /^\/$/, action: 'allow' },
  { name: 'imprint', path: /^\/imprint$/, action: 'allow' }
];

const decide = (userAgent: string, url: string) => decidePage(POLICY, { userAgent, url });

describe('decidePage', () => {
  // The page gate sees every asset and API call; parsing the URL is only worth it for a path rule
  it('parses the URL only for a rule that names a path, and once', () => {
    const parse = vi.spyOn(URL.prototype, 'pathname', 'get');
    decidePage([{ name: 'ai-crawlers', userAgent: /GPTBot/i, action: 'deny' }], { userAgent: 'Mozilla/5.0', url: '/' });
    expect(parse).not.toHaveBeenCalled();
    decidePage(POLICY, { userAgent: 'Mozilla/5.0', url: '/x' });
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });

  it('lets the first rule that holds decide', () => {
    expect(decide('Mozilla/5.0 (compatible; GPTBot/1.2)', '/')).toEqual({ action: 'deny', rule: 'ai-crawlers' });
    expect(decide('UptimeRobot/2.0', '/')).toEqual({ action: 'allow', rule: 'uptime' });
  });

  it('wants every condition of a rule to hold', () => {
    expect(decide('UptimeRobot/2.0', '/admin')).toEqual({ action: 'challenge', rule: null });
  });

  it('challenges what no rule decides', () => {
    expect(decide('Mozilla/5.0 Firefox/140.0', '/')).toEqual({ action: 'challenge', rule: null });
  });

  it('lets no differently spelt path slip through an allowing rule', () => {
    expect(decide('Mozilla/5.0', '/imprint')).toEqual({ action: 'allow', rule: 'imprint' });
    expect(decide('Mozilla/5.0', '/x/../imprint').action).toBe('challenge');
    expect(decide('Mozilla/5.0', '/imprint?x=1').action).toBe('allow');
  });

  it('lets no differently spelt path slip past a denying rule', () => {
    expect(decide('Mozilla/5.0', '/private/x').action).toBe('deny');
    expect(decide('Mozilla/5.0', '//private/x').action).toBe('deny');
    expect(decide('Mozilla/5.0', '/%70rivate/x').action).toBe('deny');
  });
});
