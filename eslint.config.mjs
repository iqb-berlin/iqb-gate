import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

const RESTRICTED_IMPORTS = [
  {
    name: '@angular/platform-browser/animations',
    importNames: ['NoopAnimationsModule', 'BrowserAnimationsModule'],
    message: 'Deprecated here; component tests do without it.'
  },
  {
    name: '@angular/common/http/testing',
    importNames: ['HttpClientTestingModule'],
    message: 'Use provideHttpClient() and provideHttpClientTesting().'
  }
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      // The rules of studio-lite's rules.md that a linter can check (iqb-gate's rules.md)
      '@stylistic/max-len': ['error', { code: 120 }],
      '@stylistic/function-call-argument-newline': ['error', 'consistent'],
      'no-restricted-imports': ['error', { paths: RESTRICTED_IMPORTS }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'ForStatement', message: 'Use an array method instead of a loop.' },
        { selector: 'ForInStatement', message: 'Use an array method instead of a loop.' },
        { selector: 'ForOfStatement', message: 'Use an array method instead of a loop.' },
        { selector: 'WhileStatement', message: 'Use an array method instead of a loop.' },
        { selector: 'DoWhileStatement', message: 'Use an array method instead of a loop.' }
      ]
    }
  },
  {
    // A method that needs nothing of its class answers another question (rules.md: Responsibility)
    files: ['packages/*/src/**/*.ts', 'packages/angular/oidc/src/**/*.ts'],
    rules: { 'class-methods-use-this': 'error' }
  },
  {
    // The OIDC client is an optional peer: only the entry point @iqb/gate-angular/oidc may need it,
    // directly or through that entry point. A later block replaces the rule's options, so the paths
    // above are repeated. The build is checked as well (packages/angular/test/dist-smoke.cjs).
    files: ['packages/angular/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: RESTRICTED_IMPORTS,
        patterns: [{
          regex: '^angular-auth-oidc-client(/|$)|^@iqb/gate-angular/oidc(/|$)|(^|/)oidc/src(/|$)',
          message: 'Only in packages/angular/oidc: the main entry point must not need the optional peer.'
        }]
      }]
    }
  },
  {
    // Scripts that run as CommonJS on purpose -- the dist smoke test of @iqb/gate-nest
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly', fetch: 'readonly'
      }
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    // The release scripts of the root: version:set, publish:npm
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } }
  }
);
