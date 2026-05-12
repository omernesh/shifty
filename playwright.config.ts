import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // sequence mode — tests share DB state
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',
  },
  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.spec.ts',
    },
  ],
});
