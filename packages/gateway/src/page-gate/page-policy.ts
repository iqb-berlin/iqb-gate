import type { PageAction, PagePolicyRule } from './page-gate-config.js';

/** What the policy decides for a request, and by which rule (none: the default, a challenge). */
export interface PageDecision {
  action: PageAction;
  rule: string | null;
}

/** The path as sent, and as the application reads it (see `pathVariants`). */
interface Paths {
  raw: string;
  normalised: string;
}

/**
 * Whether a rule's path holds. An `allow` needs both spellings of the path to match, a `deny` or a
 * `challenge` either of them: spelling a path differently must lead to the stricter answer, never
 * past it.
 */
function pathHolds(rule: PagePolicyRule, paths: Paths): boolean {
  if (!rule.path) return true;
  const path = rule.path;
  return rule.action === 'allow'
    ? path.test(paths.raw) && path.test(paths.normalised)
    : path.test(paths.raw) || path.test(paths.normalised);
}

/** The first rule whose conditions all hold decides; without one, the request is challenged. */
export function decidePage(policy: PagePolicyRule[], request: { userAgent: string; paths: Paths }): PageDecision {
  const rule = policy.find(candidate => (
    (!candidate.userAgent || candidate.userAgent.test(request.userAgent)) && pathHolds(candidate, request.paths)
  ));
  return rule ? { action: rule.action, rule: rule.name } : { action: 'challenge', rule: null };
}
