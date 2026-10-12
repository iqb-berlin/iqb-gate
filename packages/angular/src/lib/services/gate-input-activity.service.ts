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
 * Watches from the start of the page whether keyboard and pointer input comes from a device or from
 * a script, and reports it with every write (`iqbGateInterceptor`), together with what the browser
 * tells about itself. The gateway decides what of it rejects a write.
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
  private softwareRenderer: boolean | null = null;

  constructor() {
    WATCHED_EVENTS.forEach(type => this.document.addEventListener(type, event => this.record(event), true));
    TRUSTED_ONLY_EVENTS.forEach(type => this.document.addEventListener(type, event => {
      if (event.isTrusted) this.record(event);
    }, true));
    // A WebGL context can take a while on a weak graphics card: looked at while the page is idle,
    // not when the first write is on its way
    const view = this.document.defaultView;
    if (view?.requestIdleCallback) view.requestIdleCallback(() => this.renderer());
  }

  private renderer(): boolean {
    if (this.softwareRenderer === null) {
      this.softwareRenderer = detectSoftwareRenderer(() => this.document.createElement('canvas'));
    }
    return this.softwareRenderer;
  }

  private record(event: Event): void {
    if (event.isTrusted) {
      this.input.lastTrustedInputAt = Date.now();
    } else {
      this.input.lastUntrustedInputAt = Date.now();
    }
  }

  /** What to send with a write now. */
  signals(): ClientSignals {
    const view = this.document.defaultView;
    return collectClientSignals(
      view?.navigator || { userAgent: '' },
      this.input,
      {
        softwareRenderer: this.renderer(),
        devtoolsProtocol: view ? detectDevtoolsProtocol(view.console) : false
      },
      Date.now(),
      TRUSTED_INPUT_WINDOW_MS
    );
  }
}
