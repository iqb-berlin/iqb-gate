import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The demo page, built from ../demo
  app.useStaticAssets(join(__dirname, '../../demo/dist/demo/browser'));
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, '127.0.0.1');
  console.log(`demo api at http://127.0.0.1:${port}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
