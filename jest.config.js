export default {
  clearMocks: true,
  collectCoverageFrom: ['apps/**/*.js', 'packages/**/*.js', '!**/node_modules/**'],
  coverageDirectory: 'coverage',
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/'],
  restoreMocks: true,
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  transform: {},
};
