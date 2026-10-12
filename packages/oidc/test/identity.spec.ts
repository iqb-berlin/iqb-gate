import { describe, expect, it } from 'vitest';
import { identityOf } from '../src/identity.js';

describe('identityOf', () => {
  it('takes the realm\'s roles, and the client\'s only for the client named', () => {
    const payload = {
      iss: 'https://login.example.org/realms/iqb',
      sub: 's1',
      realm_access: { roles: ['admin', 'admin'] },
      resource_access: { studio: { roles: ['editor', 'admin'] } }
    };
    expect(identityOf(payload).roles).toEqual(['admin']);
    expect(identityOf(payload, 'studio').roles).toEqual(['admin', 'editor']);
    expect(identityOf(payload, 'other').roles).toEqual(['admin']);
  });

  it('ignores claims that are not what they should be', () => {
    const identity = identityOf({
      iss: 'https://login.example.org/realms/iqb',
      sub: 's1',
      preferred_username: 42,
      email: '',
      given_name: ['x'],
      realm_access: { roles: 'admin' }
    });
    expect(identity).toEqual({
      issuer: 'https://login.example.org/realms/iqb',
      subject: 's1',
      username: 's1',
      email: null,
      givenName: null,
      familyName: null,
      roles: [],
      claims: expect.any(Object)
    });
  });

  // As coding-box took them: blanks around a name or a role are no part of it
  it('takes names and roles without the blanks around them', () => {
    const identity = identityOf({
      iss: 'https://login.example.org/realms/iqb',
      sub: 's1',
      preferred_username: ' anna ',
      realm_access: { roles: [' admin', '  ', 'editor '] }
    });
    expect(identity.username).toBe('anna');
    expect(identity.roles).toEqual(['admin', 'editor']);
    expect(identityOf({ iss: 'i', sub: 's1', preferred_username: '   ', email: 'a@b.org' }).username).toBe('a@b.org');
  });
});
