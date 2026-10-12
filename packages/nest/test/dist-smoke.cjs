/*
 * The package as a CommonJS application gets it: `require`d from the build, which in turn
 * `require`s the ES module @iqb/gate-oidc (Node 22.12 or later). A Nest application with the guard
 * on one route lets in a token of the provider and keeps out a request without one.
 */
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Controller, Get, Module, UseGuards } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { FakeProvider } = require('@iqb/gate-oidc/testing');
const { IqbOidcModule, OidcAuthGuard } = require('../dist/index.js');

async function main() {
  const provider = new FakeProvider();
  await provider.start();

  class Protected {
    read() {
      return { ok: true };
    }
  }
  Get()(Protected.prototype, 'read', Object.getOwnPropertyDescriptor(Protected.prototype, 'read'));
  UseGuards(OidcAuthGuard)(Protected.prototype, 'read', Object.getOwnPropertyDescriptor(Protected.prototype, 'read'));
  Controller('protected')(Protected);

  class App {}
  Module({
    imports: [IqbOidcModule.forRoot({ issuer: provider.issuer, clientId: 'studio' })],
    controllers: [Protected]
  })(App);

  const app = await NestFactory.create(App, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/protected`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const token = await provider.sign();
    assert.equal((await fetch(base, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    console.log('dist smoke test: the CommonJS build works in a Nest application');
  } finally {
    await app.close();
    await provider.stop();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
