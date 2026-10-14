import {
  createRemoteJWKSet, decodeProtectedHeader, errors, type JWTPayload, jwtVerify, type JWTVerifyGetKey
} from 'jose';
import { identityOf, type OidcIdentity } from './identity.js';

export interface OidcVerifierOptions {
  /** The provider's issuer, as in its tokens, e.g. `https://login.example.org/realms/iqb`. */
  issuer: string;
  /**
   * The client the tokens have to be for: named in `aud` or as `azp`. Also selects the client's
   * roles. An ID token names the client in `aud` as well: with a provider that does not say in the
   * token what it is (Keycloak does, in `typ`), configure {@link audience} too.
   */
  clientId?: string;
  /**
   * An audience the tokens have to name in `aud`, checked strictly -- the API's own audience, which
   * an ID token never names.
   */
  audience?: string | string[];
  /** Where the provider's keys are; found through its discovery document when not given. */
  jwksUri?: string;
  /** Leeway for `exp` and `nbf` between the provider's clock and ours. */
  clockToleranceSeconds?: number;
  /** Told why a token was refused -- an everyday event, for a debug log. */
  onRejected?: (reason: string, error?: unknown) => void;
  /**
   * Told when the provider cannot be asked -- unreachable, or configured wrongly: then no token
   * holds, and someone has to look. For a warning in the log.
   */
  onUnavailable?: (reason: string, error?: unknown) => void;
}

/**
 * Only asymmetric signatures: the provider signs with its private key, everyone checks with its
 * public one. `none` and the HMAC algorithms would let anyone holding the shared secret -- or no
 * secret at all -- sign as the provider.
 */
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

/** What an access token may say it is, in its header; an ID token says nothing, or `JWT`. */
const ACCESS_TOKEN_HEADER_TYPES = ['jwt', 'at+jwt', 'application/at+jwt'];

/** Claims only an ID token carries (OpenID Connect Core): the hashes of the codes issued with it. */
const ID_TOKEN_CLAIMS = ['at_hash', 'c_hash'];

const DISCOVERY_TIMEOUT_MS = 5000;

/** How long a failed discovery stands before it is tried again -- not with every token. */
const DISCOVERY_RETRY_MS = 30 * 1000;

/** How the provider's keys are kept: refetched at most every 10 minutes, or for an unknown key id. */
const KEY_SET_OPTIONS = { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000, timeoutDuration: 5000 };

/** A refusal of the token itself. */
class TokenRejected extends Error {}

/** The provider could not be asked. */
class ProviderUnavailable extends Error {}

/** An issuer as compared: `.../realms/iqb/` and `.../realms/iqb` are the same provider. */
const withoutTrailingSlash = (issuer: string): string => issuer.replace(/\/+$/, '');

/**
 * Checks access tokens of one OpenID Connect provider: its signature against the provider's
 * published keys, the issuer, the expiry, that it is an access token where it says what it is,
 * and, where configured, the client and the audience. A token that holds yields the identity it
 * names; any other yields `null` -- nothing throws, as every refusal is the same answer to the
 * caller: not this person.
 */
export class OidcVerifier {
  private keySet: Promise<JWTVerifyGetKey> | null = null;
  private keySetFailedAt = 0;
  private readonly issuer: string;

  constructor(private readonly options: OidcVerifierOptions) {
    this.issuer = withoutTrailingSlash(options.issuer);
  }

  async verify(token: string): Promise<OidcIdentity | null> {
    try {
      this.checkHeader(token);
      const { payload } = await jwtVerify(token, await this.keys(), {
        audience: this.options.audience,
        algorithms: ALGORITHMS,
        // jose checks the expiry only where there is one: a token without it would never expire
        requiredClaims: ['exp'],
        clockTolerance: this.options.clockToleranceSeconds ?? 30
      });
      this.checkClaims(payload);
      return identityOf(payload, this.options.clientId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderUnavailable) {
        this.options.onUnavailable?.(reason, error);
      } else {
        this.options.onRejected?.(reason, error);
      }
      return null;
    }
  }

