/*
 * The OIDC client is an optional peer: the build's main entry point must not import it, nor the
 * entry point @iqb/gate-angular/oidc that does. An application without OIDC would not build
 * otherwise. And the oidc entry point is there for applications to resolve: in `exports`, with its
 * code and its types. Takes the build's folder as argument (default: dist, from packages/angular).
 */
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const dist = process.argv[2] ?? 'dist';
const read = file => readFileSync(join(dist, file), 'utf8');

/**
 * Whether `text` imports `name` or a path below it: from it, for its side effects, dynamically
 * (quoted or as a template) or as a type reference.
 */
function imports(text, name) {
  const quoted = `['"\`]${name.replace(/[/@.-]/g, '\\$&')}(/[^'"\`]*)?['"\`]`;
  return [`\\bfrom\\s*${quoted}`, `\\bimport\\s*${quoted}`, `\\bimport\\s*\\(\\s*${quoted}`, `types\\s*=\\s*${quoted}`]
    .some(form => new RegExp(form).test(text));
}

['fesm2022/iqb-gate-angular.mjs', 'index.d.ts'].forEach(file => {
  const text = read(file);
  ['angular-auth-oidc-client', '@iqb/gate-angular/oidc'].forEach(name => {
    assert.ok(!imports(text, name), `${file} imports ${name}: the main entry point needs the optional peer`);
  });
});

const manifest = JSON.parse(read('package.json'));
assert.equal(manifest.peerDependenciesMeta?.['angular-auth-oidc-client']?.optional, true);
const oidc = manifest.exports?.['./oidc'];
assert.equal(typeof oidc?.types, 'string', 'exports["./oidc"] names no types');
assert.equal(typeof oidc?.default, 'string', 'exports["./oidc"] names no default');
[oidc.types, oidc.default].forEach(file => assert.ok(existsSync(join(dist, file)), `${file} is missing`));
assert.ok(imports(read(oidc.default), 'angular-auth-oidc-client'), `${oidc.default} does not import the client`);
assert.match(read(oidc.types), /^export \{[^}]*\bprovideIqbOidc\b/m, `${oidc.types} does not export provideIqbOidc`);
console.log('dist smoke test: the main entry point builds without the OIDC client; @iqb/gate-angular/oidc resolves');
