import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { createMock } from '@golevelup/ts-vitest';
import type { OidcIdentity as Identity } from '@iqb/gate-oidc';
import { OidcIdentity } from '../src/oidc-identity.decorator.js';
import type { OidcRequest } from '../src/tokens.js';

type ArgumentFactory = (data: unknown, context: ExecutionContext) => unknown;

/** What Nest calls for a parameter decorated with @OidcIdentity(). */
const factory: ArgumentFactory = (() => {
  class Handlers {
    handle(@OidcIdentity() _identity: Identity): void {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Handlers, 'handle') as Record<
    string,
    { factory: ArgumentFactory }
  >;
  return Object.values(args)[0].factory;
})();

const httpContext = (request: OidcRequest): ExecutionContext => {
  const http = createMock<HttpArgumentsHost>();
  http.getRequest.mockReturnValue(request);
  return createMock<ExecutionContext>({ getType: () => 'http', switchToHttp: () => http });
};

describe('@OidcIdentity()', () => {
  const identity: Identity = {
    issuer: 'https://login.example.org/realms/iqb',
    subject: 'f3b1c0de-anna',
    username: 'anna',
    email: 'anna@example.org',
    givenName: null,
    familyName: null,
    roles: [],
    claims: {}
  };

  it('hands the handler the identity the guard put on the request', () => {
    expect(factory(undefined, httpContext({ oidcIdentity: identity }))).toBe(identity);
  });

  it('refuses a request the guard did not check, rather than handling it without one', () => {
    expect(() => factory(undefined, httpContext({}))).toThrow(UnauthorizedException);
  });

  it('refuses what is no HTTP request', () => {
    const rpc = createMock<ExecutionContext>({ getType: () => 'rpc' });
    expect(() => factory(undefined, rpc)).toThrow(UnauthorizedException);
  });
});
