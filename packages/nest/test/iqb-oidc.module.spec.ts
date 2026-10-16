import 'reflect-metadata';
import {
  afterAll, beforeAll, describe, expect, it
} from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeProvider } from '@iqb/gate-oidc/testing';
import {
  IqbOidcModule, type IqbOidcSettings, OIDC_VERIFIER, OidcAuthGuard, type OidcUserSync, OidcVerifier
} from '../src/index.js';
import { OIDC_USER_SYNC } from '../src/tokens.js';

describe('IqbOidcModule', () => {
  const provider = new FakeProvider();
  const userSync: OidcUserSync = { sync: identity => ({ name: identity.username }) };

  const compile = (imports: Parameters<typeof Test.createTestingModule>[0]['imports']) => Test
    .createTestingModule({ imports })
    .compile();

  beforeAll(() => provider.start());
  afterAll(() => provider.stop());

  it('makes the verifier from the settings, for the provider and the client named there', async () => {
    const moduleRef = await compile([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' })]);
    const verifier = moduleRef.get<OidcVerifier>(OIDC_VERIFIER);
    expect(verifier).toBeInstanceOf(OidcVerifier);
    expect((await verifier.verify(await provider.sign()))?.username).toBe('anna');
    expect(await verifier.verify(await provider.sign({ azp: 'coding-box' }))).toBeNull();
    await moduleRef.close();
  });

  it('hands on the user sync of the settings, and none without one', async () => {
    const withSync = await compile([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio', userSync })]);
    expect(withSync.get(OIDC_USER_SYNC)).toBe(userSync);
    await withSync.close();

    const without = await compile([IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' })]);
    expect(without.get(OIDC_USER_SYNC)).toBeNull();
    await without.close();
  });

  it('builds the settings with what forRootAsync injects', async () => {
    @Injectable()
    class OidcSettingsSource {
      settings(): IqbOidcSettings {
        return { issuer: provider.issuer, clientId: 'studio', userSync };
      }
    }
    @Module({ providers: [OidcSettingsSource], exports: [OidcSettingsSource] })
    class SettingsModule {}

    const moduleRef = await compile([IqbOidcModule.forRootAsync({
      imports: [SettingsModule],
      inject: [OidcSettingsSource],
      useFactory: (source: OidcSettingsSource) => source.settings()
    })]);
    expect((await moduleRef.get<OidcVerifier>(OIDC_VERIFIER).verify(await provider.sign()))?.username).toBe('anna');
    expect(moduleRef.get(OIDC_USER_SYNC)).toBe(userSync);
    await moduleRef.close();
  });

  it('is global: a feature module gets the guard and the verifier without importing it', async () => {
    @Injectable()
    class Feature {
      constructor(
        @Inject(OidcAuthGuard) readonly guard: OidcAuthGuard,
        @Inject(OIDC_VERIFIER) readonly verifier: OidcVerifier
      ) {}
    }
    @Module({ providers: [Feature] })
    class FeatureModule {}

    const moduleRef = await compile([
      IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' }),
      FeatureModule
    ]);
    const feature = moduleRef.get(Feature);
    expect(feature.guard).toBeInstanceOf(OidcAuthGuard);
    expect(feature.verifier).toBe(moduleRef.get(OIDC_VERIFIER));
    await moduleRef.close();
  });

  it('refuses settings without the client the tokens have to be for', async () => {
    const settings = { issuer: provider.issuer } as IqbOidcSettings;
    await expect(compile([IqbOidcModule.forRoot(settings)])).rejects.toThrow(/clientId/);
  });
});
