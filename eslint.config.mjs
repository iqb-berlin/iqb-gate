import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'max-len': ['error', { code: 120 }],
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
  }
,
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
  }
);
