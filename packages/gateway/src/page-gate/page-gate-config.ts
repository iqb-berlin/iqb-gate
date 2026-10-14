import {
  compilePattern, ConfigError, firstDuplicate, isMapping, listAt, positiveIntegerAt, rejectUnknownKeys
} from '../config-helpers.js';
import { type PageTexts, parsePageTexts } from './page-texts.js';

export type PageAction = 'allow' | 'deny' | 'challenge';

/** A rule of the policy: every condition it names has to hold for its action to apply. */
export interface PagePolicyRule {
  name: string;
  userAgent?: RegExp;
  path?: RegExp;
  action: PageAction;
}

export interface PageGateConfig {
  enabled: boolean;
  /** How long a solved page challenge lets the browser in. */
  passDays: number;
  /** Page challenges per client address and minute; a class behind one school address opens at once. */
  challengesPerAddressAndMinute: number;
  /** First match decides; without a match, a navigation is challenged. */
  policy: PagePolicyRule[];
  /** What the interstitial and the denied page say (`pageGate.texts`, else German defaults). */
  texts: PageTexts;
}

const DEFAULTS = { passDays: 7, challengesPerAddressAndMinute: 120 };
const ACTIONS: PageAction[] = ['allow', 'deny', 'challenge'];

function parseRule(entry: unknown, index: number): PagePolicyRule {
  const where = `pageGate.policy[${index}]`;
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping with name, action and a condition.`);
  rejectUnknownKeys(entry, ['name', 'userAgent', 'path', 'action'], where);
  const { name, userAgent, path, action } = entry;
  if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) {
    throw new ConfigError(`${where}.name has to be a word, e.g. ai-crawlers.`);
  }
  if (typeof action !== 'string' || !ACTIONS.includes(action as PageAction)) {
    throw new ConfigError(`${where}.action has to be one of ${ACTIONS.join(', ')}.`);
  }
  if (userAgent === undefined && path === undefined) {
    throw new ConfigError(`${where} needs userAgent or path -- one without would decide for every page.`);
  }
  return {
    name,
    ...(userAgent !== undefined ? { userAgent: compilePattern(userAgent, `${where}.userAgent`) } : {}),
    ...(path !== undefined ? { path: compilePattern(path, `${where}.path`) } : {}),
    action: action as PageAction
  };
}

/** Reads the `pageGate` section of the file; without one, the page gate is off. */
export function parsePageGate(section: unknown): PageGateConfig {
  const gate = section ?? {};
  if (!isMapping(gate)) throw new ConfigError('pageGate has to be a mapping.');
  rejectUnknownKeys(gate, ['enabled', 'passDays', 'challengesPerAddressAndMinute', 'policy', 'texts'], 'pageGate');
  if (gate.enabled !== undefined && typeof gate.enabled !== 'boolean') {
    throw new ConfigError('pageGate.enabled has to be true or false.');
  }
  const policy = listAt(gate.policy, 'pageGate.policy').map(parseRule);
  const duplicate = firstDuplicate(policy, rule => rule.name);
  if (duplicate) throw new ConfigError(`pageGate.policy names ${duplicate.name} twice.`);
  return {
    enabled: gate.enabled === true,
    passDays: positiveIntegerAt(gate.passDays, DEFAULTS.passDays, 'pageGate.passDays'),
    challengesPerAddressAndMinute: positiveIntegerAt(
      gate.challengesPerAddressAndMinute,
      DEFAULTS.challengesPerAddressAndMinute,
      'pageGate.challengesPerAddressAndMinute'
    ),
    policy,
    texts: parsePageTexts(gate.texts)
  };
}
