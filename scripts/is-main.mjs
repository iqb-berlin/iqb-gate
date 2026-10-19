// Whether a module runs as the script node was started with, rather than being imported (by a test).
// `import.meta.main` says so only from Node 22.18 and 24.2 on, and is undefined before: a script asking
// it would do nothing there and exit 0 -- a publish that publishes nothing, and reports success.
// Imports nothing but node:, like clean-dist.mjs, which the gateway's Dockerfile copies with it.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const realPath = path => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** `moduleUrl`: the module's `import.meta.url`; `scriptPath`: the script node runs, `undefined` for `node -e`. */
export function isMain(moduleUrl, scriptPath = process.argv[1]) {
  return scriptPath !== undefined && realPath(scriptPath) === realPath(fileURLToPath(moduleUrl));
}
