import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A script the interstitial loads, with a version that changes with its content. */
export interface VersionedScript {
  content: string;
  version: string;
}

export function versioned(content: string): VersionedScript {
  return { content, version: createHash('sha256').update(content).digest('hex').slice(0, 12) };
}

/**
 * The ALTCHA widget with its translations, as one classic script, from the `altcha` package next to
 * its module entry. Should a new version of the package lay its files out differently, the gateway
 * stops at start rather than serve the module entry as a script that never registers the widget.
 */
export function loadWidgetScript(): VersionedScript {
  const file = fileURLToPath(new URL('altcha.i18n.min.js', import.meta.resolve('altcha')));
  if (!existsSync(file)) throw new Error(`The ALTCHA widget is not where the page gate expects it: ${file}`);
  return versioned(readFileSync(file, 'utf8'));
}
