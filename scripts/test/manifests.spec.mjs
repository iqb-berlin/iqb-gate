import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readManifest, ROOT, workspaceManifests, writeManifest } from '../manifests.mjs';

describe('workspaceManifests', () => {
  it('reads the manifest of every workspace, in the order of the root', () => {
    const workspaces = readManifest(`${ROOT}package.json`).workspaces;
    const manifests = workspaceManifests();
    assert.deepEqual(
      manifests.map(({ path }) => path),
      workspaces.map(workspace => `${ROOT}${workspace}/package.json`)
    );
    assert.ok(manifests.some(({ manifest }) => manifest.name === '@iqb/gate-protocol'));
  });
});

describe('writeManifest', () => {
  it('writes the manifest as npm does: two spaces, a newline at the end', () => {
    const folder = mkdtempSync(join(tmpdir(), 'iqb-gate-manifest-'));
    try {
      const path = join(folder, 'package.json');
      writeManifest(path, { name: '@iqb/gate-oidc', files: ['dist'] });
      assert.equal(readFileSync(path, 'utf8'), '{\n  "name": "@iqb/gate-oidc",\n  "files": [\n    "dist"\n  ]\n}\n');
      assert.deepEqual(readManifest(path), { name: '@iqb/gate-oidc', files: ['dist'] });
    } finally {
      rmSync(folder, { recursive: true });
    }
  });
});
