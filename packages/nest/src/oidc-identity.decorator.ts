import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { OidcIdentity as Identity } from '@iqb/gate-oidc';
import { httpRequestOf } from './oidc-auth.guard.js';

/**
 * The identity `OidcAuthGuard` verified, as a handler's parameter. On a route the guard did not
 * check, there is none, and the request is refused rather than handled without one.
 */
export const OidcIdentity = createParamDecorator((_data: unknown, context: ExecutionContext): Identity => {
  const identity = httpRequestOf(context).oidcIdentity;
  if (!identity) throw new UnauthorizedException();
  return identity;
});
