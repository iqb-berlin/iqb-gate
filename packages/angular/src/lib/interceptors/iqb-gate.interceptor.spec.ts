import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS, HttpClient, HttpErrorResponse, HttpRequest, HttpResponse, provideHttpClient,
  withInterceptors, withInterceptorsFromDi
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  firstValueFrom, type Observable, of, throwError
} from 'rxjs';
import { type ClientSignals, CLIENT_SIGNALS_HEADER } from '@iqb/gate-protocol';
import { iqbGateInterceptor, IqbGateInterceptor } from './iqb-gate.interceptor';
import { GateInputActivityService } from '../services/gate-input-activity.service';
import { GateVerificationService } from '../services/gate-verification.service';

jest.mock('altcha', () => ({}));

describe('iqbGateInterceptor', () => {
  let verification: { verify: jest.Mock };
  const signals: ClientSignals = {
    webdriver: false,
    headless: false,
    untrustedInput: false,
    msSinceTrustedInput: 300,
    softwareRenderer: false,
    devtoolsProtocol: false
  };

  const required = new HttpErrorResponse({ status: 428, url: '/api/workspaces/1/units/2/properties' });
  const saved = new HttpResponse({ status: 200, body: true });

  /** A handler that answers each call with the next of the given answers. */
  const handlerAnswering = (...answers: Array<HttpResponse<unknown> | HttpErrorResponse>) => jest.fn(
    (_request: HttpRequest<unknown>): Observable<HttpResponse<unknown>> => {
      const answer = answers.shift();
      return answer instanceof HttpErrorResponse ? throwError(() => answer) : of(answer as HttpResponse<unknown>);
    }
  );

  const intercept = (request: HttpRequest<unknown>, next: ReturnType<typeof handlerAnswering>) => runInInjectionContext(
    TestBed.inject(EnvironmentInjector),
    () => firstValueFrom(iqbGateInterceptor(request, next))
  );

  beforeEach(() => {
    verification = { verify: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: GateInputActivityService, useValue: { signals: () => signals } },
        { provide: GateVerificationService, useValue: verification }
      ]
    });
  });

  it('should leave reading requests as they are', async () => {
    const next = handlerAnswering(saved);
    const request = new HttpRequest('GET', '/api/workspaces');

    await intercept(request, next);

    expect(next).toHaveBeenCalledWith(request);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('should send what the browser observed with a %s', async method => {
    const next = handlerAnswering(saved);

    await intercept(new HttpRequest(method, '/api/x', null), next);

    const sent = next.mock.calls[0][0];
    expect(JSON.parse(sent.headers.get(CLIENT_SIGNALS_HEADER) as string)).toEqual(signals);
  });

  // An identity provider on another origin would see a CORS preflight it may refuse
  it('should leave requests to other origins as they are', async () => {
    const next = handlerAnswering(saved);
    const request = new HttpRequest('POST', 'https://login.example.org/token', null);

    await intercept(request, next);

    expect(next).toHaveBeenCalledWith(request);
  });

  it('should leave the gateway\'s own requests as they are', async () => {
    const next = handlerAnswering(saved);
    const request = new HttpRequest('POST', '/.iqb-gate/verify', { payload: 'x' });

    await intercept(request, next);

    expect(next).toHaveBeenCalledWith(request);
  });

  it('should send the report to its own origin, written out in full', async () => {
    const next = handlerAnswering(saved);

    await intercept(new HttpRequest('POST', `${document.location.origin}/api/x`, null), next);

    expect(next.mock.calls[0][0].headers.has(CLIENT_SIGNALS_HEADER)).toBe(true);
  });

  it('should send a request whose URL cannot be resolved as it is', async () => {
    const next = handlerAnswering(saved);
    const request = new HttpRequest('POST', 'http://[bad', null);

    await intercept(request, next);

    expect(next).toHaveBeenCalledWith(request);
  });

  it('should pass any other error on', async () => {
    const next = handlerAnswering(new HttpErrorResponse({ status: 403 }));

    await expect(intercept(new HttpRequest('PATCH', '/api/x', {}), next)).rejects.toMatchObject({ status: 403 });
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('should open the challenge on 428 and send the write again once it is solved', async () => {
    verification.verify.mockReturnValue(of(true));
    const next = handlerAnswering(required, saved);

    const answer = await intercept(new HttpRequest('PATCH', '/api/x', {}), next);

    expect(answer).toBe(saved);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[1][0].headers.has(CLIENT_SIGNALS_HEADER)).toBe(true);
  });

  it('should let the write fail with its 428 when the challenge is cancelled', async () => {
    verification.verify.mockReturnValue(of(false));
    const next = handlerAnswering(required);

    await expect(intercept(new HttpRequest('PATCH', '/api/x', {}), next)).rejects.toBe(required);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('the interceptor in an HTTP client', () => {
  const signals = { webdriver: false } as ClientSignals;

  const setUp = (providers: unknown[]) => {
    TestBed.configureTestingModule({
      providers: [
        ...providers as never[],
        provideHttpClientTesting(),
        { provide: GateInputActivityService, useValue: { signals: () => signals } },
        { provide: GateVerificationService, useValue: { verify: () => of(true) } }
      ]
    });
    return { http: TestBed.inject(HttpClient), controller: TestBed.inject(HttpTestingController) };
  };

  it('works as a function', () => {
    const { http, controller } = setUp([provideHttpClient(withInterceptors([iqbGateInterceptor]))]);
    http.post('/api/x', {}).subscribe();
    expect(controller.expectOne('/api/x').request.headers.has(CLIENT_SIGNALS_HEADER)).toBe(true);
  });

  it('works as a class', () => {
    const { http, controller } = setUp([
      provideHttpClient(withInterceptorsFromDi()),
      { provide: HTTP_INTERCEPTORS, useClass: IqbGateInterceptor, multi: true }
    ]);
    http.post('/api/x', {}).subscribe();
    expect(controller.expectOne('/api/x').request.headers.has(CLIENT_SIGNALS_HEADER)).toBe(true);
  });

  it('repeats the write after the challenge', () => {
    const { http, controller } = setUp([provideHttpClient(withInterceptors([iqbGateInterceptor]))]);
    const answers: unknown[] = [];
    http.post('/api/x', {}).subscribe(answer => answers.push(answer));
    controller.expectOne('/api/x').flush(null, { status: 428, statusText: 'Precondition Required' });
    controller.expectOne('/api/x').flush({ saved: true });
    expect(answers).toEqual([{ saved: true }]);
  });
});
