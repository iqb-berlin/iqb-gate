import {
  type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException
} from '@nestjs/common';
import type { OidcVerifier } from '@iqb/gate-oidc';
import {
  OIDC_USER_SYNC, OIDC_VERIFIER, type OidcRequest, type OidcUserSync
} from './tokens.js';

function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1] ?? null;
}

/** The HTTP request of a context; anything else -- GraphQL, WebSockets -- is refused, not guessed at. */
export function httpRequestOf(context: ExecutionContext): OidcRequest {
  if (context.getType() !== 'http') throw new UnauthorizedException();
  return context.switchToHttp().getRequest<OidcRequest>();
}

/**
 * Lets an HTTP request in when its `Authorization: Bearer` token is one of the OpenID Connect
 * provider the module was set up with. Puts the identity on `request.oidcIdentity`, and -- when
 * the module was given a `userSync` -- the application's own user on `request.user`. Everything
 * else is 401, without saying why: the reason goes to the module's log.
 *
 * The verifier and the user sync come from `IqbOidcModule`, never from the module that uses the
 * guard: every use of it -- in a feature module, as global guard -- applies the same rules.
 */
@Injectable()
export class OidcAuthGuard implements CanActivate {
  constructor(
    @Inject(OIDC_VERIFIER) private readonly verifier: OidcVerifier,
    @Inject(OIDC_USER_SYNC) private readonly userSync: OidcUserSync | null
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = httpRequestOf(context);
    const token = bearerToken(request.headers?.authorization);
    const identity = token ? await this.verifier.verify(token) : null;
    if (!identity) throw new UnauthorizedException();
    request.oidcIdentity = identity;
    if (this.userSync) {
      const user = await this.userSync.sync(identity);
      if (user === null || user === undefined) throw new UnauthorizedException();
      request.user = user;
    }
    return true;
  }
}
