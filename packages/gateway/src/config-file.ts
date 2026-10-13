import { readFileSync } from 'node:fs';
import type { GatewayEnv } from './config.js';

/**
 * The file `IQB_GATE_CONFIG` names, or nothing without it. The server and the image's health check
 * both read it: rules switched off by name (`IQB_GATE_RULES_OFF`) are only known with the file.
 */
export function readConfigFile(env: GatewayEnv): string | undefined {
  return env.IQB_GATE_CONFIG ? readFileSync(env.IQB_GATE_CONFIG, 'utf8') : undefined;
}
