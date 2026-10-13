import { HttpErrorResponse } from '@angular/common/http';
import { gateRefusalOf, isAutomationDetected, isGateRefusal } from './gate-refusal';

describe('isAutomationDetected', () => {
  it('should recognise the gateway\'s refusal of an automated browser', () => {
    const error = new HttpErrorResponse({
      status: 403, error: { code: 'automation-detected', signals: ['webdriver'] }
    });
    expect(isAutomationDetected(error)).toBe(true);
  });

  it('should not take any other error for it', () => {
    expect(isAutomationDetected(new HttpErrorResponse({ status: 403, error: { code: 'other' } }))).toBe(false);
    expect(isAutomationDetected(new HttpErrorResponse({ status: 403, error: 'forbidden' }))).toBe(false);
    expect(isAutomationDetected(new HttpErrorResponse({ status: 428, error: { code: 'automation-detected' } })))
      .toBe(false);
    expect(isAutomationDetected(new Error('automation-detected'))).toBe(false);
  });
});

describe('gateRefusalOf and isGateRefusal', () => {
  it('should name why the gateway refused a request', () => {
    const automated = new HttpErrorResponse({ status: 403, error: { code: 'automation-detected' } });
    const notVerified = new HttpErrorResponse({ status: 428, error: { code: 'human-verification-required' } });

    expect(gateRefusalOf(automated)).toBe('automation-detected');
    expect(gateRefusalOf(notVerified)).toBe('not-verified');
    expect(isGateRefusal(automated)).toBe(true);
    expect(isGateRefusal(notVerified)).toBe(true);
  });

  // A 403 of the application is a missing permission: the application shows it as always
  it('should leave every error of the application to it', () => {
    expect(gateRefusalOf(new HttpErrorResponse({ status: 403, error: { message: 'no access' } }))).toBeNull();
    expect(isGateRefusal(new HttpErrorResponse({ status: 500 }))).toBe(false);
    expect(isGateRefusal(new Error('428'))).toBe(false);
    expect(gateRefusalOf(new HttpErrorResponse({ status: 428, error: { message: 'If-Match missing' } }))).toBeNull();
    expect(gateRefusalOf(new HttpErrorResponse({ status: 428 }))).toBeNull();
  });
});
