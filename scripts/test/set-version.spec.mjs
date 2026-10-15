import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withVersion } from '../set-version.mjs';

describe('withVersion', () => {
  it('sets the version of an @iqb/gate-* package', () => {
    assert.equal(withVersion({ name: '@iqb/gate-oidc', version: '0.0.0' }, '0.1.0').version, '0.1.0');
  });

  it('leaves the version of another package alone', () => {
    assert.equal(withVersion({ name: 'iqb-gate-demo', version: '0.0.0' }, '0.1.0').version, '0.0.0');
  });

  it('points the @iqb/gate-* ranges of all three dependency maps at the version', () => {
    const manifest = withVersion({
      name: 'iqb-gate-demo',
      version: '0.0.0',
      dependencies: { '@iqb/gate-protocol': '^0.0.0', rxjs: '7.8.2' },
      peerDependencies: { '@iqb/gate-oidc': '^0.0.0', '@angular/core': '>=20.0.0 <22.0.0' },
      devDependencies: { '@iqb/gate-nest': '^0.0.0', vitest: '4.1.11' }
    }, '1.2.3-rc.1');
    assert.deepEqual(manifest.dependencies, { '@iqb/gate-protocol': '^1.2.3-rc.1', rxjs: '7.8.2' });
    assert.deepEqual(
      manifest.peerDependencies,
      { '@iqb/gate-oidc': '^1.2.3-rc.1', '@angular/core': '>=20.0.0 <22.0.0' }
    );
    assert.deepEqual(manifest.devDependencies, { '@iqb/gate-nest': '^1.2.3-rc.1', vitest: '4.1.11' });
  });

  it('keeps the order of the keys and adds no dependency map', () => {
    const manifest = withVersion({ name: '@iqb/gate-protocol', version: '0.0.0', license: 'MIT' }, '0.1.0');
    assert.deepEqual(Object.keys(manifest), ['name', 'version', 'license']);
  });

  it('refuses what is not a version', () => {
    ['1.0', 'v1.0.0', ''].forEach(version => {
      assert.throws(() => withVersion({ name: '@iqb/gate-oidc', version: '0.0.0' }, version), /Not a version/);
    });
  });
});
