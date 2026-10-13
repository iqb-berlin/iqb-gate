import { InjectionToken } from '@angular/core';

/** The texts of the ALTCHA widget, under the names it reads them by. */
export const WIDGET_TEXT_NAMES = [
  'ariaLinkLabel', 'enterCode', 'enterCodeAria', 'error', 'expired', 'footer', 'getAudioChallenge', 'label',
  'loading', 'reload', 'verify', 'verificationRequired', 'verified', 'verifying', 'waitAlert'
] as const;

export type WidgetTextName = typeof WIDGET_TEXT_NAMES[number];

/** Everything the library says to a person. */
export interface GateTexts {
  title: string;
  intro: string;
  failed: string;
  loadFailed: string;
  retry: string;
  cancel: string;
  /** The title of the notice that the gateway did not let a request through. */
  refusalTitle: string;
  /** The notice when the browser reported that it is automated. */
  automationDetected: string;
  /** The notice when a solved challenge was asked for again at once (a burst of requests). */
  notVerified: string;
  close: string;
  widget: Record<WidgetTextName, string>;
}

/** The texts the library brings along, in German. */
export const DEFAULT_GATE_TEXTS: GateTexts = {
  title: 'Bestätigen Sie, dass Sie ein Mensch sind',
  intro: 'Bevor Sie in dieser Sitzung weiterarbeiten, bestätigen Sie bitte einmal, dass hier ein Mensch arbeitet. ' +
    'Danach geht es weiter, wo Sie waren.',
  failed: 'Die Bestätigung ist nicht gelungen. Bitte versuchen Sie es noch einmal.',
  loadFailed: 'Die Bestätigung konnte nicht geladen werden. Bis dahin wird nichts geladen oder gespeichert.',
  retry: 'Erneut versuchen',
  cancel: 'Abbrechen',
  refusalTitle: 'Nicht ausgeführt',
  automationDetected: 'Der Browser wird automatisiert gesteuert. Hier dürfen nur Menschen Daten lesen und ' +
    'eingeben; es wurde nichts geladen oder gespeichert.',
  notVerified: 'Es wurde nicht bestätigt, dass hier ein Mensch arbeitet; es wurde nichts geladen oder gespeichert. ' +
    'Bitte versuchen Sie es in einer Minute noch einmal.',
  close: 'Schließen',
  widget: {
    ariaLinkLabel: 'Besuchen Sie altcha.org',
    enterCode: 'Code eingeben',
    enterCodeAria: 'Geben Sie den Code ein, den Sie hören. Drücken Sie die Leertaste, um den Ton abzuspielen.',
    error: 'Überprüfung fehlgeschlagen. Bitte versuchen Sie es später erneut.',
    expired: 'Überprüfung abgelaufen. Bitte erneut versuchen.',
    footer: 'Geschützt durch ALTCHA',
    getAudioChallenge: 'Audio-Herausforderung abspielen',
    label: 'Ich bin ein Mensch',
    loading: 'Lade …',
    reload: 'Neu laden',
    verify: 'Überprüfen',
    verificationRequired: 'Überprüfung erforderlich!',
    verified: 'Überprüft',
    verifying: 'Wird überprüft …',
    waitAlert: 'Überprüfung läuft … bitte warten.'
  }
};

/** Texts an application gives instead of the library's own: any of them, the widget's one by one. */
export type GateTextsOverride = Partial<Omit<GateTexts, 'widget'>> & { widget?: Partial<GateTexts['widget']> };

/** The entries that hold a text: a missing translation must not blank out the library's own. */
function given<T extends object>(texts: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(texts ?? {}).filter(([, text]) => text !== undefined)) as Partial<T>;
}

/** The library's texts with an application's put over them, wherever it gives one. */
export function mergeGateTexts(override: GateTextsOverride = {}): GateTexts {
  const { widget, ...texts } = override;
  return {
    ...DEFAULT_GATE_TEXTS,
    ...given(texts),
    widget: { ...DEFAULT_GATE_TEXTS.widget, ...given(widget) }
  };
}

/**
 * The texts, asked for when the dialog opens -- so that an application's translations have loaded
 * by then. `provideIqbGate({ texts })` sets it.
 */
export const IQB_GATE_TEXTS = new InjectionToken<() => GateTexts>('IQB_GATE_TEXTS', {
  providedIn: 'root',
  factory: () => () => DEFAULT_GATE_TEXTS
});
