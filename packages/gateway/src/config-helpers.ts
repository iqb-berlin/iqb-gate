/** A setting that cannot be used; the message says which and why. */
export class ConfigError extends Error {}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A misspelled key would otherwise fall back to a default without a word. */
export function rejectUnknownKeys(mapping: Record<string, unknown>, known: string[], where: string): void {
  const unknown = Object.keys(mapping).filter(key => !known.includes(key));
  if (unknown.length) {
    throw new ConfigError(`${where} has unknown keys: ${unknown.join(', ')} (known: ${known.join(', ')}).`);
  }
}

/** The entries of a list in the file; an absent list is an empty one. */
export function listAt(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${where} has to be a list.`);
  return value;
}

/**
 * A regular expression from the file, matched without regard to case: the applications behind the
 * gateway route `/API/Admin` as `/api/admin` (Express does), so a rule must not miss it.
 */
export function compilePattern(value: unknown, where: string): RegExp {
  if (typeof value !== 'string' || value === '') throw new ConfigError(`${where} has to be a regular expression.`);
  try {
    return new RegExp(value, 'i');
  } catch (error) {
    throw new ConfigError(`${where} is no regular expression: ${(error as Error).message}`);
  }
}

/** The first entry of a list whose key an earlier entry has already: what a section names twice. */
export function firstDuplicate<T>(list: T[], keyOf: (entry: T) => string): T | undefined {
  const seen = new Set<string>();
  return list.find(entry => {
    const key = keyOf(entry);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

/** A positive whole number from the file, or `fallback` where it gives none. */
export function positiveIntegerAt(value: unknown, fallback: number, where: string): number {
  const number = value ?? fallback;
  if (!isPositiveInteger(number)) throw new ConfigError(`${where} has to be a positive whole number.`);
  return number;
}

/** A setting that is `on` or `off`, `fallback` when it is not given; `name` names it in the error. */
export function parseSwitch(value: string | undefined, name: string, fallback: 'on' | 'off'): boolean {
  const setting = value?.trim().toLowerCase() || fallback;
  if (setting !== 'on' && setting !== 'off') throw new ConfigError(`${name} is on or off, not ${value}.`);
  return setting === 'on';
}

/** `IQB_GATE_ENFORCE`: `on` (the default) or `off`, which switches every check off. */
export function parseEnforce(value: string | undefined): boolean {
  return parseSwitch(value, 'IQB_GATE_ENFORCE', 'on');
}

/** How many requests a session may make within a window (`writeGate.burst`, `readGate.limit`). */
export function parseLimitWindow(
  value: unknown, where: string, defaults: { limit: number; windowSeconds: number }
): { limit: number; windowSeconds: number } {
  if (value === undefined) return defaults;
  if (!isMapping(value)) throw new ConfigError(`${where} has to be a mapping with limit and windowSeconds.`);
  rejectUnknownKeys(value, ['limit', 'windowSeconds'], where);
  const limit = value.limit ?? defaults.limit;
  const windowSeconds = value.windowSeconds ?? defaults.windowSeconds;
  if (!isPositiveInteger(limit)) throw new ConfigError(`${where}.limit has to be a positive whole number.`);
  if (!isPositiveInteger(windowSeconds)) {
    throw new ConfigError(`${where}.windowSeconds has to be a positive whole number.`);
  }
  return { limit, windowSeconds };
}

/** The claim of the Bearer JWT the audit log names a person by. */
export function parseUserClaim(value: unknown, where: string): string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value === '')) {
    throw new ConfigError(`${where} has to be the name of a claim, e.g. username.`);
  }
  return value as string | undefined;
}

/** The start of the script tokens an exemption lets through: a word, not a single letter. */
export function parseBearerPrefix(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length < 3) {
    throw new ConfigError(`${where} has to be at least three characters.`);
  }
  return value;
}
