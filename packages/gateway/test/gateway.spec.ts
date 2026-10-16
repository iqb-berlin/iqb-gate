import {
  afterAll, afterEach, beforeAll, describe, expect, it
} from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildGateway } from '../src/gateway.js';
import { testConfig } from './support/test-config.js';
import { STREAM_BODY } from './support/stream-body.js';

/** Settles from outside: lets the stub upstream and the test wait for each other. */
class Signal {
  readonly promise: Promise<void>;
  fire!: () => void;

  constructor() {
    this.promise = new Promise(resolve => { this.fire = resolve; });
  }
}

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  length: number;
  sha256: string;
}

const MIB = 1024 * 1024;

/** The stub upstream's handlers, by path; the test arms the signals it needs. */
const upstreamState = {
  hits: 0,
  firstChunkArrived: new Signal(),
  clientGotFirstEvent: new Signal(),
  releaseHeld: new Signal()
};

function consume(request: IncomingMessage, onChunk: () => void = () => {}): Promise<Omit<Received, 'url'>> {
  const hash = createHash('sha256');
  let length = 0;
  return new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      length += chunk.length;
      onChunk();
    });
    request.on('end', () => resolve({
      method: request.method ?? '', headers: request.headers, length, sha256: hash.digest('hex')
    }));
    request.on('error', reject);
  });
}

function startUpstream(): Promise<Server> {
  const server = createServer(async (request, response) => {
    upstreamState.hits += 1;
    const url = request.url ?? '';
    if (url.endsWith('/slow')) {
      await consume(request);
      await sleep(1500);
      response.end('late');
      return;
    }
    if (url === '/conditional') {
      // The application's own 428, with a header only the gateway may send
      response.writeHead(428, { 'x-iqb-gate-refusal': 'human-verification-required', 'x-upstream': 'stub' });
      response.end('{"message":"If-Match missing"}');
      return;
    }
    if (url === '/unavailable') {
      response.writeHead(503, { 'retry-after': '1' });
      response.end('down for maintenance');
      return;
    }
    if (url === '/api/long/hold') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('held');
      await upstreamState.releaseHeld.promise;
      response.end();
      return;
    }
    if (url === '/sse') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write('data: one\n\n');
      await upstreamState.clientGotFirstEvent.promise;
      response.end('data: two\n\n');
      return;
    }
    const received = await consume(request, () => upstreamState.firstChunkArrived.fire());
    response.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'stub' });
    response.end(JSON.stringify({ ...received, url }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, request) => {
    socket.send(JSON.stringify({ url: request.url, headers: request.headers }));
    socket.on('message', message => socket.send(`echo: ${message.toString()}`));
  });
  return new Promise(resolve => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}

function origin(address: AddressInfo): string {
  return `http://127.0.0.1:${address.port}`;
}

/** A body of `mebibytes` MiB, produced while it is read, never held in memory as a whole. */
function generatedBody(mebibytes: number, beforeChunk: (index: number) => Promise<void> = async () => {}) {
  const hash = createHash('sha256');
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === mebibytes) {
        controller.close();
        return;
      }
      await beforeChunk(index);
      const chunk = Buffer.alloc(MIB, index % 251);
      hash.update(chunk);
      index += 1;
      controller.enqueue(chunk);
    }
  });
  return { stream, sha256: () => hash.digest('hex') };
}

