import { type ClientSignals, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';

/** What the observations of the browser amount to for one write. */
export interface ClientSignalsVerdict {
  /** Observations that reject the write outright: the client is automated or not a gated frontend. */
  blocking: string[];
  /**
   * Observations a person's browser can show as well, through an extension that types for them: the
   * write then needs a freshly solved challenge, which a person can give.
   */
  suspicious: string[];
  /** Observations that are only recorded. */
  logged: string[];
}

/** The header could not be read: either it is missing or it is not what the library sends. */
const MISSING = 'signals-missing';

function parse(header: string | string[] | undefined): Partial<ClientSignals> | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Partial<ClientSignals> : null;
  } catch {
    return null;
  }
}

/**
 * Sorts what the browser reported about a write into what rejects it, what calls for a fresh
 * challenge, and what is only recorded.
 *
 * Rejecting: a browser that declares itself automated (`navigator.webdriver`, a headless user
 * agent), and no report at all -- a client that is not a gated frontend, unless it was written to
 * send one. Every observation is the client's own word: a script can send a person's report, and the
 * check stops only the automation that does not lie about itself. Calling for a challenge: input a
 * script dispatched, which password managers and writing aids do as well. Only recorded: no trusted
 * input within {@link TRUSTED_INPUT_WINDOW_MS} -- uploads that run one after another take longer than
 * that after the file was picked, and a session without a solved challenge is asked for one anyway --
 * a software renderer and an attached DevTools protocol, which remote desktops and developers with
 * DevTools open show as well.
 *
 * There is no analysis of how the mouse moved: a write made with the keyboard alone, or through a
 * screen reader, has to pass.
 */
export function evaluateClientSignals(header: string | string[] | undefined): ClientSignalsVerdict {
  const signals = parse(header);
  if (!signals) return { blocking: [MISSING], suspicious: [], logged: [] };

  const blocking: string[] = [];
  if (signals.webdriver === true) blocking.push('webdriver');
  if (signals.headless === true) blocking.push('headless');

  const suspicious: string[] = [];
  if (signals.untrustedInput === true) suspicious.push('untrusted-input');

  const logged: string[] = [];
  const sinceInput = signals.msSinceTrustedInput;
  if (typeof sinceInput !== 'number' || sinceInput < 0 || sinceInput > TRUSTED_INPUT_WINDOW_MS) {
    logged.push('no-recent-input');
  }
  if (signals.softwareRenderer === true) logged.push('software-renderer');
  if (signals.devtoolsProtocol === true) logged.push('devtools-protocol');

  return { blocking, suspicious, logged };
}
