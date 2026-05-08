module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  verbose: true,
  // [TEST-1] Auto-clear mock state between every test (clears `.mock.calls`,
  // `.mock.results`, `.mock.instances`). Replaces ad-hoc `clearAllMocks()` în
  // each `beforeEach` and prevents call/result bleed across tests inside same file.
  clearMocks: true,
};