describe('gateway', () => {
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  const config = (upstreamOrigin: string) => testConfig(upstreamOrigin, {
    timeouts: { defaultSeconds: 1, paths: [{ prefix: '/api/long', seconds: 3 }, { prefix: '/bs', seconds: 30 }] }
  });

  beforeAll(async () => {
    upstream = await startUpstream();
    gateway = await buildGateway(config(origin(upstream.address() as AddressInfo)), false);
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    base = origin(gateway.server.address() as AddressInfo);
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
  });

  afterEach(() => {
    upstreamState.firstChunkArrived = new Signal();
    upstreamState.clientGotFirstEvent = new Signal();
    upstreamState.releaseHeld.fire();
    upstreamState.releaseHeld = new Signal();
  });

  it('passes method, path, query, status and headers through', async () => {
    const response = await fetch(`${base}/api/units?sort=name`, { method: 'PATCH', body: 'x' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-upstream')).toBe('stub');
    const received = await response.json() as Received;
    expect(received.method).toBe('PATCH');
    expect(received.url).toBe('/api/units?sort=name');
    expect(received.length).toBe(1);
  });

  it('tells the upstream where the request came from and drops the gateway\'s own headers', async () => {
    const response = await fetch(`${base}/echo`, {
      headers: { 'x-iqb-gate-identity': 'forged', authorization: 'Bearer abc', 'x-forwarded-for': '10.0.0.1' }
    });
    const { headers } = await response.json() as Received;
    expect(headers['x-iqb-gate-identity']).toBeUndefined();
    expect(headers.authorization).toBe('Bearer abc');
    expect(headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(headers['x-forwarded-proto']).toBe('http');
    expect(headers['x-forwarded-host']).toBe(new URL(base).host);
  });

  // Otherwise the browser library would take the application's own 428 for the gateway's
  it('drops the gateway\'s own headers from the upstream\'s answers as well', async () => {
    const response = await fetch(`${base}/conditional`);
    expect(response.status).toBe(428);
    expect(response.headers.get('x-iqb-gate-refusal')).toBeNull();
    expect(response.headers.get('x-upstream')).toBe('stub');
  });

  it('passes a 503 of the upstream on as it is, without trying again', async () => {
    const hits = upstreamState.hits;
    const response = await fetch(`${base}/unavailable`);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.text()).toBe('down for maintenance');
    expect(upstreamState.hits).toBe(hits + 1);
  });

  it('keeps answering while more than 128 requests are held open upstream', async () => {
    const held = await Promise.all(Array.from({ length: 140 }, async () => {
      const response = await fetch(`${base}/api/long/hold`);
      const reader = response.body!.getReader();
      await reader.read();
      return reader;
    }));
    const response = await fetch(`${base}/echo`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(201);
    upstreamState.releaseHeld.fire();
    await Promise.all(held.map(reader => reader.cancel()));
  });

  it('answers its health check itself', async () => {
    const hits = upstreamState.hits;
    const response = await fetch(`${base}/.iqb-gate/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(upstreamState.hits).toBe(hits);
  });

  it('passes nothing below its own prefix upstream', async () => {
    const hits = upstreamState.hits;
    const response = await fetch(`${base}/.iqb-gate/unknown`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(404);
    expect(upstreamState.hits).toBe(hits);
  });

  it('forwards an upload while it is still being sent, not after buffering it', async () => {
    // The rest of the body is only sent once the upstream has the first chunk: a gateway that
    // buffered the body would wait for that rest forever.
    const body = generatedBody(8, async index => {
      if (index === 1) await upstreamState.firstChunkArrived.promise;
    });
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: body.stream, ...STREAM_BODY });
    const received = await response.json() as Received;
    expect(received.length).toBe(8 * MIB);
    expect(received.sha256).toBe(body.sha256());
  });

  it('carries a large upload byte for byte, without a body limit', async () => {
    const body = generatedBody(512);
    const response = await fetch(`${base}/api/upload`, { method: 'PUT', body: body.stream, ...STREAM_BODY });
    expect(response.status).toBe(201);
    const received = await response.json() as Received;
    expect(received.length).toBe(512 * MIB);
    expect(received.sha256).toBe(body.sha256());
  }, 120000);

  it('passes server-sent events on as they come, not when the stream ends', async () => {
    // The upstream only ends the stream once the client has the first event.
    const response = await fetch(`${base}/sse`);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: one\n\n');
    upstreamState.clientGotFirstEvent.fire();
    const rest = await new Response(new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      }
    })).text();
    expect(rest).toBe('data: two\n\n');
  });

  it('answers 504 when the upstream stays silent longer than the timeout', async () => {
    const response = await fetch(`${base}/api/slow`);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      statusCode: 504,
      error: 'Gateway Timeout',
      message: 'The application behind the gateway did not answer in time.'
    });
  });

  it('gives a path its own, longer timeout', async () => {
    const response = await fetch(`${base}/api/long/slow`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('late');
  });

  it('lets an upload take longer than the timeout as long as it keeps moving', async () => {
    // 6 chunks, 300 ms apart: 1.8 s of sending against a timeout of 1 s.
    const body = generatedBody(6, () => sleep(300));
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: body.stream, ...STREAM_BODY });
    expect(response.status).toBe(201);
    expect((await response.json() as Received).sha256).toBe(body.sha256());
  });

  it('passes WebSockets through outside every timeout prefix as well', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/other/ws`);
    const first = await new Promise<string>((resolve, reject) => {
      socket.on('message', data => resolve(data.toString()));
      socket.on('error', reject);
    });
    socket.close();
    expect((JSON.parse(first) as { url: string }).url).toBe('/other/ws');
  });

  it('passes WebSockets through, with the handshake\'s cookie and where it came from', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/bs/public/ws?token=t1`, {
      headers: { cookie: 'session=s1', 'x-iqb-gate-identity': 'forged', 'x-forwarded-for': '10.0.0.1' }
    });
    const messages: string[] = [];
    const twoMessages = new Promise<void>((resolve, reject) => {
      socket.on('message', data => {
        messages.push(data.toString());
        if (messages.length === 1) socket.send('hello');
        if (messages.length === 2) resolve();
      });
      socket.on('error', reject);
    });
    await twoMessages;
    socket.close();
    const handshake = JSON.parse(messages[0]) as { url: string; headers: IncomingHttpHeaders };
    expect(handshake.url).toBe('/bs/public/ws?token=t1');
    expect(handshake.headers.cookie).toBe('session=s1');
    expect(handshake.headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(handshake.headers['x-iqb-gate-identity']).toBeUndefined();
    expect(messages[1]).toBe('echo: hello');
  });
});

describe('gateway behind a trusted proxy', () => {
  let upstream: Server;
  let gateway: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    upstream = await startUpstream();
    gateway = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      trustProxy: ['127.0.0.1']
    }), false);
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    base = origin(gateway.server.address() as AddressInfo);
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
  });

  it('extends the chain the proxy reported, and takes its protocol and host', async () => {
    const response = await fetch(`${base}/echo`, {
      headers: {
        'x-forwarded-for': '198.51.100.1', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'studio.example.org'
      }
    });
    const { headers } = await response.json() as Received;
    expect(headers['x-forwarded-for']).toBe('198.51.100.1, 127.0.0.1');
    expect(headers['x-forwarded-proto']).toBe('https');
    expect(headers['x-forwarded-host']).toBe('studio.example.org');
  });

  it('extends the chain on a WebSocket handshake just the same', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`, {
      headers: { 'x-forwarded-for': '198.51.100.1' }
    });
    const first = await new Promise<string>((resolve, reject) => {
      socket.on('message', data => resolve(data.toString()));
      socket.on('error', reject);
    });
    socket.close();
    const { headers } = JSON.parse(first) as { headers: IncomingHttpHeaders };
    expect(headers['x-forwarded-for']).toBe('198.51.100.1, 127.0.0.1');
  });
});

describe('gateway with an upstream of its own for a path prefix', () => {
  let upstream: Server;
  let backend: Server;
  const backendHits: string[] = [];
  let gateway: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    upstream = await startUpstream();
    backend = await new Promise<Server>(resolve => {
      const server = createServer(async (request, response) => {
        backendHits.push(request.url ?? '');
        if (request.url === '/api/slow') await sleep(1500);
        response.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'backend' });
        response.end(JSON.stringify({ url: request.url, method: request.method }));
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    gateway = await buildGateway(testConfig(origin(upstream.address() as AddressInfo), {
      upstreams: [{ prefix: '/api', upstream: origin(backend.address() as AddressInfo) }],
      timeouts: { defaultSeconds: 1, paths: [] },
      writeGate: {
        enforce: true,
        rules: [{ name: 'admin', path: /^\/api\/admin\//i }],
        exempt: [],
        burst: { limit: 30, windowSeconds: 60 },
        userClaim: undefined
      }
    }), false);
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    base = origin(gateway.server.address() as AddressInfo);
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise(resolve => { upstream.close(resolve); });
    await new Promise(resolve => { backend.close(resolve); });
  });

  it('sends the requests below the prefix there, path and query as they were', async () => {
    const response = await fetch(`${base}/api/units/a%2Fb?sort=name`, { method: 'PATCH', body: 'x' });
    expect(response.headers.get('x-upstream')).toBe('backend');
    expect(await response.json()).toEqual({ url: '/api/units/a%2Fb?sort=name', method: 'PATCH' });
    expect((await fetch(`${base}/api`)).headers.get('x-upstream')).toBe('backend');
  });

  it('sends everything else to the upstream, a path that only begins like the prefix as well', async () => {
    const response = await fetch(`${base}/apiary?x=1`);
    expect(response.headers.get('x-upstream')).toBe('stub');
    expect((await response.json() as Received).url).toBe('/apiary?x=1');
  });

  it('checks the writes below the prefix before they reach it', async () => {
    const hits = backendHits.length;
    const response = await fetch(`${base}/api/admin/users`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
    expect(backendHits.length).toBe(hits);
  });

  it('gives the prefix the timeouts as well', async () => {
    expect((await fetch(`${base}/api/slow`)).status).toBe(504);
  });

  it('keeps passing WebSockets to the upstream', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const first = await new Promise<string>((resolve, reject) => {
      socket.on('message', data => resolve(data.toString()));
      socket.on('error', reject);
    });
    socket.close();
    expect((JSON.parse(first) as { url: string }).url).toBe('/ws');
  });
});

describe('gateway without a reachable upstream', () => {
  it('answers 502 and does not tell the client where the upstream is', async () => {
    const unreachable = await new Promise<Server>(resolve => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    const address = unreachable.address() as AddressInfo;
    await new Promise(resolve => { unreachable.close(resolve); });
    const gateway = await buildGateway(testConfig(origin(address)), false);
    const response = await gateway.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      statusCode: 502,
      error: 'Bad Gateway',
      message: 'The application behind the gateway did not answer properly.'
    });
    expect(response.body).not.toContain(String(address.port));
    await gateway.close();
  });
});
