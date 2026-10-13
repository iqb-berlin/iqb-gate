import {
  DOCUMENT, inject, Injectable, Injector, runInInjectionContext
} from '@angular/core';
import {
  type HttpEvent, type HttpHandler, type HttpHandlerFn, type HttpInterceptor,
  type HttpInterceptorFn, type HttpRequest
} from '@angular/common/http';
import {
  catchError, type Observable, switchMap, throwError
} from 'rxjs';
import { CLIENT_SIGNALS_HEADER, GATE_PREFIX } from '@iqb/gate-protocol';
import { GateInputActivityService } from '../services/gate-input-activity.service';
import { GateVerificationService } from '../services/gate-verification.service';
import { GateRefusalNoticeService } from '../services/gate-refusal-notice.service';
import { gateRefusalOf, isVerificationRequired } from '../gate-refusal';

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
 * The browser half of the check that writes and reads come from a person (the gateway decides which
 * of them it checks). Every request to the page's own origin carries what the browser observed about
 * itself and its input. When the gateway answers 428, the challenge dialog opens, and the request is
 * sent again once it is solved; cancelled, the request fails with its 428 -- the person knows why.
 * When the gateway refuses the browser as automated, or asks again right after a solved challenge,
 * a notice says so (`GateRefusalNoticeService`) and the request fails: an application leaves such
 * errors out of its own display (`isGateRefusal`).
 *
 * Where the gateway checks nothing it ignores the header and never answers 428 or refuses, so this
 * changes nothing there. Register it after the interceptor that adds the token, so that the repeated
 * request carries it as well: `provideHttpClient(withInterceptors([..., iqbGateInterceptor]))`.
 */
export const iqbGateInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  if (!isGatedRequest(req.url, inject(DOCUMENT))) return next(req);
  const inputActivity = inject(GateInputActivityService);
  // The dialogs need HttpClient, which needs the interceptors: fetched only when the gateway answers
  const injector = inject(Injector);
  const withSignals = () => req.clone({
    setHeaders: { [CLIENT_SIGNALS_HEADER]: JSON.stringify(inputActivity.signals()) }
  });
  /** Tells the person why the gateway refused, and fails the request. */
  const refused = (error: unknown) => {
    const refusal = gateRefusalOf(error);
    if (refusal) injector.get(GateRefusalNoticeService).show(refusal);
    return throwError(() => error);
  };
  return next(withSignals()).pipe(
    catchError((error: unknown) => {
      if (!isVerificationRequired(error)) return refused(error);
      return injector.get(GateVerificationService).verify().pipe(
        switchMap(verified => (verified ? next(withSignals()).pipe(catchError(refused)) : throwError(() => error)))
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
