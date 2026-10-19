import { checkApiUrls, isApiUrl } from './iqb-oidc-options';

describe('isApiUrl', () => {
  it('should take the URLs below one of the APIs', () => {
    expect(isApiUrl('/api/workspaces', ['/api/'])).toBe(true);
    expect(isApiUrl('https://studio.example.org/api/x', ['https://studio.example.org/api/'])).toBe(true);
  });

  it('should leave all others alone, the provider\'s included', () => {
    expect(isApiUrl('/assets/config.json', ['/api/'])).toBe(false);
    expect(isApiUrl('https://login.example.org/realms/iqb/protocol/openid-connect/token', ['/api/'])).toBe(false);
  });
});

describe('checkApiUrls', () => {
  it('should take API URLs that end with a slash', () => {
    expect(() => checkApiUrls(['/api/', 'https://studio.example.org/'])).not.toThrow();
  });

  // `https://studio.example.org` would match `https://studio.example.org.attacker.net` as well
  it('should refuse URLs a token could leak through, and none at all', () => {
    expect(() => checkApiUrls(['https://studio.example.org'])).toThrow(/has to end with "\/"/);
    expect(() => checkApiUrls(['https://*.example.org/api/'])).toThrow(/no wildcard/);
    expect(() => checkApiUrls([])).toThrow(/names no API/);
  });

  // `/` matches `//attacker.net/x` as well -- and `/\attacker.net/x`, which browsers read alike
  it('should refuse prefixes that match the address of another host', () => {
    [
      '/', '//attacker.net/', '/\\attacker.net/', '/\t/attacker.net/', '/\n/attacker.net/', 'https:/attacker.net/',
      'https://user@attacker.net/', 'api/', 'ftp://studio.example.org/'
    ].forEach(url => expect(() => checkApiUrls([url])).toThrow(/path from the root or an http\(s\) URL/));
    expect(() => checkApiUrls(['/api/', 'https://studio.example.org/api/', 'https://Studio.example.org:443/']))
      .not.toThrow();
  });
});
