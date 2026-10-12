import {
  type EnvironmentProviders, inject, Injector, makeEnvironmentProviders, provideAppInitializer, runInInjectionContext
} from '@angular/core';
import { type GateTextsOverride, IQB_GATE_TEXTS, mergeGateTexts } from './gate-texts';
import { GateInputActivityService } from './services/gate-input-activity.service';

export interface IqbGateOptions {
  /**
   * Texts instead of the library's German ones: given as they are, or as a function that is asked
   * each time the dialog opens, in an injection context -- for an application's translations.
   */
  texts?: GateTextsOverride | (() => GateTextsOverride);
}

/**
 * Sets the library up: watches input from the start of the application (the first write already
 * reports it) and takes the application's texts. The interceptor is registered with the
 * application's HTTP client: `withInterceptors([iqbGateInterceptor])`, or `IqbGateInterceptor` as
 * class.
 */
export function provideIqbGate(options: IqbGateOptions = {}): EnvironmentProviders {
  const { texts } = options;
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      inject(GateInputActivityService);
    }),
    {
      provide: IQB_GATE_TEXTS,
      useFactory: () => {
        const injector = inject(Injector);
        return () => mergeGateTexts(typeof texts === 'function' ? runInInjectionContext(injector, texts) : texts);
      }
    }
  ]);
}
