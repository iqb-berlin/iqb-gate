import { identityOfClaims } from './identity-of-claims';

describe('identityOfClaims', () => {
  it('should fall back to the e-mail address, then the subject, for a name', () => {
    expect(identityOfClaims({ sub: 's1', email: 'a@b.org' })?.username).toBe('a@b.org');
    expect(identityOfClaims({ sub: 's1', preferred_username: '  ' })?.username).toBe('s1');
  });

  it('should know nobody without a subject', () => {
    expect(identityOfClaims(null)).toBeNull();
    expect(identityOfClaims({ preferred_username: 'anna' })).toBeNull();
  });

  // The backend grants the client's roles as well; the view must not show fewer
  it('should take the roles of the realm and of the client from the access token, each once', () => {
    const accessToken = {
      realm_access: { roles: ['admin', 'reader'] },
      resource_access: { studio: { roles: ['admin', 'editor'] } }
    };
    expect(identityOfClaims({ sub: 's1' }, accessToken, 'studio')?.roles).toEqual(['admin', 'reader', 'editor']);
    expect(identityOfClaims({ sub: 's1' }, accessToken)?.roles).toEqual(['admin', 'reader']);
  });
});
