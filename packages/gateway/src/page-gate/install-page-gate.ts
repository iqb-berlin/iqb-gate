import type { FastifyInstance } from 'fastify';
import type { GatewayConfig } from '../config.js';
import type { GatePreHandler } from '../gate-pre-handler.js';
import { deriveSecret, ProofOfWork } from '../proof-of-work.js';
import { RateLimit } from '../rate-limit.js';
import { HOUR_MS, MINUTE_MS } from '../time.js';
import { pageGatePreHandler, pageGateScripts, registerPageGateRoutes } from './page-gate-routes.js';
import { loadWidgetScript } from './widget-script.js';

/**
 * Sets up the page gate when it is enabled: its routes and the housekeeping that forgets used
 * challenges and the addresses that asked for them. Returns the check for the proxy, or `undefined`.
 */
export function installPageGate(gateway: FastifyInstance, config: GatewayConfig): GatePreHandler | undefined {
  if (!config.pageGate.enabled) return undefined;

  const proofOfWork = new ProofOfWork(config.secret, 'page');
  const challengeLimit = new RateLimit(config.pageGate.challengesPerAddressAndMinute, MINUTE_MS);
  const passKey = deriveSecret(config.secret, 'page-pass');
  const scripts = pageGateScripts(loadWidgetScript());
  registerPageGateRoutes(gateway, config.pageGate, scripts, proofOfWork, challengeLimit, passKey);

  const timers = [
    setInterval(() => proofOfWork.prune(), HOUR_MS),
    setInterval(() => challengeLimit.prune(Date.now()), MINUTE_MS)
  ];
  timers.forEach(timer => timer.unref());
  gateway.addHook('onClose', async () => timers.forEach(timer => clearInterval(timer)));

  gateway.log.info(`pages are gated over HTTPS, a pass holds ${config.pageGate.passDays} days`);
  return pageGatePreHandler(config.pageGate, scripts, passKey);
}
