import { HttpErrorResponse } from '@angular/common/http';
import { isAutomationDetected } from './automation-detected';

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
