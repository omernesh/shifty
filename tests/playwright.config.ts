// tests/playwright.config.ts
// Playwright configuration for Shifty e2e tests.
// Phase 1: cross-tenant isolation, audit, auth-cookie, invite-flow tests.
// Phase 2: soldier-crud, roster-csv-import, tenant-isolation, org-unit-crud tests.
//
// Usage:
//   npm run test:e2e                          # default: localhost:8080
//   PLAYWRIGHT_BASE_URL=http://hpg5:8080 PG_TEST_URL=postgres://shifts:changeme@hpg5:5432/shifts npm run test:e2e

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Test directory: all specs under tests/e2e/
  testDir: './e2e',

  // Match all .spec.ts files
  testMatch: '**/*.spec.ts',

  // Don't run tests in parallel by default — seed-tenants creates isolated rows
  // but some specs share DB state within the describe block.
  workers: 1,

  // Retry on CI; no retry locally
  retries: process.env.CI ? 1 : 0,

  // Global timeout per test
  timeout: 60_000,

  use: {
    // Base URL for all request() calls and page.goto()
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',

    // Don't reuse browser context between tests — each test gets a fresh session
    storageState: undefined,

    // Extra HTTP headers that Playwright attaches by default
    extraHTTPHeaders: {},

    // Record traces on first retry
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Reporter: verbose in local dev, GitHub-annotated on CI
  reporter: process.env.CI
    ? [['github'], ['list']]
    : [['list']],
});
