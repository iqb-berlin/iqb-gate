import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HumanVerificationChallenge } from '@iqb/gate-protocol';
import type { RateLimit } from './rate-limit.js';

/**
 * Answers a request for a challenge: a new one, or 429 once the client address has had its share
 * for the minute. A challenge costs the gateway a key derivation, so a loop must not get as many as
 * it asks for. The address is the one Fastify resolved -- trustworthy only because the gateway
 * believes `X-Forwarded-For` from the proxies `IQB_GATE_TRUST_PROXY` names, and no one else.
 */
export async function answerChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  limit: RateLimit,
  create: () => Promise<HumanVerificationChallenge>
): Promise<HumanVerificationChallenge | FastifyReply> {
  reply.header('cache-control', 'no-store');
  if (!limit.allow(request.ip, Date.now())) {
    return reply.code(429).header('retry-after', '60').send({
      statusCode: 429, error: 'Too Many Requests', message: 'Too many challenges from this address; try again later.'
    });
  }
  return create();
}
