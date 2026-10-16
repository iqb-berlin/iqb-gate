import {
  Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject, OnDestroy, OnInit, signal
} from '@angular/core';
import {
  MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { Subject, takeUntil } from 'rxjs';
import { GateChallengeService } from '../../services/gate-challenge.service';
import { type GateTexts, IQB_GATE_TEXTS, WIDGET_TEXT_NAMES } from '../../gate-texts';

/** The language the widget's texts are registered under: the library's, not ALTCHA's own. */
export const WIDGET_LANGUAGE = 'iqb-gate';

/** Loads the ALTCHA widget, which registers `<altcha-widget>`. */
const loadAltchaWidget = (): Promise<unknown> => import('altcha');

/**
 * Asks for the proof-of-work challenge the gateway wants before a session may write: the ALTCHA
 * widget computes it once the person ticks its box. Closes with `true` once the gateway accepted the
 * solution, with `false` when the person cancels. Opened by `GateVerificationService`.
 *
 * The widget is loaded with the dialog, not with the application: most sessions never need it.
 * The state is kept in signals, so that the dialog updates in applications without zone.js too.
 */
@Component({
  selector: 'iqb-gate-verification-dialog',
  templateUrl: './gate-verification-dialog.component.html',
  styleUrls: ['./gate-verification-dialog.component.scss'],
  // <altcha-widget> is a custom element, registered when the widget is loaded
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton]
})
export class GateVerificationDialogComponent implements OnInit, OnDestroy {
  private readonly challengeService = inject(GateChallengeService);
  private readonly dialogRef = inject(MatDialogRef<GateVerificationDialogComponent>);
  readonly texts: GateTexts = inject(IQB_GATE_TEXTS)();
  readonly widgetLanguage = WIDGET_LANGUAGE;
  /** The widget is loaded and knows its texts. */
  readonly widgetReady = signal(false);
  /** The challenge as JSON, which the widget reads from its `challenge` attribute. */
  readonly challenge = signal<string | null>(null);
  /** The gateway did not accept a solution; a new challenge is fetched with it. */
  readonly failed = signal(false);
  /** No challenge, or no widget, could be loaded; the person can try again instead of losing the write. */
  readonly loadFailed = signal(false);
  private readonly widgetLoadFailures = signal(0);
  /**
   * The widget failed to load more than once, and has not loaded since: a browser that keeps a failed
   * module fetch rejects every further try at once, and only a reload of the page helps.
   */
  readonly reloadNeeded = computed(() => !this.widgetReady() && this.widgetLoadFailures() > 1);
  private ngUnsubscribe = new Subject<void>();

  ngOnInit(): void {
    this.load();
  }

  /** Loads what is missing: the widget, unless it is there, and a new challenge -- a fresh start. */
  load(): void {
    this.loadFailed.set(false);
    this.failed.set(false);
    if (!this.widgetReady()) this.loadWidget();
    this.loadChallenge();
  }

  private loadWidget(): void {
    loadAltchaWidget().then(
      () => {
        this.registerWidgetTexts();
        this.widgetReady.set(true);
      },
      () => {
        this.widgetLoadFailures.update(failures => failures + 1);
        this.loadFailed.set(true);
      }
    );
  }

  private registerWidgetTexts(): void {
    const texts = Object.fromEntries(WIDGET_TEXT_NAMES.map(name => [name, this.texts.widget[name]]));
    globalThis.$altcha?.i18n.set(WIDGET_LANGUAGE, texts);
  }

  private loadChallenge(): void {
    this.challenge.set(null);
    this.challengeService.challenge()
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(challenge => {
        if (challenge) {
          this.challenge.set(JSON.stringify(challenge));
        } else {
          // Instead of the failure of an earlier solution: there is nothing to solve now
          this.failed.set(false);
          this.loadFailed.set(true);
        }
      });
  }

  /** The widget solved the challenge: the gateway decides whether the solution holds. */
  onVerified(event: Event): void {
    const payload = (event as CustomEvent<{ payload?: string }>).detail?.payload;
    if (!payload) return;
    this.challengeService.verify(payload)
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(verified => {
        if (verified) {
          this.dialogRef.close(true);
        } else {
          this.failed.set(true);
          this.loadChallenge();
        }
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
