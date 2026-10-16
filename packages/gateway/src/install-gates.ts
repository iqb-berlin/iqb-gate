import type { FastifyInstance } from 'fastify';
import { OidcVerifier } from '@iqb/gate-oidc';
import type { GatewayConfig } from './config.js';
import { checksAnything } from './path-rules.js';
import { AuditLog } from './audit/audit-log.js';
import { registerAuditRoutes } from './audit/audit-routes.js';
import type { PendingEntries } from './audit/record-checked-request.js';
import { AuditUserNames } from './audit/audit-user-names.js';
import { DAY_MS, HOUR_MS, MINUTE_MS } from './time.js';
import { type GatePreHandler, gatePreHandler } from './gate-pre-handler.js';
import { RateLimit } from './rate-limit.js';
import { PersonVerification } from './session/person-verification.js';
import { SessionVerificationState } from './session/session-verification-state.js';
import { registerVerificationRoutes } from './session/verification-routes.js';
import { WriteGate } from './write-gate/write-gate.js';
import { ReadGate } from './read-gate/read-gate.js';

function windowOf({ limit, windowSeconds }: { limit: number; windowSeconds: number }) {
  return { limit, windowMs: windowSeconds * 1000 };
}

/**
 * Sets up the write gate and the read gate, each when it has something to check (enforced, with a
 * rule on), and what they share: the challenge a session solves once for both, the audit log and its
 * page, and the housekeeping that forgets idle sessions, adds folded repeats to their entries and
 * deletes entries past their retention. Returns the checks for the proxy -- none when neither gate
 * checks anything.
 */
export function installGates(gateway: FastifyInstance, config: GatewayConfig): GatePreHandler[] {
  const checksWrites = checksAnything(config.writeGate);
  const checksReads = checksAnything(config.readGate);
  if (!checksWrites && !checksReads) return [];

  // One state for both gates: a challenge solved for a write counts for reads, and the other way round
  const sessions = new SessionVerificationState(windowOf(config.writeGate.burst), windowOf(config.readGate.limit));
  const verification = new PersonVerification(config.secret, sessions);
  const audit = new AuditLog(
    config.audit.file,
    config.audit.retentionDays * DAY_MS,
    (message, error) => gateway.log.error({ err: error }, message)
  );
  const challengeLimit = new RateLimit(config.challenges.perAddressAndMinute, MINUTE_MS);
  registerVerificationRoutes(gateway, verification, challengeLimit);
  registerAuditRoutes(gateway, audit, config.audit.key);

  // Tokens of the provider name their person in the audit log; a refused one is only worth a debug line
  const verifier = config.oidc && new OidcVerifier({
    ...config.oidc,
    onRejected: reason => gateway.log.debug(`audit: token not verified: ${reason}`),
    onUnavailable: reason => gateway.log.warn(`audit: the OpenID Connect provider cannot be asked: ${reason}`),
    onStaleKeys: reason => gateway.log.warn(`audit: the OpenID Connect provider's keys are not current: ${reason}`)
  });
  // Kept as long as identical rejections fold into one entry
  const writeNames = new AuditUserNames(verifier, config.writeGate.userClaim, MINUTE_MS);
  const readNames = new AuditUserNames(verifier, config.readGate.userClaim, MINUTE_MS);

  const timers = [
    setInterval(() => audit.addRepeats(), MINUTE_MS),
    setInterval(() => {
      sessions.prune(Date.now());
      verification.prune();
    }, HOUR_MS),
    // The addresses that asked for challenges are forgotten as soon as their minute is over
    setInterval(() => challengeLimit.prune(Date.now()), MINUTE_MS),
    setInterval(() => {
      writeNames.prune();
      readNames.prune();
    }, MINUTE_MS),
    setInterval(() => {
      const removed = audit.deleteExpired();
      if (removed) gateway.log.info(`removed ${removed} audit entries past their retention`);
    }, HOUR_MS)
  ];
  timers.forEach(timer => timer.unref());
  const pending: PendingEntries = new Set();
  gateway.addHook('onClose', async () => {
    timers.forEach(timer => clearInterval(timer));
    // Entries whose person is still being named are written before the log closes
    await Promise.allSettled([...pending]);
    audit.addRepeats();
    audit.close();
  });

  if (config.trustProxy === false) {
    gateway.log.warn('no proxy is trusted (IQB_GATE_TRUST_PROXY): behind one, every client has its address -- '
      + 'refusals fold into one audit entry and all clients share one challenge limit');
  }

  const ruleNames = (rules: GatewayConfig['writeGate']['rules']) => rules
    .map(rule => (rule.off ? `${rule.name} (off)` : rule.name))
    .join(', ');
  const checks: GatePreHandler[] = [];
  if (checksWrites) {
    gateway.log.info(`writes are checked: ${ruleNames(config.writeGate.rules)}`);
    checks.push(gatePreHandler(new WriteGate(config.writeGate, sessions), { audit, names: writeNames, pending }));
  }
  if (checksReads) {
    gateway.log.info(`reads are checked: ${ruleNames(config.readGate.rules)}`);
    checks.push(gatePreHandler(new ReadGate(config.readGate, sessions), { audit, names: readNames, pending }));
  }
  return checks;
}