  private checkHeader(token: string): void {
    let type: unknown;
    try {
      type = decodeProtectedHeader(token).typ;
    } catch {
      throw new TokenRejected('the token is no JWT');
    }
    if (type !== undefined && !ACCESS_TOKEN_HEADER_TYPES.includes(String(type).toLowerCase())) {
      throw new TokenRejected(`the token is of the type ${String(type)}`);
    }
  }

  private checkClaims(payload: JWTPayload): void {
    if (typeof payload.iss !== 'string' || withoutTrailingSlash(payload.iss) !== this.issuer) {
      throw new TokenRejected(`the token's issuer is ${String(payload.iss)}`);
    }
    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      throw new TokenRejected('the token names no subject');
    }
    // Keycloak says in `typ` what a token is; an ID token or a refresh token is no key to an API
    if (payload.typ !== undefined && String(payload.typ).toLowerCase() !== 'bearer') {
      throw new TokenRejected(`the token is a ${String(payload.typ)} token, no access token`);
    }
    // Other providers do not say it, but an ID token gives itself away by these
    const idTokenClaim = ID_TOKEN_CLAIMS.find(claim => claim in payload);
    if (idTokenClaim) throw new TokenRejected(`the token carries ${idTokenClaim}: an ID token, no access token`);
    this.checkClient(payload);
  }

  /** The client has to be named in `aud` or be the authorised party, as Keycloak puts it. */
  private checkClient(payload: JWTPayload): void {
    const { clientId } = this.options;
    if (!clientId) return;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.azp !== clientId && !audiences.includes(clientId)) {
      throw new TokenRejected(`the token is not for the client ${clientId}`);
    }
  }

  /**
   * The provider's keys. A failed discovery stands for {@link DISCOVERY_RETRY_MS}: while the
   * provider is down, not every token sends another request after it.
   */
  private keys(): Promise<JWTVerifyGetKey> {
    if (this.keySet && this.keySetFailedAt && Date.now() - this.keySetFailedAt >= DISCOVERY_RETRY_MS) {
      this.keySet = null;
    }
    if (!this.keySet) {
      this.keySetFailedAt = 0;
      const keySet = this.jwksUri()
        .then(uri => createRemoteJWKSet(new URL(uri), KEY_SET_OPTIONS))
        .catch((error: unknown) => {
          this.keySetFailedAt = Date.now();
          throw error instanceof ProviderUnavailable ? error : new ProviderUnavailable(String(error));
        });
      this.keySet = keySet;
    }
    return this.keySet.then(getKey => async (header, input) => {
      try {
        return await getKey(header, input);
      } catch (error) {
        // No key, or several, for the token's key id is the token's fault; keys that cannot be
        // fetched are the provider's
        if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error;
        throw new ProviderUnavailable(`the provider's keys could not be fetched: ${String(error)}`);
      }
    });
  }

  private async jwksUri(): Promise<string> {
    if (this.options.jwksUri) return this.options.jwksUri;
    const discovery = `${this.issuer}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await fetch(discovery, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    } catch (error) {
      throw new ProviderUnavailable(`the discovery document at ${discovery} could not be fetched: ${error}`);
    }
    if (!response.ok) {
      throw new ProviderUnavailable(`the discovery document at ${discovery} answered ${response.status}`);
    }
    const document = await response.json() as { issuer?: unknown; jwks_uri?: unknown };
    // A document that names another issuer belongs to another provider
    if (typeof document.issuer !== 'string' || withoutTrailingSlash(document.issuer) !== this.issuer) {
      throw new ProviderUnavailable(`the discovery document names the issuer ${String(document.issuer)}`);
    }
    if (typeof document.jwks_uri !== 'string') {
      throw new ProviderUnavailable('the discovery document names no jwks_uri');
    }
    return document.jwks_uri;
  }
}
