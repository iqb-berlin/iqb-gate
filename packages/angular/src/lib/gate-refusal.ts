import { HttpErrorResponse } from '@angular/common/http';
import {
  AUTOMATION_DETECTED_CODE,
  AUTOMATION_DETECTED_STATUS,
  GATE_REFUSAL_HEADER,
  HUMAN_VERIFICATION_REQUIRED_CODE,
  HUMAN_VERIFICATION_REQUIRED_STATUS
} from '@iqb/gate-protocol';

/**
 * Why the gateway did not let a request through: the browser reported automation, or it was not
 * confirmed that a person is at work.
 */
export type GateRefusal = 'automation-detected' | 'not-verified';

/**
 * Whether the gateway refused a request because the browser reported automation -- for the
 * application to say so in its own words instead of showing a general error.
 */
export function isAutomationDetected(error: unknown): boolean {
  return isGateAnswer(error, AUTOMATION_DETECTED_STATUS, AUTOMATION_DETECTED_CODE);
}

/**
 * Whether the gateway asks for the challenge -- its 428 names itself in a header and in the body, so
 * that a 428 of the application's own is left to the application.
 */
export function isVerificationRequired(error: unknown): boolean {
  return isGateAnswer(error, HUMAN_VERIFICATION_REQUIRED_STATUS, HUMAN_VERIFICATION_REQUIRED_CODE);
}

/**
 * A JSON answer names the refusal in its body, and only there: behind ForwardAuth the
 * application's own answers bypass the gateway, which cannot drop a header they carry. The header
 * names it for an answer whose body cannot be read -- none for HEAD, a Blob, text or an
 * ArrayBuffer for a download.
 */
function isGateAnswer(error: unknown, status: number, code: string): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== status) return false;
  const body: unknown = error.error;
  const json = typeof body === 'object' && body !== null && !(body instanceof Blob) && !(body instanceof ArrayBuffer);
  if (json) return (body as { code?: unknown }).code === code;
  return error.headers.get(GATE_REFUSAL_HEADER) === code;
}

/** Why the gateway refused the request of `error`, or `null` for any other error. */
export function gateRefusalOf(error: unknown): GateRefusal | null {
  if (isAutomationDetected(error)) return 'automation-detected';
  if (isVerificationRequired(error)) return 'not-verified';
  return null;
}

/**
 * Whether the gateway, not the application, refused the request of `error`. The library has already
 * told the person why (or they cancelled the challenge themselves), so an application leaves such an
 * error out of its own error display.
 */
export function isGateRefusal(error: unknown): boolean {
  return gateRefusalOf(error) !== null;
}
