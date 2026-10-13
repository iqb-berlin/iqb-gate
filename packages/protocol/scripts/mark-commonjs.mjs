// The package is "type": "module", so Node would read dist/cjs/*.js as ES modules: the folder gets a
// package.json of its own that says they are CommonJS -- for Jest and other require() callers.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

writeFileSync(fileURLToPath(import.meta.resolve('../dist/cjs/package.json')), '{ "type": "commonjs" }\n');
