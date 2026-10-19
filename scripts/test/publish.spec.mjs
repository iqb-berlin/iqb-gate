import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BUILD_CONFIGS, licensesMissing, mapsWithoutSources, PACKAGE_FOLDERS, PUBLISHED, publishCommands, publishProblems
} from '../publish.mjs';
import { ROOT } from '../manifests.mjs';

const released = version => PUBLISHED.map(name => ({ name, version }));

describe('publishProblems', () => {
  it('finds nothing in a committed tree with one released version', () => {
    assert.deepEqual(publishProblems(released('0.1.0'), ''), []);
  });

  it('reports packages that differ in version', () => {
    const manifests = [...released('0.1.0').slice(1), { name: '@iqb/gate-protocol', version: '0.2.0' }];
    const problems = publishProblems(manifests, '');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /differ in version \(0\.1\.0, 0\.2\.0\)/);
  });

  it('reports the unreleased version 0.0.0', () => {
    assert.match(publishProblems(released('0.0.0'), '').join('\n'), /0\.0\.0 is the version of the unreleased/);
  });

  it('reports changes in the working tree', () => {
    assert.match(publishProblems(released('0.1.0'), ' M package.json\n').join('\n'), /working tree has changes/);
  });

  it('reports a package that is not among the manifests', () => {
    assert.deepEqual(
      publishProblems(released('0.1.0').slice(1), ''),
      ['@iqb/gate-protocol is not among the workspaces']
    );
  });

  it('reports a range between the packages that misses the version', () => {
    const manifests = released('0.1.0').map(manifest => (manifest.name === '@iqb/gate-oidc'
      ? { ...manifest, dependencies: { '@iqb/gate-protocol': '^0.0.0', jose: '^6.2.12' } }
      : { ...manifest, peerDependencies: { '@iqb/gate-protocol': '^0.1.0' } }));
    assert.deepEqual(publishProblems(manifests, ''), [
      '@iqb/gate-oidc depends on @iqb/gate-protocol ^0.0.0, not ^0.1.0: npm run version:set -- <version>'
    ]);
  });

  // A library that pins a dependency forces a copy of its own on every application that uses another version
  it('reports a dependency pinned to one version, in any form, except the ALTCHA widget', () => {
    const angular = {
      name: '@iqb/gate-angular',
      version: '0.1.0',
      dependencies: { 'angular-auth-oidc-client': '22.0.1', tslib: '^2.8.1', altcha: '3.3.0', a: 'v1.2.3' },
      peerDependencies: {
        rxjs: '7.8.1', '@angular/core': '>=20.0.0 <22.0.0', b: '1.x', c: '~1.2.0 || ^2', f: '7.4.0 - 7.8.2',
        g: '6', h: '2.8', i: '', j: '=6', k: 'npm:k@6', l: 'npm:l', m: '=1.2.3'
      },
      optionalDependencies: { d: 'npm:d@1.2.3', e: '*', n: 'npm:@scope/n@1.2.3-rc.1' }
    };
    const manifests = [...released('0.1.0').filter(manifest => manifest.name !== angular.name), angular, angular];
    assert.deepEqual(publishProblems(manifests, ''), ['angular-auth-oidc-client to 22.0.1', 'a to v1.2.3',
      'rxjs to 7.8.1', 'm to =1.2.3', 'd to npm:d@1.2.3', 'n to npm:@scope/n@1.2.3-rc.1']
      .map(pin => `@iqb/gate-angular pins ${pin}: a library depends on a range, such as ^`));
  });
});

describe('mapsWithoutSources', () => {
  it('reports the source maps that point at sources which are not published', () => {
    const dist = mkdtempSync(join(tmpdir(), 'maps-'));
    try {
      mkdirSync(join(dist, 'cjs'));
      const carrying = { sources: ['../src/index.ts'], sourcesContent: ['x'] };
      writeFileSync(join(dist, 'index.js.map'), JSON.stringify(carrying));
      writeFileSync(join(dist, 'cjs', 'index.js.map'), JSON.stringify({ sources: ['../../src/index.ts'] }));
      writeFileSync(join(dist, 'index.js'), '');
      writeFileSync(join(dist, 'cut.js.map'), '');
      assert.deepEqual(mapsWithoutSources([dist, join(dist, 'missing')]).sort(), [
        `${dist}/cjs/index.js.map does not carry its sources`,
        `${dist}/cut.js.map is no source map`
      ]);
    } finally {
      rmSync(dist, { recursive: true });
    }
  });
});

describe('licensesMissing', () => {
  it('reports the folders without the license, or with another one', () => {
    const root = mkdtempSync(join(tmpdir(), 'licenses-'));
    try {
      ['same', 'other', 'none'].forEach(folder => mkdirSync(join(root, folder)));
      writeFileSync(join(root, 'LICENSE'), 'MIT');
      writeFileSync(join(root, 'same', 'LICENSE'), 'MIT');
      writeFileSync(join(root, 'other', 'LICENSE'), 'MIT, 2019');
      assert.deepEqual(licensesMissing(join(root, 'LICENSE'), ['same', 'other', 'none'].map(f => join(root, f))), [
        `${join(root, 'other')}/LICENSE is missing or differs from ${join(root, 'LICENSE')}`,
        `${join(root, 'none')}/LICENSE is missing or differs from ${join(root, 'LICENSE')}`
      ]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it('reports a repository without its license, instead of failing', () => {
    assert.deepEqual(licensesMissing('/nowhere/LICENSE', ['/nowhere/a']), ['/nowhere/LICENSE is missing']);
  });

  // A copy that drifts from the repository's would be published as it is
  it('finds the repository\'s license in the folder of every published package', () => {
    assert.deepEqual(licensesMissing(`${ROOT}LICENSE`, PACKAGE_FOLDERS.map(folder => `${ROOT}${folder}`)), []);
  });
});

describe('the builds of the Node packages', () => {
  // Their maps point at src/, which is not published
  it('write source maps that carry their sources', () => {
    BUILD_CONFIGS.forEach(config => {
      const { compilerOptions } = JSON.parse(execFileSync(
        `${ROOT}node_modules/.bin/tsc`,
        ['-p', `${ROOT}${config}`, '--showConfig'],
        { encoding: 'utf8' }
      ));
      assert.ok(!compilerOptions.sourceMap || compilerOptions.inlineSources, config);
    });
  });
});

describe('publishCommands', () => {
  it('publishes each package after the ones it depends on, the Angular library from its dist', () => {
    assert.deepEqual(publishCommands([]), [
      ['publish', '-w', '@iqb/gate-protocol'],
      ['publish', '-w', '@iqb/gate-oidc'],
      ['publish', '-w', '@iqb/gate-nest'],
      ['publish', 'packages/angular/dist']
    ]);
  });

  it('passes the arguments on to every call', () => {
    assert.ok(publishCommands(['--tag', 'next']).every(args => args.slice(-2).join(' ') === '--tag next'));
  });

  it('skips the packages that are on npm already', () => {
    assert.deepEqual(publishCommands(['--dry-run'], ['@iqb/gate-protocol', '@iqb/gate-oidc']), [
      ['publish', '-w', '@iqb/gate-nest', '--dry-run'],
      ['publish', 'packages/angular/dist', '--dry-run']
    ]);
  });
});
