import { parse } from 'yaml';

/** The gateway's own paths; nothing below it is ever passed upstream. */
export const GATE_PREFIX = '/.iqb-gate';

/** How long the upstream may stay silent on requests below a path prefix. */
export interface PathTimeout {
  prefix: string;
  seconds: number;
}

export interface GatewayConfig {
  /** Where every request that is not the gateway's own goes, e.g. `http://frontend:8080`. */
  upstream: string;
  host: string;
  port: number;
  /** Fastify's `trustProxy`: whether `X-Forwarded-*` from a proxy in front (Traefik) is believed. */
  trustProxy: boolean | string[];
  timeouts: {
    defaultSeconds: number;
    paths: PathTimeout[];
  };
}

/** The settings the environment gives; the file named by `IQB_GATE_CONFIG` adds the timeouts. */
export type GatewayEnv = Partial<Record<
  'IQB_GATE_UPSTREAM' | 'IQB_GATE_HOST' | 'IQB_GATE_PORT' | 'IQB_GATE_TRUST_PROXY' | 'IQB_GATE_CONFIG',
  string
>>;

export class ConfigError extends Error {}

const DEFAULT_PORT = 8080;
const DEFAULT_TIMEOUT_SECONDS = 600;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseUpstream(value: string | undefined): string {
  if (!value) throw new ConfigError('IQB_GATE_UPSTREAM is required, e.g. http://frontend:8080.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`IQB_GATE_UPSTREAM is no URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`IQB_GATE_UPSTREAM has to be http or https: ${value}`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError(`IQB_GATE_UPSTREAM is an origin, without path or query: ${value}`);
  }
  return url.origin;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`IQB_GATE_PORT is no port: ${value}`);
  }
  return port;
}

function parseTrustProxy(value: string | undefined): boolean | string[] {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  return trimmed.split(',').map(address => address.trim()).filter(address => address !== '');
}

/** Characters that are no plain path: the router would read `:` and `*` as parameters. */
const NOT_IN_A_PREFIX = /[:*?#\s]/;

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A misspelled key would otherwise fall back to a default without a word. */
function rejectUnknownKeys(mapping: Record<string, unknown>, known: string[], where: string): void {
  const unknown = Object.keys(mapping).filter(key => !known.includes(key));
  if (unknown.length) {
    throw new ConfigError(`${where} has unknown keys: ${unknown.join(', ')} (known: ${known.join(', ')}).`);
  }
}

function parsePathTimeout(entry: unknown, index: number): PathTimeout {
  const where = `timeouts.paths[${index}]`;
  if (!isMapping(entry)) throw new ConfigError(`${where} has to be a mapping with prefix and seconds.`);
  rejectUnknownKeys(entry, ['prefix', 'seconds'], where);
  const { prefix, seconds } = entry;
  const path = typeof prefix === 'string' ? prefix.replace(/\/+$/, '') : '';
  if (!path.startsWith('/') || NOT_IN_A_PREFIX.test(path)) {
    throw new ConfigError(`${where}.prefix has to be a plain path below /, e.g. /api/upload.`);
  }
  if (path === GATE_PREFIX || path.startsWith(`${GATE_PREFIX}/`)) {
    throw new ConfigError(`${where}.prefix lies in the gateway's own ${GATE_PREFIX}/.`);
  }
  if (!isPositiveInteger(seconds)) {
    throw new ConfigError(`${where}.seconds has to be a positive whole number.`);
  }
  return { prefix: path, seconds };
}

/**
 * Reads the timeouts from the YAML file; an absent or empty file means the defaults. A prefix is
 * kept without a trailing slash: `/api/upload/` and `/api/upload` name the same subtree.
 */
export function parseTimeouts(yamlText: string | undefined): GatewayConfig['timeouts'] {
  const file: unknown = yamlText ? parse(yamlText) : null;
  if (file !== null && !isMapping(file)) throw new ConfigError('The configuration file has to be a mapping.');
  rejectUnknownKeys(file ?? {}, ['timeouts'], 'The configuration file');
  const timeouts = file?.timeouts ?? {};
  if (!isMapping(timeouts)) throw new ConfigError('timeouts has to be a mapping with default and paths.');
  rejectUnknownKeys(timeouts, ['default', 'paths'], 'timeouts');
  const defaultSeconds = timeouts.default ?? DEFAULT_TIMEOUT_SECONDS;
  if (!isPositiveInteger(defaultSeconds)) {
    throw new ConfigError('timeouts.default has to be a positive whole number of seconds.');
  }
  const rawPaths = timeouts.paths ?? [];
  if (!Array.isArray(rawPaths)) throw new ConfigError('timeouts.paths has to be a list.');
  const paths = rawPaths.map(parsePathTimeout);
  const duplicate = paths.find((path, index) => paths.findIndex(other => other.prefix === path.prefix) !== index);
  if (duplicate) throw new ConfigError(`timeouts.paths names ${duplicate.prefix} twice.`);
  return { defaultSeconds, paths };
}

/**
 * Builds the gateway's configuration from the environment and the text of the file that
 * `IQB_GATE_CONFIG` names (read by the caller). Throws a {@link ConfigError} saying what is wrong.
 */
export function parseConfig(env: GatewayEnv, configFileText?: string): GatewayConfig {
  return {
    upstream: parseUpstream(env.IQB_GATE_UPSTREAM),
    host: env.IQB_GATE_HOST || '0.0.0.0',
    port: parsePort(env.IQB_GATE_PORT),
    trustProxy: parseTrustProxy(env.IQB_GATE_TRUST_PROXY),
    timeouts: parseTimeouts(configFileText)
  };
}
