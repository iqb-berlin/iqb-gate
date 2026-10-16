// Empties a package's dist before it is built: tsc writes what the source has, but never removes
// what it no longer has, and `files: ["dist"]` would publish a module deleted from the source.
// Usage: "prebuild": "node ../../scripts/clean-dist.mjs" -- npm runs it in the package's folder.
// The gateway's Dockerfile copies this file alone into its build: it imports nothing but node:.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

export function cleanDist(folder) {
  rmSync(join(folder, 'dist'), { recursive: true, force: true });
}

if (import.meta.main) {
  cleanDist(process.cwd());
}
