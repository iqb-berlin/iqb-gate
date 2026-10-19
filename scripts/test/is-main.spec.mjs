import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from '../is-main.mjs';

const script = fileURLToPath(new URL('../publish.mjs', import.meta.url));
const moduleUrl = pathToFileURL(script).href;

describe('isMain', () => {
  it('knows the module node was started with', () => {
    assert.equal(isMain(moduleUrl, script), true);
  });

  it('tells a module imported by another script from it', () => {
    assert.equal(isMain(moduleUrl, fileURLToPath(new URL('../set-version.mjs', import.meta.url))), false);
  });

  it('knows no module as the script of node -e, which has none', () => {
    assert.equal(isMain(moduleUrl, undefined), false);
  });

  // npm runs a package's scripts from its folder, which may lie behind a symbolic link
  it('knows the module through a symbolic link to it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'iqb-gate-is-main-'));
    try {
      const link = join(folder, 'publish.mjs');
      symlinkSync(script, link);
      assert.equal(isMain(moduleUrl, link), true);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });
});
