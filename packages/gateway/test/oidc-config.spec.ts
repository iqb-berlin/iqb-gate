import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseOidc } from '../src/oidc-config.js';

const oidc = (yamlText: string) => parseOidc((parse(yamlText) as { oidc: unknown }).oidc);

describe('parseOidc', () => {
  it('checks no tokens without a section', () => {
    expect(parseOidc(undefined)).toBeUndefined();
  });

  it('reads the provider', () => {
    expect(oidc(`
oidc:
  issuer: https://login.example.org/realms/iqb
  clientId: studio
  audience: [studio-api, account]
  jwksUri: https://login.example.org/realms/iqb/protocol/openid-connect/certs
`)).toEqual({
      issuer: 'https://login.example.org/realms/iqb',
      clientId: 'studio',
      audience: ['studio-api', 'account'],
      jwksUri: 'https://login.example.org/realms/iqb/protocol/openid-connect/certs'
    });
  });

  it('refuses what it cannot use', () => {
    expect(() => oidc('oidc:\n  issuer: login.example.org\n')).toThrow(/oidc.issuer has to be an http\(s\) URL/);
    expect(() => oidc('oidc:\n  clientId: studio\n')).toThrow(/oidc.issuer has to be a URL/);
    expect(() => oidc('oidc:\n  issuer: https://x.org\n  client: studio\n')).toThrow(/unknown keys: client/);
    expect(() => oidc('oidc:\n  issuer: https://x.org\n  clientId: s\n  audience: []\n')).toThrow(/oidc.audience/);
    expect(() => oidc('oidc:\n  issuer: https://x.org\n  clientId: s\n  jwksUri: ftp://x.org\n'))
      .toThrow(/oidc.jwksUri/);
    expect(() => oidc('oidc: https://x.org\n')).toThrow(/has to be a mapping/);
  });

  // Without it, a token the provider issued to any other client of the realm would name a writer
  it('stops without the client the tokens have to be for', () => {
    expect(() => oidc('oidc:\n  issuer: https://x.org\n')).toThrow(/oidc.clientId has to be the name of the client/);
    expect(() => oidc('oidc:\n  issuer: https://x.org\n  clientId: ""\n')).toThrow(/oidc.clientId/);
  });
});
