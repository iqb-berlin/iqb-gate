import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type RawServerBase,
  type RouteGenericInterface
} from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { IncomingHttpHeaders } from 'node:http';
import type { ClientOptions } from 'ws';
import { GATE_PREFIX, type GatewayConfig } from './config.js';
import { forwardedHeaders } from './forwarded-headers.js';
import { timeoutSecondsFor } from './timeouts.js';
import { installWriteGate } from './write-gate/install-write-gate.js';

export { GATE_PREFIX };

/** Headers of the client's WebSocket handshake that the upstream handshake carries on. */
const WEBSOCKET_HEADERS = ['cookie', 'authorization', 'origin', 'user-agent', 'accept-language'];

/** A request as the proxy plugin hands it over, whichever server type it runs on. */
type ProxiedRequest = FastifyRequest<RouteGenericInterface, RawServerBase>;

function forwardedFor(request: ProxiedRequest, headers: IncomingHttpHeaders): IncomingHttpHeaders {
  // `ips` exists only with trustProxy and runs from the peer back to the client, as far as trusted.
  const chain = request.ips ? [...request.ips].reverse() : [request.socket.remoteAddress ?? ''];
  return forwardedHeaders(headers, { chain, protocol: request.protocol, host: request.host });
}

function websocketHeaders(request: ProxiedRequest): IncomingHttpHeaders {
  const picked = Object.fromEntries(
    WEBSOCKET_HEADERS
      .filter(name => request.headers[name] !== undefined)
      .map(name => [name, request.headers[name]])
  ) as IncomingHttpHeaders;
  return forwardedFor(request, picked);
}

/** What the client is told when the upstream failed -- no more, since the cause names the upstream. */
const UPSTREAM_FAILURES: Record<502 | 503 | 504, { error: string; message: string }> = {
  502: { error: 'Bad Gateway', message: 'The application behind the gateway did not answer properly.' },
  503: { error: 'Service Unavailable', message: 'The application behind the gateway is not available.' },
  504: { error: 'Gateway Timeout', message: 'The application behind the gateway did not answer in time.' }
};

/**
 * Answers a request the upstream could not: 504 when it stayed silent too long, 503 when it said
 * it is unavailable, 502 for everything else (refused, reset, broken). The cause goes to the log.
 */
function replyUpstreamError(reply: FastifyReply<RouteGenericInterface, RawServerBase>, { error }: { error: Error }) {
  const reported = (error as Error & { statusCode?: number }).statusCode;
  const statusCode = reported === 504 || reported === 503 ? reported : 502;
  reply.log.warn({ err: error }, `upstream failed, answered ${statusCode}`);
  reply.code(statusCode).send({ statusCode, ...UPSTREAM_FAILURES[statusCode] });
}

/**
 * The gateway: a reverse proxy in front of one app. It streams request and response bodies
 * without buffering or limiting them (uploads of several gigabytes, server-sent events), passes
 * WebSockets through, and gives the upstream a timeout per path prefix -- the time it may stay
 * silent, as nginx's `proxy_read_timeout`, not a limit on the whole transfer. What the upstream
 * answers, the client gets: no retries, no limit on parallel connections.
 *
 * The protections hang into this proxy as a check before a request is passed on: the write gate
 * (see `installWriteGate`).
 */
export async function buildGateway(
  config: GatewayConfig,
  logger: FastifyServerOptions['logger'] = true
): Promise<FastifyInstance> {
  const gateway = Fastify({
    logger,
    trustProxy: config.trustProxy,
    return503OnClosing: true
  });

  gateway.get(`${GATE_PREFIX}/health`, async () => ({ status: 'ok' }));
  gateway.all(`${GATE_PREFIX}/*`, async (request, reply) => reply.code(404).send({
    statusCode: 404,
    error: 'Not Found',
    message: `${request.method} ${request.url} is no path of the gateway.`
  }));

  const writeGateCheck = await installWriteGate(gateway, config);

  // Documented by the plugin, but missing from its typings -- hence declared here, not inline.
  const wsClientOptions: ClientOptions & {
    rewriteRequestHeaders: (headers: IncomingHttpHeaders, request: ProxiedRequest) => IncomingHttpHeaders
  } = {
    rewriteRequestHeaders: (_headers, request) => websocketHeaders(request)
  };

  await gateway.register(httpProxy, {
    upstream: config.upstream,
    // reply-from's pool allows 128 connections by default: long uploads and event streams would
    // make every further request wait.
    undici: { connections: null },
    replyOptions: {
      rewriteRequestHeaders: forwardedFor,
      onError: replyUpstreamError,
      // reply-from repeats a GET the upstream answered with 503; the client should see that 503.
      retryDelay: () => null
    },
    handler: (request, reply, dest, options) => reply.from(dest, {
      ...options,
      timeout: timeoutSecondsFor(request.url, config.timeouts) * 1000
    }),
    ...(writeGateCheck ? { preHandler: writeGateCheck } : {}),
    websocket: true,
    wsClientOptions
  });

  return gateway;
}
