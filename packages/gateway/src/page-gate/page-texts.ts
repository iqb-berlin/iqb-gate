import { ConfigError, isMapping, rejectUnknownKeys } from '../config-helpers.js';

/**
 * What the page gate's own pages say to a person: the interstitial, its status lines, and the
 * page a client gets that the policy keeps out. They come from the gateway, not from the
 * application, so neither the application's translations nor `@iqb/gate-angular`'s texts reach
 * them; an installation overrides them in `pageGate.texts`.
 */
export interface PageTexts {
  /** The language the texts are in (`lang` of the pages), e.g. `de` or `en`. */
  lang: string;
  /** The interstitial's title and heading. */
  title: string;
  intro: string;
  /** The button shown where the browser could not reload by itself. */
  continue: string;
  noscript: string;
  /** The pass did not stay: cookies are most likely blocked. */
  cookiesBlocked: string;
  /** The challenge is solved; the page is about to load. */
  loading: string;
  /** The challenge is solved, but the page cannot reload by itself (see {@link continue}). */
  verified: string;
  failed: string;
  deniedTitle: string;
  denied: string;
}

export const DEFAULT_PAGE_TEXTS: PageTexts = {
  lang: 'de',
  title: 'Einen Moment bitte …',
  intro: 'Ihr Browser bestätigt einmal, dass hier kein automatisiertes Programm Seiten abruft. '
    + 'Das dauert meist eine Sekunde; danach geht es von selbst weiter.',
  continue: 'Weiter',
  noscript: 'Bitte schalten Sie JavaScript ein, um fortzufahren.',
  cookiesBlocked: 'Ihr Browser hat die Bestätigung nicht behalten. Sind Cookies für diese Seite gesperrt? '
    + 'Bitte erlauben Sie sie und laden Sie die Seite neu.',
  loading: 'Bestätigt, die Seite wird geladen …',
  verified: 'Bestätigt.',
  failed: 'Das hat nicht geklappt. Bitte laden Sie die Seite neu.',
  deniedTitle: 'Kein Zugriff',
  denied: 'Dieser Zugriff ist nicht erlaubt.'
};

const TEXT_NAMES = Object.keys(DEFAULT_PAGE_TEXTS) as Array<keyof PageTexts>;

/** Reads `pageGate.texts`: the texts it names replace the defaults, the others stay. */
export function parsePageTexts(section: unknown): PageTexts {
  if (section === undefined) return DEFAULT_PAGE_TEXTS;
  if (!isMapping(section)) throw new ConfigError('pageGate.texts has to be a mapping of text names to texts.');
  rejectUnknownKeys(section, TEXT_NAMES, 'pageGate.texts');
  return TEXT_NAMES.reduce<PageTexts>((texts, name) => {
    const value = section[name];
    if (value === undefined) return texts;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ConfigError(`pageGate.texts.${name} has to be a text.`);
    }
    return { ...texts, [name]: value };
  }, DEFAULT_PAGE_TEXTS);
}
