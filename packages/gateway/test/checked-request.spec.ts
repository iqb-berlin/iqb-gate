import { describe, expect, it } from 'vitest';
import { READING_METHODS, SAVING_METHODS } from '@iqb/gate-protocol';
import { checkedRequest } from '../src/checked-request.js';

const WRITES = {
  enforce: true,
  rules: [
    { name: 'administration', path: /^\/api\/(admin|group-admin|workspace-groups)\//i },
    { name: 'workspace', path: /^\/api\/workspaces\/[^/]+(\/|$)/i }
  ],
  exempt: [
    { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/download-units$/i },
    { method: 'PATCH', path: /^\/api\/workspaces\/[^/]+\/units\/[^/]+\/comments$/i },
    { bearerPrefix: 'sl_' }
  ]
};

const check = (method: string, url: string, authorization?: string) => checkedRequest(
  SAVING_METHODS,
  WRITES,
  { method, url, authorization }
)?.rule ?? null;

describe('checkedRequest for writes', () => {
  it('hands back the path as it arrived, without the query', () => {
    const request = { method: 'PATCH', url: '/api/%61dmin/users?x=1', authorization: undefined };
    expect(checkedRequest(SAVING_METHODS, WRITES, request))
      .toEqual({ rule: 'administration', method: 'PATCH', path: '/api/%61dmin/users' });
  });

  it('checks a write under a rule and names the rule', () => {
    expect(check('PATCH', '/api/admin/users/3')).toBe('administration');
    expect(check('POST', '/api/group-admin/workspaces')).toBe('administration');
    expect(check('DELETE', '/api/workspaces/5/units/9')).toBe('workspace');
    expect(check('PUT', '/api/workspaces/5')).toBe('workspace');
  });

  it('never checks a read', () => {
    expect(check('GET', '/api/admin/users')).toBeNull();
    expect(check('HEAD', '/api/admin/users')).toBeNull();
    expect(check('OPTIONS', '/api/admin/users')).toBeNull();
  });

  it('checks nothing outside the rules', () => {
    expect(check('POST', '/api/login')).toBeNull();
    expect(check('POST', '/api/workspaces')).toBeNull();
  });

  it('cannot be got round by spelling the path differently', () => {
    expect(check('PATCH', '/API/ADMIN/users/3')).toBe('administration');
    expect(check('PATCH', '/api/%61dmin/users/3')).toBe('administration');
    expect(check('PATCH', '//api/admin/users/3')).toBe('administration');
    expect(check('PATCH', '/api/./admin/users/3')).toBe('administration');
    expect(check('PATCH', '/api/x/../admin/users/3')).toBe('administration');
  });

  it('lets an exemption through when all it names holds', () => {
    expect(check('POST', '/api/workspaces/5/download-units')).toBeNull();
    expect(check('PATCH', '/api/workspaces/5/units/9/comments')).toBeNull();
    expect(check('PATCH', '/api/workspaces/5/units/9/comments?x=1')).toBeNull();
  });

  it('checks what an exemption only nearly matches', () => {
    expect(check('PATCH', '/api/workspaces/5/download-units')).toBe('workspace');
    expect(check('PATCH', '/api/workspaces/5/units/9/comments/2')).toBe('workspace');
    // The raw path matches the exemption, the normalised one does not
    expect(check('POST', '/api/workspaces/5/units/../download-units')).toBe('workspace');
  });

  it('exempts a script token by its prefix, and only as Bearer', () => {
    expect(check('PATCH', '/api/workspaces/5/units/9/properties', 'Bearer sl_1_secret')).toBeNull();
    expect(check('PATCH', '/api/workspaces/5/units/9/properties', 'bearer sl_1_secret')).toBeNull();
    expect(check('PATCH', '/api/workspaces/5/units/9/properties', 'Bearer eyJ.sl_')).toBe('workspace');
    expect(check('PATCH', '/api/workspaces/5/units/9/properties', 'Basic sl_1_secret')).toBe('workspace');
  });

  it('checks nothing when not enforced', () => {
    const request = { method: 'PATCH', url: '/api/admin/x', authorization: undefined };
    expect(checkedRequest(SAVING_METHODS, { ...WRITES, enforce: false }, request)).toBeNull();
  });

  describe('with a rule switched off', () => {
    const withCatchAll = {
      ...WRITES,
      rules: [
        { ...WRITES.rules[0] },
        { ...WRITES.rules[1], off: true },
        { name: 'other', path: /^\/api\//i }
      ]
    };
    const checkOff = (method: string, url: string) => checkedRequest(
      SAVING_METHODS,
      withCatchAll,
      { method, url, authorization: undefined }
    )?.rule ?? null;

    it('lets its writes through, also past a catch-all further down', () => {
      expect(checkOff('PATCH', '/api/workspaces/5/units/9')).toBeNull();
      expect(checkOff('PATCH', '/API/workspaces/5')).toBeNull();
    });

    it('still checks under the other rules', () => {
      expect(checkOff('PATCH', '/api/admin/users/3')).toBe('administration');
      expect(checkOff('POST', '/api/login')).toBe('other');
    });

    it('does not let through what it only covers in one spelling', () => {
      expect(checkOff('PATCH', '/api/workspaces/5/../../admin/users/3')).toBe('administration');
      expect(checkOff('PATCH', '/api/workspaces/5/%2e%2e/%2e%2e/login')).toBe('other');
      expect(checkOff('PATCH', '/API/%77orkspaces/5')).toBe('other');
    });
  });
});


const READS = {
  enforce: true,
  rules: [
    { name: 'administration', path: /^\/api\/(admin|group-admin|workspace-groups)\//i },
    { name: 'workspace', path: /^\/api\/workspaces\//i },
    { name: 'other', path: /^\/api\//i }
  ],
  exempt: [
    { path: /^\/api\/admin\/settings\/(config|app-logo)$/i },
    { path: /^\/api\/packages\//i },
    { bearerPrefix: 'sl_' }
  ]
};

const checkRead = (method: string, url: string, authorization?: string) => checkedRequest(
  READING_METHODS,
  READS,
  { method, url, authorization }
)?.rule ?? null;

describe('checkedRequest for reads', () => {
  it('checks a read under a rule, and hands back the path as it arrived without the query', () => {
    const request = { method: 'GET', url: '/api/workspaces/5/units?x=1', authorization: undefined };
    expect(checkedRequest(READING_METHODS, READS, request))
      .toEqual({ rule: 'workspace', method: 'GET', path: '/api/workspaces/5/units' });
    expect(checkRead('HEAD', '/api/admin/users')).toBe('administration');
    expect(checkRead('GET', '/api/my-data')).toBe('other');
  });

  it('never checks a write or an OPTIONS request', () => {
    expect(checkRead('POST', '/api/workspaces/5')).toBeNull();
    expect(checkRead('OPTIONS', '/api/workspaces/5')).toBeNull();
  });

  it('checks nothing outside the rules', () => {
    expect(checkRead('GET', '/')).toBeNull();
    expect(checkRead('GET', '/assets/i18n/de.json')).toBeNull();
  });

  it('lets exempted reads through, but only when both spellings of the path are exempt', () => {
    expect(checkRead('GET', '/api/admin/settings/config')).toBeNull();
    expect(checkRead('GET', '/api/packages/GeoGebra/deployggb.js')).toBeNull();
    expect(checkRead('GET', '/api/packages/../workspaces/5/units')).toBe('workspace');
  });

  it('lets script tokens the application checks itself through', () => {
    expect(checkRead('GET', '/api/workspaces/5', 'Bearer sl_1_secret')).toBeNull();
    expect(checkRead('GET', '/api/workspaces/5', 'Bearer eyJ.x.y')).toBe('workspace');
  });

  it('checks nothing when not enforced', () => {
    const request = { method: 'GET', url: '/api/x', authorization: undefined };
    expect(checkedRequest(READING_METHODS, { ...READS, enforce: false }, request))
      .toBeNull();
  });
});
