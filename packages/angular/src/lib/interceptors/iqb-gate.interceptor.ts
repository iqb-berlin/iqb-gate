import {
  DOCUMENT, inject, Injectable, Injector, runInInjectionContext
} from '@angular/core';
import {
  type HttpEvent, HttpErrorResponse, type HttpHandler, type HttpHandlerFn, type HttpInterceptor,
  type HttpInterceptorFn, type HttpRequest
} from '@angular/common/http';
import {
  catchError, type Observable, switchMap, throwError
} from 'rxjs';
import {
  CLIENT_SIGNALS_HEADER, GATE_PREFIX, HUMAN_VERIFICATION_REQUIRED_STATUS, SAVING_METHODS
} from '@iqb/gate-protocol';
import { GateInputActivityService } from '../services/gate-input-activity.service';
import { GateVerificationService } from '../services/gate-verification.service';

/**
 * Whether a request goes through the gateway in front of this page -- its own origin -- and is
 * not one of the gateway's own. A header on a request to another origin (an identity provider)
 * would cost a CORS preflight that origin may refuse.
 */
function isGatedRequest(url: string, document: Document): boolean {
  try {
    const target = new URL(url, document.baseURI);
    return target.origin === new URL(document.baseURI).origin && !target.pathname.startsWith(`${GATE_PREFIX}/`);
  } catch {
    // A URL that cannot be resolved is sent as it is; the gateway decides about it
    return false;
  }
}

/**
 * The browser half of the check that writes come from a person (the gateway decides which writes
 * it checks). Every write to the page's own origin carries what the browser observed about itself
 * and its input. When the gateway answers 428, the challenge dialog opens, and the write is sent
 * again once it is solved; cancelled, the write fails with its 428.
 *
 * Where the gateway checks nothing it ignores the header and never answers 428, so this changes
 * nothing there. Register it after the interceptor that adds the token, so that the repeated
 * request carries it as well: `provideHttpClient(withInterceptors([..., iqbGateInterceptor]))`.
 */
export const iqbGateInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  if (!SAVING_METHODS.includes(req.method) || !isGatedRequest(req.url, inject(DOCUMENT))) return next(req);
  const inputActivity = inject(GateInputActivityService);
  // The dialog needs HttpClient, which needs the interceptors: fetched only when a 428 comes
  const injector = inject(Injector);
  const withSignals = () => req.clone({
    setHeaders: { [CLIENT_SIGNALS_HEADER]: JSON.stringify(inputActivity.signals()) }
  });
  return next(withSignals()).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== HUMAN_VERIFICATION_REQUIRED_STATUS) {
        return throwError(() => error);
      }
      return injector.get(GateVerificationService).verify().pipe(
        switchMap(verified => (verified ? next(withSignals()) : throwError(() => error)))
      );
    })
  );
};

/**
 * {@link iqbGateInterceptor} for applications that register their interceptors as classes:
 * `{ provide: HTTP_INTERCEPTORS, useClass: IqbGateInterceptor, multi: true }`.
 */
@Injectable({
  providedIn: 'root'
})
export class IqbGateInterceptor implements HttpInterceptor {
  private readonly injector = inject(Injector);

  intercept(req: HttpRequest<unknown>, handler: HttpHandler): Observable<HttpEvent<unknown>> {
    return runInInjectionContext(this.injector, () => iqbGateInterceptor(req, next => handler.handle(next)));
  }
}
