/**
 * What the gateway and the libraries in the browser agree on for the check that a write or a read
 * comes from a person: the header that carries what the browser observed, what it contains, the
 * gateway's own paths and the answers it gives.
 */

/** The prefix below which the gateway answers itself; nothing there reaches the application. */
export const GATE_PREFIX = '/.iqb-gate';

/** Where the browser fetches a proof-of-work challenge for the ALTCHA widget (GET). */
export const CHALLENGE_PATH = `${GATE_PREFIX}/challenge`;

/** Where the browser hands in the solved challenge as `{ payload }` (POST); 200 or 400. */
export const VERIFY_PATH = `${GATE_PREFIX}/verify`;

/** The request header in which the browser sends {@link ClientSignals} with every request to its origin, as JSON. */
export const CLIENT_SIGNALS_HEADER = 'x-client-signals';

/**
 * How long a trusted keyboard or pointer input still covers a write. A person clicks or types right
 * before saving; the longest legitimate gap is a save that runs as several requests one after the
 * other (a unit's properties, definition and scheme, or one upload per module file).
 */
export const TRUSTED_INPUT_WINDOW_MS = 60 * 1000;

/**
 * The methods of a write: the browser sends {@link ClientSignals} with them, and the gateway checks
 * the requests that use them. Both have to name the same ones -- a checked write without the header
 * is rejected as automated.
 */
export const SAVING_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The methods of a read: the gateway checks the requests that use them under its read rules. The
 * browser sends {@link ClientSignals} with them as well -- a checked read without the header is
 * rejected as automated.
 */
export const READING_METHODS: readonly string[] = ['GET', 'HEAD'];

/** The status the gateway answers with while the session still has to solve a challenge. */
export const HUMAN_VERIFICATION_REQUIRED_STATUS = 428;

/** The code in the body of that answer. */
export const HUMAN_VERIFICATION_REQUIRED_CODE = 'human-verification-required';

/** The status the gateway answers with when the browser reports automation. */
export const AUTOMATION_DETECTED_STATUS = 403;

/** The code in the body of that answer. */
export const AUTOMATION_DETECTED_CODE = 'automation-detected';

/** The codes of the gateway's refusals, in the body and in {@link GATE_REFUSAL_HEADER}. */
export type GateRejectionCode = typeof HUMAN_VERIFICATION_REQUIRED_CODE | typeof AUTOMATION_DETECTED_CODE;

/**
 * The response header that names the `code` of the gateway's refusal as well -- for answers whose
 * body the browser cannot read as JSON: a HEAD request, a download asked for as a Blob or as text.
 */
export const GATE_REFUSAL_HEADER = 'x-iqb-gate-refusal';

/** What the browser observed about itself and its input, collected for every request. */
export interface ClientSignals {
  /** `navigator.webdriver`: set by WebDriver, Playwright, Puppeteer and Cypress. */
  webdriver: boolean;
  /** The user agent of a headless browser. */
  headless: boolean;
  /** Keyboard or pointer events were dispatched by a script instead of a device. */
  untrustedInput: boolean;
  /** Milliseconds since the last trusted keyboard or pointer input; `null` if there was none. */
  msSinceTrustedInput: number | null;
  /** A software WebGL renderer -- typical for automation, but also for remote desktops. */
  softwareRenderer: boolean;
  /** The page is attached to the DevTools protocol -- automation, or a developer with DevTools open. */
  devtoolsProtocol: boolean;
}

/** A proof-of-work challenge for the ALTCHA widget, as the gateway hands it out. */
export interface HumanVerificationChallenge {
  parameters: object;
  signature?: string;
}

/** The body of a rejected write or read. */
export interface GateRejection {
  statusCode: number;
  error: string;
  code: GateRejectionCode;
  message: string;
  /** For `automation-detected`: the observations that rejected the request. */
  signals?: string[];
}

export * from './claims.js';
