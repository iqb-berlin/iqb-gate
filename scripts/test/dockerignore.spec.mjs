import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ROOT } from '../manifests.mjs';

const patternsOf = file => readFileSync(`${ROOT}${file}`, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

// .gitignore matches a name without a slash at any depth; .dockerignore only at the root, unless **/.
// A pattern with a slash before its end is anchored at the root in both.
const dockerPatternOf = gitPattern => {
  const pattern = gitPattern.replace(/\/$/, '');
  return pattern.includes('/') ? pattern.replace(/^\//, '') : `**/${pattern}`;
};

describe('dockerPatternOf', () => {
  it('matches a name at any depth, an anchored path at the root', () => {
    assert.equal(dockerPatternOf('node_modules/'), '**/node_modules');
    assert.equal(dockerPatternOf('*.tsbuildinfo'), '**/*.tsbuildinfo');
    assert.equal(dockerPatternOf('/out-tsc'), 'out-tsc');
    assert.equal(dockerPatternOf('examples/demo/.angular/'), 'examples/demo/.angular');
  });
});

describe('.dockerignore', () => {
  it('leaves out of the build context everything git ignores', () => {
    const docker = patternsOf('.dockerignore');
    // A negation (!) takes a file back into git; it has nothing to leave out of the build
    const missing = patternsOf('.gitignore')
      .filter(pattern => !pattern.startsWith('!'))
      .map(dockerPatternOf)
      .filter(pattern => !docker.includes(pattern));
    assert.deepEqual(missing, []);
  });

  it('leaves out every .env file, .env.local and the like as well', () => {
    assert.ok(patternsOf('.dockerignore').includes('**/.env.*'));
  });
});

// The image ships the packages' code: the MIT license goes with every copy
describe('the gateway image', () => {
  it('carries the license, which the build context does not leave out', () => {
    assert.match(readFileSync(`${ROOT}packages/gateway/Dockerfile`, 'utf8'), /^COPY LICENSE \.\/$/m);
    assert.ok(!patternsOf('.dockerignore').some(pattern => ['LICENSE', '**/LICENSE'].includes(pattern)));
  });
});
