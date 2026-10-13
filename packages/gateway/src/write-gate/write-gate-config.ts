import { SAVING_METHODS } from '@iqb/gate-protocol';
import {
  ConfigError, isMapping, parseEnforce, parseLimitWindow, parseUserClaim, rejectUnknownKeys
} from '../config-helpers.js';
import { parseRules } from '../path-rules.js';
import { type GateScope, parseExemptions } from '../checked-request.js';

export interface WriteGateConfig extends GateScope {
  burst: { limit: number; windowSeconds: number };
  /** The claim of the (unverified) Bearer JWT the audit log names the writer by. */
  userClaim: string | undefined;
}

const DEFAULT_BURST = { limit: 30, windowSeconds: 60 };

/** Reads the `writeGate` section of the file, `IQB_GATE_ENFORCE` and `IQB_GATE_RULES_OFF`. */
export function parseWriteGate(
  section: unknown, enforceSetting: string | undefined, rulesOffSetting?: string
): WriteGateConfig {
  const gate = section ?? {};
  if (!isMapping(gate)) throw new ConfigError('writeGate has to be a mapping.');
  rejectUnknownKeys(gate, ['rules', 'exempt', 'burst', 'userClaim'], 'writeGate');
  const rules = parseRules(gate.rules, 'writeGate', { setting: 'IQB_GATE_RULES_OFF', value: rulesOffSetting });
  return {
    enforce: parseEnforce(enforceSetting),
    rules,
    exempt: parseExemptions(gate.exempt, { section: 'writeGate', kind: 'write', methods: SAVING_METHODS }),
    burst: parseLimitWindow(gate.burst, 'writeGate.burst', DEFAULT_BURST),
    userClaim: parseUserClaim(gate.userClaim, 'writeGate.userClaim')
  };
}
