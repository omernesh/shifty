import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // sequence mode — tests share DB state
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',
  },
  projects: [
    {
      name: 'cross-tenant',
      testMatch: '**/cross-tenant-*.spec.ts',
    },
  ],
});
