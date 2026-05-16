// tests/e2e/tenant-isolation.spec.ts
// Phase 2 cross-tenant isolation — REBUILT as Playwright UI-driven flows.
// Requirements: T-02-01, T-02-02, T-02-06
//
// Rebuild authority: Plan 03-01. These tests probe FORGE attack surfaces — the
// rebuild swaps direct-API POSTs for UI navigation, asserting that the rendered
// pages refuse to surface cross-tenant data (Layers 1-5 defense in depth).
//
// Tests:
//   A: tenant-A admin navigating /manage_soldiers sees only tenant-A rows
//   B: tenant-A admin clicking a forged /soldier_detail?id=<tenantB_id> URL
//      surfaces no tenant-B identifiers (Layer 2 WHERE + Layer 5 RLS).

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';
import { setSessionCookie } from './_helpers/lowdefy-ui.js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; }
  catch { return null; }
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let adminASignIn: { sessionToken: string; userId: string; cookies: string };

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return;
  await probe.end();

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;
  adminASignIn = await signInAs(tenantA.adminEmail);
});

test.afterAll(async () => {
  await teardownTestData();
});

test.describe('Tenant isolation — UI-driven forge tests (SEC / Phase 2)', () => {

  test('A. tenant-A admin sees only tenant-A rows on /manage_soldiers', async ({ page }) => {
    await setSessionCookie(page.context(), adminASignIn.sessionToken, BASE_URL);

    try {
      await page.goto(`${BASE_URL}/manage_soldiers`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    const content = await page.content();
    // No tenant-B soldier ids or tenant_id may appear in tenant-A's view.
    expect(
      content,
      `tenant-B adminSoldierId (${tenantB.adminSoldierId}) leaked into tenant-A view`,
    ).not.toContain(tenantB.adminSoldierId);
    expect(
      content,
      `tenant-B tenantId (${tenantB.tenantId}) leaked into tenant-A view`,
    ).not.toContain(tenantB.tenantId);
  });

  test('B. forged /soldier_detail?id=<tenantB_id> renders no tenant-B identifiers', async ({ page }) => {
    await setSessionCookie(page.context(), adminASignIn.sessionToken, BASE_URL);

    const forgedSoldierId = tenantB.adminSoldierId;

    try {
      await page.goto(`${BASE_URL}/soldier_detail?id=${forgedSoldierId}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    const content = await page.content();
    // Layer 2 (YAML WHERE tenant_id) + Layer 5 (RLS) must block surfacing tenant-B data.
    // The `id` param is in the URL but the rendered page must not include the soldier's
    // tenant_id or display_name from tenant B.
    expect(
      content,
      `tenant-B tenantId leaked into forged soldier_detail view`,
    ).not.toContain(tenantB.tenantId);
    expect(
      content,
      `tenant-B admin display_name leaked into forged soldier_detail view`,
    ).not.toContain('Admin B Soldier');
  });

});
