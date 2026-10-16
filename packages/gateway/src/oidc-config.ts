import { ConfigError, isMapping, rejectUnknownKeys } from './config-helpers.js';

/** The OpenID Connect provider whose tokens the gateway checks, to name writers in the audit log. */
export interface OidcConfig {
  issuer: string;
  /** The client the tokens have to be for; required, as for the verifier. */
  clientId: string;
  audience?: string | string[];
  jwksUri?: string;
}

function urlAt(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new ConfigError(`${where} has to be a URL.`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(url.protocol);
  } catch {
    throw new ConfigError(`${where} has to be an http(s) URL: ${value}`);
  }
  return value;
}

function audienceAt(value: unknown): string | string[] {
  const valid = (entry: unknown) => typeof entry === 'string' && entry !== '';
  if (valid(value)) return value as string;
  if (Array.isArray(value) && value.length && value.every(valid)) return value as string[];
  throw new ConfigError('oidc.audience has to be a name or a list of names.');
}

/** Reads the `oidc` section of the file; without one, the gateway checks no tokens. */
export function parseOidc(section: unknown): OidcConfig | undefined {
  if (section === undefined || section === null) return undefined;
  if (!isMapping(section)) throw new ConfigError('oidc has to be a mapping with the issuer and the clientId.');
  rejectUnknownKeys(section, ['issuer', 'clientId', 'audience', 'jwksUri'], 'oidc');
  const { clientId } = section;
  const issuer = urlAt(section.issuer, 'oidc.issuer');
  if (typeof clientId !== 'string' || clientId === '') {
    throw new ConfigError('oidc.clientId has to be the name of the client the tokens are for.');
  }
  return {
    issuer,
    clientId,
    ...(section.audience !== undefined ? { audience: audienceAt(section.audience) } : {}),
    ...(section.jwksUri !== undefined ? { jwksUri: urlAt(section.jwksUri, 'oidc.jwksUri') } : {})
  };
}
