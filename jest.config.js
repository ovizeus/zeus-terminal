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
  globalSetup: '<rootDir>/jest.globalSetup.js',
  globalTeardown: '<rootDir>/jest.globalTeardown.js',
};
