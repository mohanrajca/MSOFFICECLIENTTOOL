import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 20000,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node tests/e2e/static-server.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
  },
});
