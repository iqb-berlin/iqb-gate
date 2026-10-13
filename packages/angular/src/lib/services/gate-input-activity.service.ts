import { DOCUMENT, inject, Injectable } from '@angular/core';
import { type ClientSignals, TRUSTED_INPUT_WINDOW_MS } from '@iqb/gate-protocol';
import {
  collectClientSignals, detectDevtoolsProtocol, detectSoftwareRenderer, type ObservedInput
} from '../utils/client-signals';

/** The input that a person makes and a script can only imitate. */
const WATCHED_EVENTS = ['keydown', 'pointerdown'];
/**
 * Input that counts when it is trusted, and does not count against anyone when it is not.
 * A click: screen readers in browse mode and voice control activate a button with nothing but a
 * click, and applications click hidden file and colour inputs from their code. A change: a file
 * picked in the system's file dialog, where no keyboard or pointer input reaches the page however
 * long the choice takes.
 */
const TRUSTED_ONLY_EVENTS = ['click', 'change'];

/**
 * How long the DevTools probe's answer is kept. The probe writes a line to the console's debug
 * level, and reads go out by the dozen when a page loads: probed with each of them, the console of
 * a developer with DevTools open would fill up.
 */
export const DEVTOOLS_PROBE_MS = 10 * 1000;

/**
 * Watches from the start of the page whether keyboard and pointer input comes from a device or from
 * a script, and reports it with every request to the page's origin (`iqbGateInterceptor`), together
 * with what the browser tells about itself. The gateway decides what of it rejects a write.
 *
 * Listens in the capture phase on the document, so that no handler further down can hide an event.
 * Input inside iframes (the Verona modules) does not reach it; the click on "save" in the
 * application does. `provideIqbGate()` creates it when the application starts.
 */
@Injectable({
  providedIn: 'root'
})
export class GateInputActivityService {
  private readonly document = inject(DOCUMENT);
  private readonly input: ObservedInput = { lastTrustedInputAt: null, lastUntrustedInputAt: null };
  /** Unknown (`null`) until probed; the gateway only logs it, so until then it is reported as no. */
  private softwareRenderer: boolean | null = null;
  private devtoolsProbe: { attached: boolean; at: number } | null = null;

  constructor() {
    WATCHED_EVENTS.forEach(type => this.document.addEventListener(type, event => this.record(event), true));
    TRUSTED_ONLY_EVENTS.forEach(type => this.document.addEventListener(type, event => {
      if (event.isTrusted) this.record(event);
    }, true));
    // A WebGL context can take a while on a weak graphics card: looked at once while the page is
    // idle -- right after the start where the browser has no idle callback -- and never on the way
    // out of a request, the first reads of the page included
    const view = this.document.defaultView;
    const probe = () => {
      this.softwareRenderer = detectSoftwareRenderer(() => this.document.createElement('canvas'));
    };
    if (view?.requestIdleCallback) {
      view.requestIdleCallback(probe);
    } else {
      view?.setTimeout(probe);
    }
  }

  private record(event: Event): void {
    if (event.isTrusted) {
      this.input.lastTrustedInputAt = Date.now();
    } else {
      this.input.lastUntrustedInputAt = Date.now();
    }
  }

  private devtoolsProtocol(now: number): boolean {
    const view = this.document.defaultView;
    if (!view) return false;
    if (!this.devtoolsProbe || now - this.devtoolsProbe.at >= DEVTOOLS_PROBE_MS) {
      this.devtoolsProbe = { attached: detectDevtoolsProtocol(view.console), at: now };
    }
    return this.devtoolsProbe.attached;
  }

  /** What to send with a request now. */
  signals(): ClientSignals {
    const view = this.document.defaultView;
    const now = Date.now();
    return collectClientSignals(
      view?.navigator || { userAgent: '' },
      this.input,
      { softwareRenderer: this.softwareRenderer === true, devtoolsProtocol: this.devtoolsProtocol(now) },
      now,
      TRUSTED_INPUT_WINDOW_MS
    );
  }
}
