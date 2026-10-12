import { SAVING_METHODS } from '@iqb/gate-protocol';
import {
  compilePattern, ConfigError, isMapping, isPositiveInteger, listAt, rejectUnknownKeys
} from '../config-helpers.js';

/** Writes whose path matches are checked; the name stands in the audit log. */
export interface WriteRule {
  name: string;
  path: RegExp;
}

/** Writes that are never checked: all conditions given have to hold. */
export interface WriteExemption {
  method?: string;
  path?: RegExp;
  /** The `Authorization: Bearer` token starts with it -- a script token the application checks itself. */
  bearerPrefix?: string;
}

export interface WriteGateConfig {
  /** Whether writes are checked at all (`IQB_GATE_ENFORCE`). */
  enforce: boolean;
  rules: WriteRule[];
  exempt: WriteExemption[];
  burst: { limit: number; windowSeconds: number };
  /** The claim of the (unverified) Bearer JWT the audit log names the writer by. */
  userClaim: string | undefined;
}

const DEFAULT_BURST = { limit: 30, windowSeconds: 60 };

function parseRule(entry: unknown, index: number): WriteRule {
  const where = `writeGate.rules[${index}]`;
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping with name and path.`);
  rejectUnknownKeys(entry, ['name', 'path'], where);
  if (typeof entry.name !== 'string' || !/^[\w-]+$/.test(entry.name)) {
    throw new ConfigError(`${where}.name has to be a word, e.g. administration.`);
  }
  return { name: entry.name, path: compilePattern(entry.path, `${where}.path`) };
}

function parseExemption(entry: unknown, index: number): WriteExemption {
  const where = `writeGate.exempt[${index}]`;
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping.`);
  rejectUnknownKeys(entry, ['method', 'path', 'bearerPrefix'], where);
  const { method, path, bearerPrefix } = entry;
  if (method === undefined && path === undefined && bearerPrefix === undefined) {
    throw new ConfigError(`${where} needs method, path or bearerPrefix -- an empty one would exempt every write.`);
  }
  if (method !== undefined && (typeof method !== 'string' || !SAVING_METHODS.includes(method))) {
    throw new ConfigError(`${where}.method has to be one of ${SAVING_METHODS.join(', ')}.`);
  }
  if (bearerPrefix !== undefined && (typeof bearerPrefix !== 'string' || bearerPrefix.length < 3)) {
    throw new ConfigError(`${where}.bearerPrefix has to be at least three characters.`);
  }
  return {
    ...(method !== undefined ? { method: method as string } : {}),
    ...(path !== undefined ? { path: compilePattern(path, `${where}.path`) } : {}),
    ...(bearerPrefix !== undefined ? { bearerPrefix: bearerPrefix as string } : {})
  };
}

function parseBurst(value: unknown): WriteGateConfig['burst'] {
  if (value === undefined) return DEFAULT_BURST;
  if (!isMapping(value)) throw new ConfigError('writeGate.burst has to be a mapping with limit and windowSeconds.');
  rejectUnknownKeys(value, ['limit', 'windowSeconds'], 'writeGate.burst');
  const limit = value.limit ?? DEFAULT_BURST.limit;
  const windowSeconds = value.windowSeconds ?? DEFAULT_BURST.windowSeconds;
  if (!isPositiveInteger(limit)) throw new ConfigError('writeGate.burst.limit has to be a positive whole number.');
  if (!isPositiveInteger(windowSeconds)) {
    throw new ConfigError('writeGate.burst.windowSeconds has to be a positive whole number.');
  }
  return { limit, windowSeconds };
}

function parseEnforce(value: string | undefined): boolean {
  const setting = value?.trim().toLowerCase() || 'on';
  if (setting !== 'on' && setting !== 'off') throw new ConfigError(`IQB_GATE_ENFORCE is on or off, not ${value}.`);
  return setting === 'on';
}

/** Reads the `writeGate` section of the file, and `IQB_GATE_ENFORCE`. */
export function parseWriteGate(section: unknown, enforceSetting: string | undefined): WriteGateConfig {
  const gate = section ?? {};
  if (!isMapping(gate)) throw new ConfigError('writeGate has to be a mapping.');
  rejectUnknownKeys(gate, ['rules', 'exempt', 'burst', 'userClaim'], 'writeGate');
  const rules = listAt(gate.rules, 'writeGate.rules').map(parseRule);
  const duplicate = rules.find((rule, index) => rules.findIndex(other => other.name === rule.name) !== index);
  if (duplicate) throw new ConfigError(`writeGate.rules names ${duplicate.name} twice.`);
  if (gate.userClaim !== undefined && (typeof gate.userClaim !== 'string' || gate.userClaim === '')) {
    throw new ConfigError('writeGate.userClaim has to be the name of a claim, e.g. username.');
  }
  return {
    enforce: parseEnforce(enforceSetting),
    rules,
    exempt: listAt(gate.exempt, 'writeGate.exempt').map(parseExemption),
    burst: parseBurst(gate.burst),
    userClaim: gate.userClaim as string | undefined
  };
}
