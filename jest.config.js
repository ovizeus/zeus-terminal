module.exports = {
  testEnvironment: 'node',
  // [M1.1 Cat D 2026-05-14] Expanded to include tests/e2e/ pentru route + recon
  // flow tests. Cat A/B/C live în tests/unit/; Cat D uses supertest pentru HTTP
  // layer testing. Both folders picked up by jest în same run.
  testMatch: ['**/tests/unit/**/*.test.js', '**/tests/e2e/**/*.test.js'],
  verbose: true,
  // [TEST-1] Auto-clear mock state between every test (clears `.mock.calls`,
  // `.mock.results`, `.mock.instances`). Replaces ad-hoc `clearAllMocks()` în
  // each `beforeEach` and prevents call/result bleed across tests inside same file.
  clearMocks: true,
};
