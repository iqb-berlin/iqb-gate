import {
  compilePattern, ConfigError, isMapping, listAt, rejectUnknownKeys
} from './config-helpers.js';

/** Requests whose path matches are checked; the name stands in the audit log. */
export interface PathRule {
  name: string;
  path: RegExp;
  /**
   * Switched off for this installation (`IQB_GATE_RULES_OFF`, `IQB_GATE_READ_RULES_OFF`): its
   * requests pass unchecked. The rule still claims them, so that a rule further down -- a
   * catch-all -- does not check them instead.
   */
  off?: boolean;
}

/** A request that is checked: under which rule, and its path as it arrived (without the query). */
export interface CheckedRequest {
  rule: string;
  path: string;
}

function parseRule(entry: unknown, where: string): PathRule {
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping with name and path.`);
  rejectUnknownKeys(entry, ['name', 'path'], where);
  if (typeof entry.name !== 'string' || !/^[\w-]+$/.test(entry.name)) {
    throw new ConfigError(`${where}.name has to be a word, e.g. administration.`);
  }
  return { name: entry.name, path: compilePattern(entry.path, `${where}.path`) };
}

/**
 * The rule names a setting lists, comma-separated. A name no rule has stops the gateway: a typo
 * would otherwise leave on what was meant to be off -- or, read the other way, hide that a rule has
 * been renamed.
 */
function parseRulesOff(
  value: string | undefined, rules: PathRule[], setting: string, section: string
): Set<string> {
  const names = (value ?? '').split(',').map(name => name.trim()).filter(name => name !== '');
  const unknown = names.find(name => !rules.some(rule => rule.name === name));
  if (unknown) throw new ConfigError(`${setting} names ${unknown}, which no rule in ${section}.rules has.`);
  return new Set(names);
}

/**
 * The rules of a section (`writeGate.rules`, `readGate.rules`), with those the setting `setting`
 * names switched off. Names have to be unique within the section.
 */
export function parseRules(
  value: unknown, section: string, rulesOff: { setting: string; value: string | undefined }
): PathRule[] {
  const rules = listAt(value, `${section}.rules`).map((entry, index) => parseRule(entry, `${section}.rules[${index}]`));
  const duplicate = rules.find((rule, index) => rules.findIndex(other => other.name === rule.name) !== index);
  if (duplicate) throw new ConfigError(`${section}.rules names ${duplicate.name} twice.`);
  const off = parseRulesOff(rulesOff.value, rules, rulesOff.setting, section);
  return rules.map(rule => (off.has(rule.name) ? { ...rule, off: true } : rule));
}

/** Whether any rule is left to check requests under. */
export function hasActiveRules(rules: PathRule[]): boolean {
  return rules.some(rule => !rule.off);
}

/**
 * The rule a path is checked under, or `undefined`: no rule matches either spelling of the path, or
 * the first matching rule of each spelling is switched off. Leaning to checking -- a path that only
 * looks like a rule's once normalised is still checked, and a rule switched off for one spelling does
 * not let through what the other spelling's rule checks.
 */
export function ruleFor(rules: PathRule[], paths: { raw: string; normalised: string }): PathRule | undefined {
  return [paths.normalised, paths.raw]
    .map(spelling => rules.find(({ path }) => path.test(spelling)))
    .find(found => found && !found.off);
}

/** A pattern of an exemption holds only for both spellings of a path. */
export function matchesBothSpellings(pattern: RegExp, paths: { raw: string; normalised: string }): boolean {
  return pattern.test(paths.raw) && pattern.test(paths.normalised);
}

/** The token of an `Authorization: Bearer` header. */
export function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}
