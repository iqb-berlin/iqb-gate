import { describe, expect, it } from 'vitest';
import {
  rolesOf, subjectOf, textClaim, usernameOf
} from '../src/claims.js';

describe('textClaim', () => {
  it('takes a text without the blanks around it, and nothing else', () => {
    expect(textClaim('  anna ')).toBe('anna');
    expect(textClaim('   ')).toBeNull();
    expect(textClaim(7)).toBeNull();
    expect(textClaim(undefined)).toBeNull();
  });
});

// An identifier: the browser and the backend have to key a person alike
describe('subjectOf', () => {
  it('takes the subject exactly as sent, and nothing that is no text or only blanks', () => {
    expect(subjectOf({ sub: ' 42 ' })).toBe(' 42 ');
    expect(subjectOf({ sub: '   ' })).toBeNull();
    expect(subjectOf({ sub: 42 })).toBeNull();
    expect(subjectOf({})).toBeNull();
  });
});

describe('usernameOf', () => {
  it('names a person by preferred_username, else the e-mail address, else the subject', () => {
    expect(usernameOf({ preferred_username: 'anna', email: 'a@b.org' }, 's1')).toBe('anna');
    expect(usernameOf({ preferred_username: ' ', email: 'a@b.org' }, 's1')).toBe('a@b.org');
    expect(usernameOf({}, 's1')).toBe('s1');
    expect(usernameOf({}, ' 42 ')).toBe('42');
  });
});

describe('rolesOf', () => {
  const claims = {
    realm_access: { roles: ['reader', 'admin', ' '] },
    resource_access: { studio: { roles: ['admin', 'editor'] }, other: { roles: ['x'] } }
  };

  it('takes the realm\'s roles, and those of the named client, each once', () => {
    expect(rolesOf(claims, 'studio')).toEqual(['reader', 'admin', 'editor']);
  });

  it('takes only the realm\'s roles without a client', () => {
    expect(rolesOf(claims)).toEqual(['reader', 'admin']);
  });

  it('takes nothing that is no list of texts', () => {
    expect(rolesOf({ realm_access: { roles: 'admin' } }, 'studio')).toEqual([]);
  });
});
