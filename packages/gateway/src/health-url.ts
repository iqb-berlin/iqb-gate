import { GATE_PREFIX } from './config.js';

/** Addresses that mean "every interface": the gateway is then reachable on the loopback. */
const WILDCARDS = ['', '0.0.0.0', '::'];

/** Where the container's health check finds the gateway, for the host and port it listens on. */
export function healthUrl(host: string, port: number): string {
  const reachable = WILDCARDS.includes(host) ? '127.0.0.1' : host;
  const literal = reachable.includes(':') ? `[${reachable}]` : reachable;
  return `http://${literal}:${port}${GATE_PREFIX}/health`;
}
