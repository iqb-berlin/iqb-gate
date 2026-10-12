import { randomBytes } from 'node:crypto';
import { parse } from 'yaml';
import { GATE_PREFIX } from '@iqb/gate-protocol';
import {
  ConfigError, isMapping, isPositiveInteger, listAt, rejectUnknownKeys
} from './config-helpers.js';
import { parseWriteGate, type WriteGateConfig } from './write-gate/write-gate-config.js';

export { ConfigError, GATE_PREFIX };

/** How long the upstream may stay silent on requests below a path prefix. */
export interface PathTimeout {
  prefix: string;
  seconds: number;
}

/** Where the audit log of checked writes is kept, for how long, and who may read it. */
export interface AuditConfig {
  /** The SQLite file; `:memory:` keeps it in memory (tests). */
  file: string;
  retentionDays: number;
  /** What `/.iqb-gate/admin/` wants as password or Bearer token; without it, there is no audit page. */
  key: string | undefined;
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
  /** Signs the session cookie and the ALTCHA challenges. */
  secret: string;
  writeGate: WriteGateConfig;
  audit: AuditConfig;
}

/** The settings the environment gives; the file named by `IQB_GATE_CONFIG` adds timeouts and rules. */
export type GatewayEnv = Partial<Record<
  'IQB_GATE_UPSTREAM' | 'IQB_GATE_HOST' | 'IQB_GATE_PORT' | 'IQB_GATE_TRUST_PROXY' | 'IQB_GATE_CONFIG' |
  'IQB_GATE_ENFORCE' | 'IQB_GATE_SECRET' | 'IQB_GATE_AUDIT_FILE' | 'IQB_GATE_AUDIT_RETENTION_DAYS' |
  'IQB_GATE_AUDIT_KEY',
  string
>>;

const DEFAULT_PORT = 8080;
const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_AUDIT_FILE = '/var/lib/iqb-gate/audit.sqlite';
const DEFAULT_AUDIT_RETENTION_DAYS = 90;
const MIN_SECRET_LENGTH = 32;

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
 * Reads the `timeouts` section; an absent one means the defaults. A prefix is kept without a
 * trailing slash: `/api/upload/` and `/api/upload` name the same subtree.
 */
function parseTimeouts(section: unknown): GatewayConfig['timeouts'] {
  const timeouts = section ?? {};
  if (!isMapping(timeouts)) throw new ConfigError('timeouts has to be a mapping with default and paths.');
  rejectUnknownKeys(timeouts, ['default', 'paths'], 'timeouts');
  const defaultSeconds = timeouts.default ?? DEFAULT_TIMEOUT_SECONDS;
  if (!isPositiveInteger(defaultSeconds)) {
    throw new ConfigError('timeouts.default has to be a positive whole number of seconds.');
  }
  const paths = listAt(timeouts.paths, 'timeouts.paths').map(parsePathTimeout);
  const duplicate = paths.find((path, index) => paths.findIndex(other => other.prefix === path.prefix) !== index);
  if (duplicate) throw new ConfigError(`timeouts.paths names ${duplicate.prefix} twice.`);
  return { defaultSeconds, paths };
}

/** The file's sections; an absent or empty file has none. */
function parseFile(yamlText: string | undefined): Record<string, unknown> {
  const file: unknown = yamlText ? parse(yamlText) : null;
  if (file === null || file === undefined) return {};
  if (!isMapping(file)) throw new ConfigError('The configuration file has to be a mapping.');
  rejectUnknownKeys(file, ['timeouts', 'writeGate'], 'The configuration file');
  return file;
}

/**
 * The gateway's secret. Required once writes are checked: the cookies and challenges it signs have
 * to stay valid across a restart. Without checked writes, a random one does.
 */
function parseSecret(value: string | undefined, required: boolean): string {
  if (value) {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new ConfigError(`IQB_GATE_SECRET has to be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    return value;
  }
  if (required) throw new ConfigError('IQB_GATE_SECRET is required when writeGate has rules.');
  return randomBytes(32).toString('hex');
}

function parseRetentionDays(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_AUDIT_RETENTION_DAYS;
  const days = Number(value);
  if (!isPositiveInteger(days)) throw new ConfigError(`IQB_GATE_AUDIT_RETENTION_DAYS is no number of days: ${value}`);
  return days;
}

function parseAuditKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`IQB_GATE_AUDIT_KEY has to be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return value;
}

/**
 * Builds the gateway's configuration from the environment and the text of the file that
 * `IQB_GATE_CONFIG` names (read by the caller). Throws a {@link ConfigError} saying what is wrong.
 */
export function parseConfig(env: GatewayEnv, configFileText?: string): GatewayConfig {
  const file = parseFile(configFileText);
  const writeGate = parseWriteGate(file.writeGate, env.IQB_GATE_ENFORCE);
  return {
    upstream: parseUpstream(env.IQB_GATE_UPSTREAM),
    host: env.IQB_GATE_HOST || '0.0.0.0',
    port: parsePort(env.IQB_GATE_PORT),
    trustProxy: parseTrustProxy(env.IQB_GATE_TRUST_PROXY),
    timeouts: parseTimeouts(file.timeouts),
    secret: parseSecret(env.IQB_GATE_SECRET, writeGate.enforce && writeGate.rules.length > 0),
    writeGate,
    audit: {
      file: env.IQB_GATE_AUDIT_FILE || DEFAULT_AUDIT_FILE,
      retentionDays: parseRetentionDays(env.IQB_GATE_AUDIT_RETENTION_DAYS),
      key: parseAuditKey(env.IQB_GATE_AUDIT_KEY)
    }
  };
}
