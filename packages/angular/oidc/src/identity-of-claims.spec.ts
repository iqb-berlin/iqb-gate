import { identityOfClaims, sameIdentity } from './identity-of-claims';

describe('identityOfClaims', () => {
  it('should fall back to the e-mail address, then the subject, for a name', () => {
    expect(identityOfClaims({ sub: 's1', email: 'a@b.org' })?.username).toBe('a@b.org');
    expect(identityOfClaims({ sub: 's1', preferred_username: '  ' })?.username).toBe('s1');
  });

  it('should know nobody without a subject', () => {
    expect(identityOfClaims(null)).toBeNull();
    expect(identityOfClaims({ preferred_username: 'anna' })).toBeNull();
    expect(identityOfClaims({ sub: '  ', preferred_username: 'anna' })).toBeNull();
  });

  // The backend keys the person by the subject as sent; the view must name the same one
  it('should take the subject exactly as sent, and show it as a name without blanks', () => {
    expect(identityOfClaims({ sub: ' 42 ' })).toEqual(expect.objectContaining({ subject: ' 42 ', username: '42' }));
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

describe('sameIdentity', () => {
  const anna = {
    subject: 's1', username: 'anna', email: 'anna@example.org', roles: ['admin']
  };

  it('should tell an identity that changed in any part, roles included', () => {
    expect(sameIdentity(anna, { ...anna, roles: ['admin'] })).toBe(true);
    expect(sameIdentity({ ...anna, roles: ['admin', 'editor'] }, { ...anna, roles: ['editor', 'admin'] })).toBe(true);
    expect(sameIdentity(anna, { ...anna, roles: ['admin', 'editor'] })).toBe(false);
    expect(sameIdentity(anna, { ...anna, email: null })).toBe(false);
    expect(sameIdentity(anna, { ...anna, username: 'anna.a' })).toBe(false);
    expect(sameIdentity(anna, { ...anna, subject: 's2' })).toBe(false);
  });

  it('should take nobody for nobody only', () => {
    expect(sameIdentity(null, null)).toBe(true);
    expect(sameIdentity(anna, null)).toBe(false);
    expect(sameIdentity(null, anna)).toBe(false);
  });
});
