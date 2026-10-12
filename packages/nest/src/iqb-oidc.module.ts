import {
  type DynamicModule, type FactoryProvider, Logger, Module, type ModuleMetadata
} from '@nestjs/common';
import { OidcVerifier, type OidcVerifierOptions } from '@iqb/gate-oidc';
import { OIDC_USER_SYNC, OIDC_VERIFIER, type OidcUserSync } from './tokens.js';
import { OidcAuthGuard } from './oidc-auth.guard.js';

/**
 * What the module needs: the provider, and how a verified identity becomes the application's user
 * (optional; without it, the guard puts only the identity on the request). What the module hears
 * about refused tokens goes to its own log.
 */
export interface IqbOidcSettings extends Omit<OidcVerifierOptions, 'onRejected' | 'onUnavailable'> {
  userSync?: OidcUserSync;
}

/** The settings from elsewhere: a factory that may inject the application's services, e.g. its users. */
export interface IqbOidcAsyncSettings extends Pick<ModuleMetadata, 'imports'> {
  useFactory: FactoryProvider<IqbOidcSettings | Promise<IqbOidcSettings>>['useFactory'];
  inject?: FactoryProvider['inject'];
}

const SETTINGS = Symbol('IQB_OIDC_SETTINGS');

const logger = new Logger('IqbOidc');

function verifierFrom(settings: IqbOidcSettings): OidcVerifier {
  const { userSync, ...options } = settings;
  return new OidcVerifier({
    ...options,
    onRejected: reason => logger.debug(`token refused: ${reason}`),
    // While the provider cannot be asked, nobody gets in: someone has to look
    onUnavailable: reason => logger.warn(`the OpenID Connect provider cannot be asked: ${reason}`)
  });
}

/**
 * Checks the Bearer tokens of one OpenID Connect provider: `OidcAuthGuard` for the routes, and the
 * `OidcVerifier` (as `OIDC_VERIFIER`) for an application's own strategy that knows further tokens
 * of its own. Global, so that the guard can be used anywhere once the module is imported -- always
 * with the verifier and the user sync set up here.
 */
@Module({})
export class IqbOidcModule {
  static forRoot(settings: IqbOidcSettings): DynamicModule {
    return IqbOidcModule.withSettings({ provide: SETTINGS, useFactory: () => settings }, []);
  }

  /** With settings from elsewhere, e.g. `ConfigService`, and a user sync that uses the application's services. */
  static forRootAsync(settings: IqbOidcAsyncSettings): DynamicModule {
    return IqbOidcModule.withSettings(
      { provide: SETTINGS, useFactory: settings.useFactory, inject: settings.inject ?? [] },
      settings.imports ?? []
    );
  }

  private static withSettings(settings: FactoryProvider, imports: ModuleMetadata['imports']): DynamicModule {
    return {
      module: IqbOidcModule,
      global: true,
      imports,
      providers: [
        settings,
        { provide: OIDC_VERIFIER, useFactory: verifierFrom, inject: [SETTINGS] },
        {
          provide: OIDC_USER_SYNC,
          useFactory: (resolved: IqbOidcSettings) => resolved.userSync ?? null,
          inject: [SETTINGS]
        },
        OidcAuthGuard
      ],
      // Nest builds a guard named in @UseGuards in the module of the controller: the user sync is
      // exported so that it is found there -- always the one of these settings
      exports: [OIDC_VERIFIER, OIDC_USER_SYNC, OidcAuthGuard]
    };
  }
}
