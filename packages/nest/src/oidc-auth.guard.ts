import {
  type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException
} from '@nestjs/common';
import { bearerToken, type OidcVerifier } from '@iqb/gate-oidc';
import {
  OIDC_USER_SYNC, OIDC_VERIFIER, type OidcRequest, type OidcUserSync
} from './tokens.js';

/** The HTTP request of a context; anything else -- GraphQL, WebSockets -- is refused, not guessed at. */
export function httpRequestOf(context: ExecutionContext): OidcRequest {
  if (context.getType() !== 'http') throw new UnauthorizedException();
  return context.switchToHttp().getRequest<OidcRequest>();
}

/**
 * Lets an HTTP request in when its `Authorization: Bearer` token is one of the OpenID Connect
 * provider the module was set up with. Puts the identity on `request.oidcIdentity`, and -- when
 * the module was given a `userSync` -- the application's own user on `request.user`. A request
 * without a valid token is 401; a person the user sync refuses is 403 -- known, but not let in, so
 * that a browser does not take it for an expired login and log in again. The reason of a 401 goes
 * to the module's log.
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
      if (user === null || user === undefined) throw new ForbiddenException();
      request.user = user;
    }
    return true;
  }
}
