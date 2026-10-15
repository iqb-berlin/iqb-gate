import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PUBLISHED, publishCommands, publishProblems } from '../publish.mjs';

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
      ? { ...manifest, dependencies: { '@iqb/gate-protocol': '^0.0.0', jose: '6.2.12' } }
      : { ...manifest, peerDependencies: { '@iqb/gate-protocol': '^0.1.0' } }));
    assert.deepEqual(publishProblems(manifests, ''), [
      '@iqb/gate-oidc depends on @iqb/gate-protocol ^0.0.0, not ^0.1.0: npm run version:set -- <version>'
    ]);
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
