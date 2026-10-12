import { parseConfig, type GatewayEnv } from './config.js';
import { healthUrl } from './health-url.js';

// The image's HEALTHCHECK: asks the running gateway on the host and port it was configured with.
const { host, port } = parseConfig(process.env as GatewayEnv);
fetch(healthUrl(host, port), { signal: AbortSignal.timeout(2000) })
  .then(response => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
