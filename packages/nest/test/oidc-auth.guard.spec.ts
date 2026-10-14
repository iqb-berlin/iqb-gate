import 'reflect-metadata';
import {
  afterAll, afterEach, beforeAll, describe, expect, it
} from 'vitest';
import {
  Controller, Get, type INestApplication, Inject, Injectable, Module, Req, UseGuards,
  type ExecutionContext, type ModuleMetadata, type Provider, UnauthorizedException
} from '@nestjs/common';
import { createMock } from '@golevelup/ts-vitest';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { FakeProvider, foreignToken } from '@iqb/gate-oidc/testing';
import {
  IqbOidcModule, OIDC_VERIFIER, OidcAuthGuard, OidcIdentity, type OidcIdentityData, OidcVerifier
} from '../src/index.js';

@Controller('protected')
class ProtectedController {
  @Get()
  @UseGuards(OidcAuthGuard)
  read(@OidcIdentity() identity: OidcIdentityData, @Req() request: { user?: unknown }) {
    return { username: identity.username, roles: identity.roles, user: request.user ?? null };
  }

  @Get('unguarded')
  unguarded(@OidcIdentity() identity: OidcIdentityData) {
    return { username: identity.username };
  }
}

/** A controller in a module of its own, as applications lay them out. */
@Module({ controllers: [ProtectedController] })
class FeatureModule {}

/** The application's users: a user per person; `nobody` is kept out. */
@Injectable()
class UsersService {
  find(username: string) {
    return username === 'nobody' ? null : { id: 7, name: username };
  }
}

@Module({ providers: [UsersService], exports: [UsersService] })
class UsersModule {}

describe('OidcAuthGuard', () => {
  const provider = new FakeProvider();
  let app: INestApplication | undefined;
  let base: string;

  const start = async (imports: NonNullable<ModuleMetadata['imports']>, providers: Provider[] = []) => {
    const moduleRef = await Test.createTestingModule({ imports, providers }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  const read = (token?: string, path = '/protected') => fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });

  /** Settings with a user sync that uses the application's own service. */
  const withUsers = () => IqbOidcModule.forRootAsync({
    imports: [UsersModule],
    inject: [UsersService],
    useFactory: (users: UsersService) => ({
      issuer: provider.issuer,
      clientId: 'studio',
      userSync: { sync: identity => users.find(identity.username) }
    })
  });

  beforeAll(() => provider.start());
  afterAll(() => provider.stop());
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets in a token of the provider, with the identity it names', async () => {
    await start([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' }), FeatureModule]);
    const response = await read(await provider.sign({ realm_access: { roles: ['admin'] } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: 'anna', roles: ['admin'], user: null });
  });

  it('keeps out a request without a token, a forged one and one for another client', async () => {
    await start([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' }), FeatureModule]);
    expect((await read()).status).toBe(401);
    expect((await read(await foreignToken(provider.issuer))).status).toBe(401);
    expect((await read(await provider.sign({ azp: 'coding-box' }))).status).toBe(401);
    expect((await read('not-a-token')).status).toBe(401);
  });

  // The guard in a feature module has to apply the user sync of the root: whom it does not take stays out
  // 403, not 401: a browser would take a 401 for an expired login and log in again
  it('puts the application\'s user on the request, in feature modules too, and forbids whom it refuses', async () => {
    await start([withUsers(), FeatureModule]);
    expect(await (await read(await provider.sign())).json())
      .toEqual(expect.objectContaining({ user: { id: 7, name: 'anna' } }));
    expect((await read(await provider.sign({ preferred_username: 'nobody' }))).status).toBe(403);
  });

  it('applies the user sync as global guard as well', async () => {
    await start([withUsers(), FeatureModule], [{ provide: APP_GUARD, useExisting: OidcAuthGuard }]);
    expect((await read(await provider.sign({ preferred_username: 'nobody' }))).status).toBe(403);
    expect((await read(await provider.sign(), '/protected/unguarded')).status).toBe(200);
  });

  it('refuses a handler the identity of a route the guard did not check', async () => {
    await start([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' }), FeatureModule]);
    expect((await read(await provider.sign(), '/protected/unguarded')).status).toBe(401);
  });

  // coding-box checks Keycloak tokens and its own workspace tokens in one passport strategy
  it('hands the verifier to an application\'s own strategy', async () => {
    @Injectable()
    class OwnStrategy {
      constructor(@Inject(OIDC_VERIFIER) readonly verifier: OidcVerifier) {}
    }
    const moduleRef = await Test.createTestingModule({
      imports: [IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' })],
      providers: [OwnStrategy]
    }).compile();
    const strategy = moduleRef.get(OwnStrategy);
    expect(strategy.verifier).toBeInstanceOf(OidcVerifier);
    expect((await strategy.verifier.verify(await provider.sign()))?.username).toBe('anna');
    await moduleRef.close();
  });

  it('refuses what is no HTTP request, instead of failing on it', async () => {
    const guard = new OidcAuthGuard(new OidcVerifier({ issuer: provider.issuer }), null);
    const graphql = createMock<ExecutionContext>({ getType: () => 'graphql' });
    await expect(guard.canActivate(graphql)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
