import { readFileSync } from 'node:fs';
import { ConfigError, parseConfig, type GatewayEnv } from './config.js';
import { buildGateway } from './gateway.js';

/**
 * How long a stop waits for open requests -- uploads, event streams, WebSockets -- before cutting
 * them: below Docker's default of 10 seconds before it kills the container.
 */
const SHUTDOWN_GRACE_MS = 8000;

function readConfigFile(env: GatewayEnv): string | undefined {
  return env.IQB_GATE_CONFIG ? readFileSync(env.IQB_GATE_CONFIG, 'utf8') : undefined;
}

async function main(): Promise<void> {
  const env = process.env as GatewayEnv;
  const config = parseConfig(env, readConfigFile(env));
  const gateway = await buildGateway(config);

  const close = (signal: string) => {
    gateway.log.info(`${signal}: closing, open connections get ${SHUTDOWN_GRACE_MS / 1000} s`);
    setTimeout(() => {
      gateway.log.warn('connections still open, cutting them');
      gateway.server.closeAllConnections();
      process.exit(0);
    }, SHUTDOWN_GRACE_MS).unref();
    gateway.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.once('SIGTERM', () => close('SIGTERM'));
  process.once('SIGINT', () => close('SIGINT'));

  await gateway.listen({ host: config.host, port: config.port });
  gateway.log.info(`forwarding to ${config.upstream}`);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? `Configuration: ${error.message}` : error;
  console.error(message);
  process.exit(1);
});
