import { applicationUrl } from './application-url';

describe('applicationUrl', () => {
  const page = 'https://host/studio/workspace/3';

  it('should take the origin without a base, never the page itself', () => {
    expect(applicationUrl(page, null)).toBe('https://host');
    expect(applicationUrl(page, '')).toBe('https://host');
  });

  // A provider's client registered for the origin keeps working
  it('should take the origin for a base of /', () => {
    expect(applicationUrl(page, '/')).toBe('https://host');
  });

  it('should take the base of an application below a path', () => {
    expect(applicationUrl(page, '/studio/')).toBe('https://host/studio/');
    expect(applicationUrl(page, 'https://host/studio/')).toBe('https://host/studio/');
    expect(applicationUrl(page, '/studio/index.html')).toBe('https://host/studio/');
  });

  // The router takes a base without its slash as the same path
  it('should take a base without its trailing slash as the same path', () => {
    expect(applicationUrl(page, '/studio')).toBe('https://host/studio/');
  });

  it('should take the origin for a base on another origin', () => {
    expect(applicationUrl(page, 'https://cdn.example.org/studio/')).toBe('https://host');
  });
});
