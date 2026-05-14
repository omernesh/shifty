// tests/e2e/cross-tenant-leak.spec.ts
// SEC-06: Cross-tenant isolation pen-test.
// Signs in as tenant-A admin; auto-discovers pages from app/pages/**/*.yaml;
// for each page navigates with tenant-A session and asserts no tenant-B IDs leak.
// Also directly probes Postgres to confirm RLS isolation.

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { seedTwoTenants, signInAs, getTenantBIds, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';

/** Discover all page IDs from app/pages by looking for id + type containing 'Page' */
function collectPageIds(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.yaml')) {
        const content = readFileSync(full, 'utf-8');
        try {
          const doc = YAML.parse(content) as Record<string, unknown> | null;
          if (doc && typeof doc.id === 'string' && typeof doc.type === 'string' && /Page/.test(doc.type)) {
            out.push(doc.id);
          }
        } catch {
          // skip non-parseable YAMLs
        }
      }
    }
  }
  walk('app/pages');
  return out;
}

test.describe('Cross-tenant isolation (SEC-06)', () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let tenantBIds: ReturnType<typeof getTenantBIds>;
  let adminASessionToken: string;

  test.beforeAll(async () => {
    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
    tenantB = seeded.tenantB;
    tenantBIds = getTenantBIds(tenantB);
    const signin = await signInAs(tenantA.adminEmail);
    adminASessionToken = signin.sessionToken;
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  const pageIds = collectPageIds();

  for (const pageId of pageIds) {
    test(`page /${pageId} does not leak tenant-B data when signed in as tenant-A`, async ({ page }) => {
      // Set cookie before navigation
      await page.context().addCookies([{
        name: '__Secure-next-auth.session-token',
        value: adminASessionToken,
        url: BASE_URL,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }]);

      try {
        await page.goto(`${BASE_URL}/${pageId}`, { waitUntil: 'networkidle', timeout: 15_000 });
      } catch {
        // If the page is not reachable (e.g., stack not running), skip gracefully
        test.skip(true, 'Lowdefy stack not reachable — run with stack up');
        return;
      }

      const content = await page.content();

      // Assert no tenant-B identifiers leaked into the rendered page
      for (const id of [
        ...tenantBIds.soldiers,
        ...tenantBIds.orgUnits,
        ...tenantBIds.invites,
        tenantBIds.tenantId,
      ]) {
        expect(content, `Tenant-B ID ${id} found on page /${pageId}`).not.toContain(id);
      }
    });
  }

  test('direct Postgres SELECT soldier with app.current_tenant=A returns only A rows', async () => {
    const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';
    const client = new Client({ connectionString: PG_URL });

    let connected = false;
    try {
      await client.connect();
      connected = true;
    } catch {
      test.skip(true, 'Postgres not reachable at PG_TEST_URL — run with compose stack up');
      return;
    }

    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await client.query<{ id: string; tenant_id: string }>(`SELECT id, tenant_id FROM soldier`);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      for (const row of res.rows) {
        expect(row.tenant_id, `Soldier ${row.id} belongs to wrong tenant`).toBe(tenantA.tenantId);
        expect(tenantBIds.soldiers, `Tenant-B soldier ${row.id} leaked through RLS`).not.toContain(row.id);
      }
    } finally {
      await client.end();
    }
  });
});
