import type { Config } from 'jest';

const config: Config = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/oidc'],
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\\.(html|svg)$' }
    ]
  },
  // The protocol needs no entry: Jest requires it, and it ships CommonJS for that
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)']
};

export default config;
