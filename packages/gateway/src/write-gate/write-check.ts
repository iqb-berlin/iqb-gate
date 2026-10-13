import { SAVING_METHODS } from '@iqb/gate-protocol';
import type { WriteExemption, WriteGateConfig } from './write-gate-config.js';
import { pathVariants } from '../request-path.js';

function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}

/** An exemption holds when every condition it names holds -- a path for both spellings of it. */
function isExempt(
  exemption: WriteExemption, method: string, paths: { raw: string; normalised: string }, token: string | undefined
): boolean {
  if (exemption.method && exemption.method !== method) return false;
  if (exemption.path && !(exemption.path.test(paths.raw) && exemption.path.test(paths.normalised))) return false;
  if (exemption.bearerPrefix && !token?.startsWith(exemption.bearerPrefix)) return false;
  return true;
}

/** A write that is checked: under which rule, and its path as it arrived (without the query). */
export interface CheckedWrite {
  rule: string;
  path: string;
}

/**
 * The rule a request is checked under, or `null` when it is not checked: no write, no rule whose
 * path matches either spelling of the request's path, the first matching rule of each spelling
 * switched off, or an exemption that holds. Leaning to checking -- a path that only looks like a
 * rule's once normalised is still checked, a rule switched off for one spelling does not let through
 * what the other spelling's rule checks, and an exemption has to match both spellings.
 */
export function checkedWrite(
  config: Pick<WriteGateConfig, 'enforce' | 'rules' | 'exempt'>,
  request: { method: string; url: string; authorization: string | undefined }
): CheckedWrite | null {
  if (!config.enforce || !SAVING_METHODS.includes(request.method)) return null;
  const paths = pathVariants(request.url);
  const rule = [paths.normalised, paths.raw]
    .map(spelling => config.rules.find(({ path }) => path.test(spelling)))
    .find(found => found && !found.off);
  if (!rule) return null;
  const token = bearerToken(request.authorization);
  if (config.exempt.some(exemption => isExempt(exemption, request.method, paths, token))) return null;
  return { rule: rule.name, path: paths.raw };
}
