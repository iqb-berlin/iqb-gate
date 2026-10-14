import {
  compilePattern, ConfigError, isMapping, listAt, parseBearerPrefix, rejectUnknownKeys
} from './config-helpers.js';
import { bearerToken } from '@iqb/gate-oidc';
import {
  type CheckedRequest, matchesBothSpellings, type PathRule, ruleFor
} from './path-rules.js';
import { pathVariants } from './request-path.js';

/** Requests a gate never checks: every condition given has to hold. */
export interface Exemption {
  /** Writes only: reads come in two methods, and neither is an exemption of its own. */
  method?: string;
  path?: RegExp;
  /** The `Authorization: Bearer` token starts with it -- a script token the application checks itself. */
  bearerPrefix?: string;
}

/** What a gate's section says about which requests it checks. */
export interface GateScope {
  /** Whether the gate checks at all (`IQB_GATE_ENFORCE`). */
  enforce: boolean;
  rules: PathRule[];
  exempt: Exemption[];
}

/** How a section's exemptions are read: `methods` lets them name one of these, as `writeGate` does. */
interface ExemptionSection {
  section: string;
  /** What an exemption naming nothing would let through: `write`, `read`. */
  kind: string;
  methods?: readonly string[];
}

function parseExemption(entry: unknown, where: string, { kind, methods }: ExemptionSection): Exemption {
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping.`);
  const keys = methods ? ['method', 'path', 'bearerPrefix'] : ['path', 'bearerPrefix'];
  rejectUnknownKeys(entry, keys, where);
  const { method, path, bearerPrefix } = entry;
  if (method === undefined && path === undefined && bearerPrefix === undefined) {
    const needs = methods ? 'method, path or bearerPrefix' : 'path or bearerPrefix';
    throw new ConfigError(`${where} needs ${needs} -- an empty one would exempt every ${kind}.`);
  }
  if (methods && method !== undefined && (typeof method !== 'string' || !methods.includes(method))) {
    throw new ConfigError(`${where}.method has to be one of ${methods.join(', ')}.`);
  }
  return {
    ...(method !== undefined ? { method: method as string } : {}),
    ...(path !== undefined ? { path: compilePattern(path, `${where}.path`) } : {}),
    ...(bearerPrefix !== undefined ? { bearerPrefix: parseBearerPrefix(bearerPrefix, `${where}.bearerPrefix`) } : {})
  };
}

/** Reads the `exempt` list of a gate's section. */
export function parseExemptions(value: unknown, section: ExemptionSection): Exemption[] {
  return listAt(value, `${section.section}.exempt`)
    .map((entry, index) => parseExemption(entry, `${section.section}.exempt[${index}]`, section));
}

/** An exemption holds when every condition it names holds -- a path for both spellings of it. */
function isExempt(
  exemption: Exemption, method: string, paths: { raw: string; normalised: string }, token: string | null
): boolean {
  if (exemption.method && exemption.method !== method) return false;
  if (exemption.path && !matchesBothSpellings(exemption.path, paths)) return false;
  if (exemption.bearerPrefix && !token?.startsWith(exemption.bearerPrefix)) return false;
  return true;
}

/**
 * The rule a request is checked under by a gate for `methods`, or `null` when it is not checked:
 * another method, no rule on for either spelling of its path (`ruleFor`), or an exemption that
 * holds -- and an exemption has to match both spellings.
 */
export function checkedRequest(
  methods: readonly string[],
  scope: GateScope,
  request: { method: string; url: string; authorization: string | undefined }
): CheckedRequest | null {
  if (!scope.enforce || !methods.includes(request.method)) return null;
  const paths = pathVariants(request.url);
  const rule = ruleFor(scope.rules, paths);
  if (!rule) return null;
  const token = bearerToken(request.authorization);
  if (scope.exempt.some(exemption => isExempt(exemption, request.method, paths, token))) return null;
  return { rule: rule.name, method: request.method, path: paths.raw };
}
