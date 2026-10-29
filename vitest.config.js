import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.js', '**/*.test.js'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
});
