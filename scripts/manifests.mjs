// The package.json files of the workspaces, as the root's "workspaces" lists them.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const OWN_PACKAGE = /^@iqb\/gate-/;
export const DEPENDENCY_MAPS = ['dependencies', 'peerDependencies', 'devDependencies'];

export const readManifest = path => JSON.parse(readFileSync(path, 'utf8'));

export function workspaceManifests() {
  return readManifest(`${ROOT}package.json`).workspaces
    .map(workspace => `${ROOT}${workspace}/package.json`)
    .map(path => ({ path, manifest: readManifest(path) }));
}

export function writeManifest(path, manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
