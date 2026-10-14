import type { FastifyInstance } from 'fastify';
import type { ProofOfWork } from '../proof-of-work.js';
import type { RateLimit } from '../rate-limit.js';
import { answerChallenge } from '../challenge-route.js';
import { DAY_SECONDS } from '../time.js';
import type { PageGateConfig } from './page-gate-config.js';
import { isNavigation } from './navigation.js';
import { decidePage } from './page-policy.js';
import { issuePass, PASS_COOKIE, passHolds } from './page-pass.js';
import {
  deniedPage, INTERSTITIAL_CSP, interstitialPage, PAGE_CHALLENGE_PATH, PAGE_GATE_SCRIPT, PAGE_GATE_SCRIPT_PATH,
  PASS_PATH, WIDGET_SCRIPT_PATH
} from './interstitial.js';
import { versioned, type VersionedScript } from './widget-script.js';
import type { CheckTarget } from '../check-target.js';
import type { GatePreHandler } from '../gate-pre-handler.js';

/** Scripts whose URL carries their version may be kept by the browser for good. */
const CACHED_FOR_GOOD = 'public, max-age=31536000, immutable';

function serveScript(gateway: FastifyInstance, path: string, script: VersionedScript): void {
  gateway.get(path, async (_request, reply) => reply
    .type('text/javascript; charset=utf-8')
    .header('cache-control', CACHED_FOR_GOOD)
    .send(script.content));
}

/**
 * The page gate's own routes: its two scripts, the challenge -- handed to each client address
 * only so often -- and the place a solution is exchanged for the pass.
 */
export function registerPageGateRoutes(
  gateway: FastifyInstance,
  config: PageGateConfig,
  scripts: { widget: VersionedScript; pageGate: VersionedScript },
  proofOfWork: ProofOfWork,
  challengeLimit: RateLimit,
  passKey: string
): void {
  serveScript(gateway, WIDGET_SCRIPT_PATH, scripts.widget);
  serveScript(gateway, PAGE_GATE_SCRIPT_PATH, scripts.pageGate);

  gateway.get(PAGE_CHALLENGE_PATH, async (request, reply) => answerChallenge(
    request,
    reply,
    challengeLimit,
    () => proofOfWork.createChallenge()
  ));

  gateway.post<{ Body: { payload?: unknown } | undefined }>(PASS_PATH, async (request, reply) => {
    const payload = request.body?.payload;
    // The pass is a __Host- cookie, which a browser keeps only from HTTPS
    if (request.protocol !== 'https' || typeof payload !== 'string' || !await proofOfWork.verify(payload)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'The challenge was not solved.' });
    }
    const pass = issuePass(passKey, request.headers['user-agent'] ?? '', Date.now(), config.passDays);
    reply.setCookie(PASS_COOKIE, pass, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.passDays * DAY_SECONDS
    });
    return { passed: true };
  });
}

/** The scripts of the interstitial: the widget from its package, the page's own from the code. */
export function pageGateScripts(widget: VersionedScript): { widget: VersionedScript; pageGate: VersionedScript } {
  return { widget, pageGate: versioned(PAGE_GATE_SCRIPT) };
}

/**
 * The status the interstitial is answered with, so that the browser shows it at the address it opened
 * (and reloads that address with the pass): 200 in the proxy. Under ForwardAuth, Traefik would pass
 * a 2xx on to the application, so it is 401 there, with a scheme of its own that no browser asks a
 * password for.
 */
function interstitialStatus(target: CheckTarget): { statusCode: number; headers: Record<string, string> } {
  return target.forwardAuth
    ? { statusCode: 401, headers: { 'www-authenticate': 'iqb-gate' } }
    : { statusCode: 200, headers: {} };
}

/**
 * The check before a request is passed on. What the policy denies is kept out, whatever the
 * request -- a crawler need not ask for HTML. A browser opening a page over HTTPS then gets it when
 * the policy allows it or it holds a pass, and the interstitial otherwise, which solves a challenge
 * and comes back with a pass. Every other request, and everything over plain HTTP, passes.
 */
export function pageGatePreHandler(
  config: PageGateConfig,
  scripts: { widget: VersionedScript; pageGate: VersionedScript },
  passKey: string
): GatePreHandler {
  const page = interstitialPage(scripts.widget.version, scripts.pageGate.version, config.texts);
  const denied = deniedPage(config.texts);
  return async (request, reply, target) => {
    const userAgent = request.headers['user-agent'] ?? '';
    const decision = decidePage(config.policy, { userAgent, url: target.url });
    const navigation = isNavigation(target.method, request.headers);
    if (decision.action === 'deny') {
      request.log.info({ rule: decision.rule }, 'request denied by the page policy');
      reply.code(403).header('cache-control', 'no-store');
      if (navigation) {
        reply.type('text/html; charset=utf-8').send(denied);
      } else {
        reply.send({ statusCode: 403, error: 'Forbidden', message: 'This client is not allowed here.' });
      }
      return true;
    }
    if (target.protocol !== 'https' || !navigation || decision.action === 'allow') return false;
    const cookies = request.server.parseCookie(request.headers.cookie ?? '');
    if (passHolds(cookies[PASS_COOKIE], passKey, userAgent, Date.now())) return false;
    const { statusCode, headers } = interstitialStatus(target);
    reply
      .code(statusCode)
      .headers(headers)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .header('content-security-policy', INTERSTITIAL_CSP)
      .header('x-content-type-options', 'nosniff')
      .send(page);
    return true;
  };
}
