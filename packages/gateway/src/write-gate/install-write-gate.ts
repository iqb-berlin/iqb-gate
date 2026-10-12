import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { GatewayConfig } from '../config.js';
import { AuditLog } from '../audit/audit-log.js';
import { DAY_MS } from '../audit/audit-period.js';
import { registerAuditRoutes } from '../audit/audit-routes.js';
import { deriveSecret, WriteGate } from './write-gate.js';
import { registerChallengeRoutes, writeGatePreHandler } from './write-gate-routes.js';
import { RateLimit } from './rate-limit.js';

/** The check that runs before a request is passed upstream. */
export type GatePreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Challenges per client address and minute: enough for a school or office behind one address. */
const CHALLENGES_PER_ADDRESS_AND_MINUTE = 30;

/**
 * Sets up the write gate when it has something to check (enforced, with rules): the session
 * cookie, the challenge routes, the audit log and its page, and the housekeeping that forgets idle
 * sessions, adds folded repeats to their entries and deletes entries past their retention. Returns
 * the check for the proxy, or `undefined` when writes are not checked.
 */
export async function installWriteGate(
  gateway: FastifyInstance,
  config: GatewayConfig
): Promise<GatePreHandler | undefined> {
  if (!config.writeGate.enforce || !config.writeGate.rules.length) return undefined;

  // Cookies are parsed where the session is read, not for every request through the gateway
  await gateway.register(fastifyCookie, { secret: deriveSecret(config.secret, 'session-cookie'), hook: false });
  const writeGate = new WriteGate(config.secret, config.writeGate.burst);
  const audit = new AuditLog(
    config.audit.file,
    config.audit.retentionDays * DAY_MS,
    (message, error) => gateway.log.error({ err: error }, message)
  );
  const challengeLimit = new RateLimit(CHALLENGES_PER_ADDRESS_AND_MINUTE, MINUTE_MS);
  registerChallengeRoutes(gateway, writeGate, challengeLimit);
  registerAuditRoutes(gateway, audit, config.audit.key);

  const timers = [
    setInterval(() => audit.addRepeats(), MINUTE_MS),
    setInterval(() => {
      writeGate.prune();
      challengeLimit.prune(Date.now());
    }, HOUR_MS),
    setInterval(() => {
      const removed = audit.deleteExpired();
      if (removed) gateway.log.info(`removed ${removed} audit entries past their retention`);
    }, HOUR_MS)
  ];
  timers.forEach(timer => timer.unref());
  gateway.addHook('onClose', async () => {
    timers.forEach(timer => clearInterval(timer));
    audit.addRepeats();
    audit.close();
  });

  gateway.log.info(`writes are checked: ${config.writeGate.rules.map(rule => rule.name).join(', ')}`);
  return writeGatePreHandler(config.writeGate, writeGate, audit);
}
