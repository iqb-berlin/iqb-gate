import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  exportJWK, generateKeyPair, type JWK, type JWTPayload, SignJWT
} from 'jose';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * An OpenID Connect provider as far as a verifier sees it, for tests of the packages that check its
 * tokens: a discovery document and the keys it signs with. Signs tokens on request; can rotate keys
 * and count how often its keys were fetched. Not for anything but tests.
 */
export class FakeProvider {
  issuer = '';
  jwksFetches = 0;
  /** While set, the keys cannot be fetched: their address answers 503 (and counts the attempt). */
  keysDown = false;
  /** What the discovery document says the issuer is; the real one unless a test changes it. */
  announcedIssuer: string | null = null;
  private server: Server | null = null;
  private keys: Array<{ kid: string; privateKey: PrivateKey; publicJwk: JWK }> = [];

  async start(): Promise<void> {
    await this.addKey('key-1');
    this.server = createServer((request, response) => {
      if (request.url === '/realms/iqb/.well-known/openid-configuration') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          issuer: this.announcedIssuer ?? this.issuer,
          jwks_uri: `${this.issuer}/protocol/openid-connect/certs`
        }));
        return;
      }
      if (request.url === '/realms/iqb/protocol/openid-connect/certs') {
        this.jwksFetches += 1;
        if (this.keysDown) {
          response.writeHead(503).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ keys: this.keys.map(key => key.publicJwk) }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>(resolve => { this.server?.listen(0, '127.0.0.1', () => resolve()); });
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/realms/iqb`;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => { this.server?.close(resolve); });
  }

  async addKey(kid: string): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    this.keys.push({ kid, privateKey, publicJwk: { ...await exportJWK(publicKey), kid, alg: 'RS256', use: 'sig' } });
  }

  /**
   * A token as the provider issues it: signed with its newest key, valid for five minutes --
   * `expiresIn: null` leaves the expiry out.
   */
  async sign(claims: JWTPayload = {}, options: { kid?: string; expiresIn?: string | null } = {}): Promise<string> {
    const key = options.kid ? this.keys.find(candidate => candidate.kid === options.kid) : this.keys.at(-1);
    if (!key) throw new Error(`no key ${options.kid}`);
    const token = new SignJWT({
      iss: this.issuer,
      sub: 'f3b1c0de-anna',
      typ: 'Bearer',
      preferred_username: 'anna',
      email: 'anna@example.org',
      azp: 'studio',
      ...claims
    })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuedAt();
    if (options.expiresIn !== null) token.setExpirationTime(options.expiresIn ?? '5m');
    return token.sign(key.privateKey);
  }
}

/** A token signed with a key the provider does not know: what a forger would make, naming anyone. */
export async function foreignToken(issuer: string, claims: JWTPayload = {}): Promise<string> {
  const { privateKey } = await generateKeyPair('RS256');
  return new SignJWT({ sub: 'mallory', azp: 'studio', typ: 'Bearer', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(issuer)
    .setExpirationTime('5m')
    .sign(privateKey);
}
