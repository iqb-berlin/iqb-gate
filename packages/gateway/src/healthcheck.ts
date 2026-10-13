import { parseConfig, type GatewayEnv } from './config.js';
import { readConfigFile } from './config-file.js';
import { healthUrl } from './health-url.js';

// The image's HEALTHCHECK: asks the running gateway on the host and port it was configured with.
const env = process.env as GatewayEnv;
const { host, port } = parseConfig(env, readConfigFile(env));
fetch(healthUrl(host, port), { signal: AbortSignal.timeout(2000) })
  .then(response => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
