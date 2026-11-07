module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/unit/**/*.test.ts',
    '**/tests/e2e/**/*.test.js',
    '**/tests/integration/**/*.test.js',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  verbose: true,
  clearMocks: true,
  // [2026-11-07] The suite runs against a throwaway database. Before this, any
  // test that required services/database opened the PRODUCTION file and ran
  // its migrations on load. See jest.globalSetup.js.
  // [2026-11-07] Records failed test names to data/logs/jest-failures.log.
  // An intermittent failure that nobody can name is one nobody can fix, and
  // "just run it again" is how a real bug hides behind the word flaky.
  reporters: ['default', '<rootDir>/tests/flakeReporter.js'],
  // [2026-11-07] Clears shared module state between tests — see the file.
  setupFilesAfterEnv: ['<rootDir>/jest.setupAfterEnv.js'],
  globalSetup: '<rootDir>/jest.globalSetup.js',
  globalTeardown: '<rootDir>/jest.globalTeardown.js',
};
