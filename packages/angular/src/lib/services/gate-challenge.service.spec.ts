import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GateChallengeService } from './gate-challenge.service';

describe('GateChallengeService', () => {
  let service: GateChallengeService;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(GateChallengeService);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('should fetch a challenge from the gateway', () => {
    const challenges: unknown[] = [];
    service.challenge().subscribe(challenge => challenges.push(challenge));
    controller.expectOne({ method: 'GET', url: '/.iqb-gate/challenge' }).flush({ parameters: {}, signature: 's' });
    expect(challenges).toEqual([{ parameters: {}, signature: 's' }]);
  });

  it('should give null when no challenge can be fetched', () => {
    const challenges: unknown[] = [];
    service.challenge().subscribe(challenge => challenges.push(challenge));
    controller.expectOne('/.iqb-gate/challenge').flush(null, { status: 502, statusText: 'Bad Gateway' });
    expect(challenges).toEqual([null]);
  });

  it('should hand the solution in and say whether it was accepted', () => {
    const results: boolean[] = [];
    service.verify('payload').subscribe(result => results.push(result));
    service.verify('wrong').subscribe(result => results.push(result));
    const [accepted, rejected] = controller.match('/.iqb-gate/verify');
    expect(accepted.request.method).toBe('POST');
    expect(accepted.request.body).toEqual({ payload: 'payload' });
    accepted.flush(true);
    rejected.flush(null, { status: 400, statusText: 'Bad Request' });
    expect(results).toEqual([true, false]);
  });
});
