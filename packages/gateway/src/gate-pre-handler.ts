import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * A check that runs before a request is passed upstream: it answers the request itself and
 * returns the reply, or returns nothing and lets it pass.
 */
export type GatePreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The checks one after the other, until one of them answers. */
export function inTurn(checks: GatePreHandler[]): GatePreHandler {
  return (request, reply) => checks.reduce<Promise<FastifyReply | undefined>>(
    async (earlier, check) => (await earlier) ?? check(request, reply),
    Promise.resolve(undefined)
  );
}
