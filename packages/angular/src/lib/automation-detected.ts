import { HttpErrorResponse } from '@angular/common/http';
import { AUTOMATION_DETECTED_CODE, AUTOMATION_DETECTED_STATUS } from '@iqb/gate-protocol';

/**
 * Whether the gateway refused a write because the browser reported automation -- for the
 * application to say so in its own words instead of showing a general error.
 */
export function isAutomationDetected(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== AUTOMATION_DETECTED_STATUS) return false;
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === AUTOMATION_DETECTED_CODE;
}
