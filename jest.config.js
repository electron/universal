/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  globalSetup: './jest.setup.ts',
  testTimeout: 10000,
};
