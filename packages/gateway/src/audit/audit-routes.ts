import type { FastifyInstance } from 'fastify';
import { GATE_PREFIX } from '@iqb/gate-protocol';
import type { AuditLog } from './audit-log.js';
import { isAuditAuthorized } from './audit-access.js';
import { periodEnd, periodStart } from './audit-period.js';
import { AUDIT_PAGE, AUDIT_PAGE_CSP } from './audit-page.js';

export const AUDIT_PAGE_PATH = `${GATE_PREFIX}/admin/`;
export const AUDIT_ENTRIES_PATH = `${GATE_PREFIX}/admin/audit`;

interface AuditQuery {
  from?: string;
  to?: string;
  session?: string;
  limit?: string;
}

/**
 * The audit page and the entries it shows, for whoever brings the audit key: an application's
 * backend as Bearer token, a person as password in the browser's login prompt. Without a key the
 * routes do not exist, and the gateway answers 404 as for any unknown path of its own.
 */
export function registerAuditRoutes(gateway: FastifyInstance, audit: AuditLog, key: string | undefined): void {
  if (!key) return;

  gateway.register(async scope => {
    scope.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (isAuditAuthorized(request.headers.authorization, key)) return;
      reply
        .code(401)
        .header('www-authenticate', 'Basic realm="iqb-gate audit", charset="UTF-8"')
        .send({ statusCode: 401, error: 'Unauthorized', message: 'The audit log needs the audit key.' });
    });

    scope.get(`${GATE_PREFIX}/admin`, async (_request, reply) => reply.redirect(AUDIT_PAGE_PATH));

    scope.get(AUDIT_PAGE_PATH, async (_request, reply) => reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', AUDIT_PAGE_CSP)
      .header('x-content-type-options', 'nosniff')
      .send(AUDIT_PAGE));

    scope.get<{ Querystring: AuditQuery }>(AUDIT_ENTRIES_PATH, async request => {
      const limit = Number(request.query.limit);
      return audit.find({
        from: periodStart(request.query.from),
        to: periodEnd(request.query.to),
        sessionId: request.query.session || undefined,
        limit: Number.isInteger(limit) ? limit : undefined
      });
    });
  });
}
