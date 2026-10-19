// Publishes the libraries to npmjs, each after the ones it depends on. @iqb/gate-angular goes from its
// dist, where ng-packagr writes the manifest; its own folder holds the source.
// Usage: npm run publish:npm [-- --tag next] -- it builds and tests first; the arguments go on to `npm publish`
// (a prerelease such as 0.2.0-rc.1 needs a --tag). A package whose version is on npm already is skipped,
// so a publish that stopped halfway is finished by running it again.
//   node scripts/publish.mjs --check      only the checks, before the build
//   node scripts/publish.mjs --dry-run    packs without publishing and reports the problems as warnings
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';
import { DEPENDENCY_MAPS, OWN_PACKAGE, readManifest, ROOT, workspaceManifests } from './manifests.mjs';

const ANGULAR_DIST = 'packages/angular/dist';
const TARGETS = [
  { name: '@iqb/gate-protocol', args: ['-w', '@iqb/gate-protocol'] },
  { name: '@iqb/gate-oidc', args: ['-w', '@iqb/gate-oidc'] },
  { name: '@iqb/gate-nest', args: ['-w', '@iqb/gate-nest'] },
  { name: '@iqb/gate-angular', args: [ANGULAR_DIST] }
];

export const PUBLISHED = TARGETS.map(target => target.name);

/** Where the published packages are built; their source maps go with them. */
const DISTS = ['packages/protocol/dist', 'packages/oidc/dist', 'packages/nest/dist', ANGULAR_DIST];

/** The TypeScript configurations that build the Node packages (Angular's is ng-packagr's). */
export const BUILD_CONFIGS = [
  'packages/protocol/tsconfig.json', 'packages/protocol/tsconfig.cjs.json',
  'packages/oidc/tsconfig.build.json', 'packages/nest/tsconfig.build.json'
];

/**
 * Dependencies a published library may pin to one version: the ALTCHA widget, whose texts the
 * Angular library sets by names its types do not declare (gate-texts.ts).
 */
const PINS_ALLOWED = ['altcha'];

/**
 * What makes a range of versions -- an operator, a wildcard, a hyphen range (`1.2.3 - 1.4.0`):
 * anything without it -- `1.2.3`, `v1.2.3`, `npm:x@1.2.3` -- is one version.
 */
const RANGE = /[\^~<>*|]|\s-\s|(^|[.\s])[xX](?=$|[.\s])/;

/** The maps of the dependencies an application installs with a library. */
const INSTALLED_MAPS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const SET_VERSION = 'npm run version:set -- <version>';

const missingPackages = manifests => PUBLISHED
  .filter(name => !manifests.some(manifest => manifest.name === name))
  .map(name => `${name} is not among the workspaces`);

const wrongRanges = (manifests, version) => manifests.flatMap(manifest => DEPENDENCY_MAPS
  .flatMap(key => Object.entries(manifest[key] ?? {}))
  .filter(([name, range]) => OWN_PACKAGE.test(name) && range !== `^${version}`)
  .map(([name, range]) => `${manifest.name} depends on ${name} ${range}, not ^${version}: ${SET_VERSION}`));

/** A library that pins a dependency forces a copy of its own on every application that uses another version. */
const pinnedDependencies = manifests => manifests.flatMap(manifest => INSTALLED_MAPS
  .flatMap(key => Object.entries(manifest[key] ?? {}))
  .filter(([name, range]) => !OWN_PACKAGE.test(name) && !PINS_ALLOWED.includes(name) && !RANGE.test(range))
  .map(([name, range]) => `${manifest.name} pins ${name} to ${range}: a library depends on a range, such as ^`));

export function publishProblems(manifests, gitStatus) {
  const versions = [...new Set(manifests.map(manifest => manifest.version))];
  // The Angular library's source and dist manifests say the same: each problem once
  return [...new Set([
    ...missingPackages(manifests),
    ...(versions.length > 1 ? [`The packages differ in version (${versions.join(', ')}): ${SET_VERSION}`] : []),
    ...(versions.includes('0.0.0') ? [`0.0.0 is the version of the unreleased workspace: ${SET_VERSION}`] : []),
    ...(versions.length === 1 ? wrongRanges(manifests, versions[0]) : []),
    ...pinnedDependencies(manifests),
    ...(gitStatus.trim() ? ['The working tree has changes: commit what is published'] : [])
  ])];
}

/** Whether a source map carries the sources it names; `null` for what is no source map. */
const carriesSources = path => {
  try {
    const { sources = [], sourcesContent = [] } = JSON.parse(readFileSync(path, 'utf8'));
    return sources.length === sourcesContent.length && sourcesContent.every(content => typeof content === 'string');
  } catch {
    return null;
  }
};

/**
 * The source maps in `dists` that do not carry their sources: they point at `src/`, which is not
 * published, and lead a debugger nowhere.
 */
export function mapsWithoutSources(dists) {
  return dists
    .filter(dist => existsSync(dist))
    .flatMap(dist => readdirSync(dist, { recursive: true, encoding: 'utf8' })
      .filter(path => path.endsWith('.map'))
      .map(path => `${dist}/${path}`))
    .map(path => ({ path, carries: carriesSources(path) }))
    .filter(({ carries }) => carries !== true)
    .map(({ path, carries }) => (carries === null ? `${path} is no source map` : `${path} does not carry its sources`));
}

export function publishCommands(npmArgs, onNpmAlready = []) {
  return TARGETS
    .filter(target => !onNpmAlready.includes(target.name))
    .map(target => ['publish', ...target.args, ...npmArgs]);
}

const isOnNpm = (name, version) => {
  try {
    return execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' }).trim() === version;
  } catch {
    return false;
  }
};

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const dryRun = args.includes('--dry-run');
  const sources = workspaceManifests()
    .map(({ manifest }) => manifest)
    .filter(manifest => PUBLISHED.includes(manifest.name));
  const distPath = `${ROOT}${ANGULAR_DIST}/package.json`;
  const dist = checkOnly || !existsSync(distPath) ? [] : [readManifest(distPath)];
  const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const problems = [
    ...publishProblems([...sources, ...dist], gitStatus),
    ...(checkOnly || dist.length > 0 ? [] : [`${ANGULAR_DIST} is missing: npm run build`]),
    ...(checkOnly ? [] : mapsWithoutSources(DISTS.map(path => `${ROOT}${path}`)))
  ];
  problems.forEach(problem => console.error(`${dryRun ? 'Warning' : 'Error'}: ${problem}`));
  if (problems.length > 0 && !dryRun) {
    process.exit(1);
  }
  if (!checkOnly) {
    const onNpmAlready = sources
      .filter(manifest => isOnNpm(manifest.name, manifest.version))
      .map(manifest => manifest.name);
    onNpmAlready.forEach(name => console.log(`${name} is on npm already, skipped`));
    publishCommands(args, onNpmAlready)
      .forEach(npmArgs => execFileSync('npm', npmArgs, { cwd: ROOT, stdio: 'inherit' }));
  }
}
