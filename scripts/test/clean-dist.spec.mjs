import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanDist } from '../clean-dist.mjs';
import { readManifest, ROOT } from '../manifests.mjs';

const withFolder = test => {
  const folder = mkdtempSync(join(tmpdir(), 'iqb-gate-clean-dist-'));
  try {
    test(folder);
  } finally {
    rmSync(folder, { recursive: true });
  }
};

describe('cleanDist', () => {
  it('removes dist with everything in it and leaves the rest of the folder alone', () => {
    withFolder(folder => {
      mkdirSync(join(folder, 'dist', 'testing'), { recursive: true });
      writeFileSync(join(folder, 'dist', 'testing', 'deleted-module.js'), '');
      writeFileSync(join(folder, 'package.json'), '{}');
      cleanDist(folder);
      assert.equal(existsSync(join(folder, 'dist')), false);
      assert.equal(existsSync(join(folder, 'package.json')), true);
    });
  });

  it('does nothing in a folder without dist', () => {
    withFolder(folder => assert.doesNotThrow(() => cleanDist(folder)));
  });
});

describe('the libraries built with tsc', () => {
  it('empty their dist before each build: tsc never removes what the source no longer has', () => {
    ['protocol', 'oidc', 'nest', 'gateway'].forEach(name => {
      const manifest = readManifest(`${ROOT}packages/${name}/package.json`);
      assert.equal(manifest.scripts.prebuild, 'node ../../scripts/clean-dist.mjs', name);
    });
  });
});
