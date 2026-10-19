// Gives every @iqb/gate-* package one version and points the workspaces at it: `npm version -w` sets
// the versions but leaves the ranges between the packages as they were, and ^0.0.x matches one version only.
// Usage: npm run version:set -- 0.1.0
import { execFileSync } from 'node:child_process';
import { isMain } from './is-main.mjs';
import { DEPENDENCY_MAPS, OWN_PACKAGE, ROOT, workspaceManifests, writeManifest } from './manifests.mjs';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function withVersion(manifest, version) {
  if (!SEMVER.test(version)) {
    throw new Error(`Not a version: "${version}" (expected e.g. 0.1.0)`);
  }
  const ranges = Object.fromEntries(DEPENDENCY_MAPS
    .filter(key => manifest[key])
    .map(key => [
      key,
      Object.fromEntries(Object.entries(manifest[key])
        .map(([name, range]) => [name, OWN_PACKAGE.test(name) ? `^${version}` : range]))
    ]));
  return { ...manifest, ...(OWN_PACKAGE.test(manifest.name) ? { version } : {}), ...ranges };
}

if (isMain(import.meta.url)) {
  const version = process.argv[2] ?? '';
  // All are worked out before the first is written: a wrong version leaves every file as it was
  const updated = workspaceManifests()
    .map(({ path, manifest }) => ({ path, manifest: withVersion(manifest, version) }));
  updated.forEach(({ path, manifest }) => writeManifest(path, manifest));
  try {
    execFileSync('npm', ['install'], { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error(`The package.json files are at ${version}, package-lock.json is not: run npm install again.`);
    process.exit(1);
  }
}
