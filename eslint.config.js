import eslint from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['.local/**', 'coverage/**', 'dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: globals.jest,
    },
  },
];
