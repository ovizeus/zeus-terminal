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
};
