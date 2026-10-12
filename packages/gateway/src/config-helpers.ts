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
