/*
 * The OIDC client is an optional peer: the build's main entry point must not need it, nor the
 * entry point @iqb/gate-angular/oidc that does. An application without OIDC would not build
 * otherwise. Takes the build's folder as argument (default: dist, from packages/angular).
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const dist = process.argv[2] ?? 'dist';
const main = ['fesm2022/iqb-gate-angular.mjs', 'index.d.ts'];
const oidc = 'fesm2022/iqb-gate-angular-oidc.mjs';

main.forEach(file => {
  const text = readFileSync(join(dist, file), 'utf8');
  ['angular-auth-oidc-client', '@iqb/gate-angular/oidc'].forEach(name => {
    assert.ok(!text.includes(name), `${file} names ${name}: the main entry point needs the optional peer`);
  });
});
assert.ok(readFileSync(join(dist, oidc), 'utf8').includes('angular-auth-oidc-client'), `${oidc} is missing`);
const manifest = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));
assert.equal(manifest.peerDependenciesMeta?.['angular-auth-oidc-client']?.optional, true);
console.log('dist smoke test: the main entry point builds without the OIDC client');
