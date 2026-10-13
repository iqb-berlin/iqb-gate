import {
  ConfigError, isMapping, parseEnforce, parseLimitWindow, parseUserClaim, rejectUnknownKeys
} from '../config-helpers.js';
import { parseRules } from '../path-rules.js';
import { type GateScope, parseExemptions } from '../checked-request.js';

export interface ReadGateConfig extends GateScope {
  /** More reads than this within the window ask the session for a new challenge. */
  limit: { limit: number; windowSeconds: number };
  /** The claim of the (unverified) Bearer JWT the audit log names the reader by. */
  userClaim: string | undefined;
}

/**
 * A person opening a workspace makes some twenty reads, a unit a handful more, printing a hundred
 * units some five hundred: far below this. A script copying everything solves a challenge every
 * 600 reads.
 */
const DEFAULT_LIMIT = { limit: 600, windowSeconds: 60 };

/** Reads the `readGate` section of the file, `IQB_GATE_ENFORCE` and `IQB_GATE_READ_RULES_OFF`. */
export function parseReadGate(
  section: unknown, enforceSetting: string | undefined, rulesOffSetting?: string
): ReadGateConfig {
  const gate = section ?? {};
  if (!isMapping(gate)) throw new ConfigError('readGate has to be a mapping.');
  rejectUnknownKeys(gate, ['rules', 'exempt', 'limit', 'userClaim'], 'readGate');
  return {
    enforce: parseEnforce(enforceSetting),
    rules: parseRules(gate.rules, 'readGate', { setting: 'IQB_GATE_READ_RULES_OFF', value: rulesOffSetting }),
    exempt: parseExemptions(gate.exempt, { section: 'readGate', kind: 'read' }),
    limit: parseLimitWindow(gate.limit, 'readGate.limit', DEFAULT_LIMIT),
    userClaim: parseUserClaim(gate.userClaim, 'readGate.userClaim')
  };
}
