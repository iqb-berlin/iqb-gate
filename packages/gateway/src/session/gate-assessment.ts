import {
  AUTOMATION_DETECTED_CODE,
  AUTOMATION_DETECTED_STATUS,
  CHALLENGE_PATH,
  type GateRejection,
  HUMAN_VERIFICATION_REQUIRED_CODE,
  HUMAN_VERIFICATION_REQUIRED_STATUS,
  VERIFY_PATH
} from '@iqb/gate-protocol';

/** How a checked write or read was decided. */
export type GateOutcome = 'allowed' | 'automation-detected' | 'verification-required';

/** How a checked request is decided, and on which observations. */
export interface GateAssessment {
  outcome: GateOutcome;
  blockingSignals: string[];
  loggedSignals: string[];
}

/** Who sends a checked request -- the session of the gateway's cookie -- and what their browser reported. */
export interface Requester {
  sessionId: string;
  signalsHeader: string | string[] | undefined;
}

/** The body the gateway answers a request with that it does not let through; `null` for one it does. */
export function rejectionOf(assessment: GateAssessment): GateRejection | null {
  if (assessment.outcome === 'automation-detected') {
    return {
      statusCode: AUTOMATION_DETECTED_STATUS,
      error: 'Forbidden',
      code: AUTOMATION_DETECTED_CODE,
      message: 'The browser reports that it is automated; requests here have to come from a person.',
      signals: assessment.blockingSignals
    };
  }
  if (assessment.outcome === 'verification-required') {
    return {
      statusCode: HUMAN_VERIFICATION_REQUIRED_STATUS,
      error: 'Precondition Required',
      code: HUMAN_VERIFICATION_REQUIRED_CODE,
      message: `Solve the challenge at ${CHALLENGE_PATH}, hand it in at ${VERIFY_PATH}, then send the request again.`
    };
  }
  return null;
}
