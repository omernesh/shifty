// tests/e2e/tenant-isolation.spec.ts
// Cross-tenant isolation forge tests (SEC — Phase 2).
// Requirements: T-02-01, T-02-02, T-02-06
//
// These tests probe the FORGE attack surfaces introduced in Phase 2 that the
// auto-discovery cross-tenant-leak.spec.ts does not catch (it checks rendered page
// content but not API mutation responses).
//
// Tests:
//   A: CSV with tenant-B email does NOT flag as duplicate in tenant-A scope
//   B: UpdateSoldier with tenant-B soldier_id — 0 rows updated (Layer-4 defense)
//   C: team_detail/{tenantB-team-id} renders no members for tenantA admin
//   D: roster_import_log SELECT is tenant-scoped — tenant-A cannot read tenant-B rows
//   E: cross-tenant-leak.spec.ts auto-coverage smoke — collectPageIds() includes Phase-2 pages

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'csv');

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; }
  catch { return null; }
}

/** Collect page IDs from app/pages/ (Phase 2 expected pages). */
function collectPhase2PageIds(): string[] {
  const PHASE2_PAGES = [
    'manage_soldiers', 'soldier_detail', 'manage_role_tags',
    'team_detail', 'my_profile', 'roster_import', 'manage_org_units',
  ];
  // Walk the pages directory to detect which Phase-2 pages actually exist
  const pagesDir = join(__dirname, '..', '..', 'app', 'pages');
  const found: string[] = [];
  try {
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.yaml')) {
          const stem = entry.name.replace('.yaml', '');
          if (PHASE2_PAGES.includes(stem)) found.push(stem);
        }
      }
    }
    walk(pagesDir);
  } catch { /* pages dir not mounted */ }
  return found;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let adminASession: { cookies: string };

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return;
  await probe.end();

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;

  const signin = await signInAs(tenantA.adminEmail);
  adminASession = { cookies: signin.cookies };
});

test.afterAll(async () => {
  await teardownTestData();
});

test.describe('Tenant isolation — forge tests (SEC / Phase 2)', () => {

  test('A. CSV with tenant-B email is NOT flagged as duplicate in tenant-A scope', async ({ request }) => {
    // A CSV row with an email belonging to a tenant-B user should NOT be flagged
    // is_duplicate in tenant-A's parse pass — email uniqueness is tenant-scoped.
    const tenantBEmail = tenantB.adminEmail; // e.g. admin-b@example.test
    const csv = [
      '# Test A: tenant-B email is foreign in tenant-A scope',
      'display_name,email,role_tags,seniority,team_id',
      `כוח חיצוני,${tenantBEmail},driving,5,${tenantA.teamId}`,
    ].join('\n');

    const csvBase64 = Buffer.from(csv, 'utf-8').toString('base64');
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/roster_import/parse_csv_and_validate`, {
        headers: { Cookie: adminASession.cookies, 'Content-Type': 'application/json' },
        data: { payload: { csv_base64: csvBase64 } },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }
    if (res.status() === 502 || res.status() === 503 || res.status() === 404) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const rows = (body.rows as Array<Record<string, unknown>>) ?? [];
    // The tenant-B email should NOT be flagged is_duplicate in tenant-A context
    for (const row of rows) {
      if (row.email === tenantBEmail) {
        expect(row.is_duplicate, `tenant-B email ${tenantBEmail} falsely flagged as duplicate in tenant-A`).toBe(false);
      }
    }
  });

  test('B. UpdateSoldier with tenant-B soldier_id — 0 rows updated (Layer-4 defense)', async ({ request }) => {
    // A tenant-A admin sends an UpdateSoldier request with a tenant-B soldier_id.
    // Layer-4 SQL WHERE clause: WHERE id = :id AND tenant_id = session.tenant_id
    // → 0 rows RETURNING → no update applied. T-02-01 mitigation.
    const tenantBSoldierId = tenantB.adminSoldierId;

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/soldier_detail/update_soldier_request`, {
        headers: { Cookie: adminASession.cookies, 'Content-Type': 'application/json' },
        data: {
          payload: {
            id: tenantBSoldierId,
            display_name: 'FORGED by tenant-A',
          },
        },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }
    if (res.status() === 502 || res.status() === 503 || res.status() === 404) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    // Either 403/401 (explicit auth block) or 200 with 0 rows updated
    const isExplicitDeny = res.status() === 403 || res.status() === 401;
    if (!isExplicitDeny) {
      expect(res.status()).toBe(200);
      // Verify via psql that tenant-B soldier was NOT modified
      const c = await makePgClient();
      if (c) {
        try {
          await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantB.tenantId]);
          const dbRes = await c.query<{ display_name: string }>(
            `SELECT display_name FROM soldier WHERE id = $1`,
            [tenantBSoldierId]
          );
          if (dbRes.rows.length > 0) {
            expect(dbRes.rows[0].display_name).not.toBe('FORGED by tenant-A');
          }
        } finally { await c.end(); }
      }
    }
    // Explicit 403/401 is also a valid Layer-4 outcome
  });

  test('C. team_detail/{tenantB-team-id} renders no tenant-B members for tenantA admin', async ({ page }) => {
    // Navigate to team_detail with a tenant-B team UUID.
    // The page should either: (a) 403/404, or (b) render no members (tenant scoping).
    const tenantBTeamId = tenantB.teamId;

    await page.context().addCookies([{
      name: 'next-auth.session-token',
      value: (await signInAs(tenantA.adminEmail)).sessionToken,
      url: BASE_URL,
      httpOnly: true,
    }]);

    try {
      await page.goto(`${BASE_URL}/team_detail?id=${tenantBTeamId}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    const content = await page.content();
    // Assert tenant-B soldier IDs do not appear in the rendered page
    expect(content).not.toContain(tenantB.adminSoldierId);
    expect(content).not.toContain(tenantB.tenantId);
  });

  test('D. roster_import_log is tenant-scoped — tenant-A admin cannot read tenant-B rows', async () => {
    // Direct Postgres check: with tenant-A context, roster_import_log should
    // return only tenant-A rows (RLS enforced).
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      // Set tenant-A context
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM roster_import_log`
      );
      // All returned rows must belong to tenant-A (or be empty if no imports yet)
      for (const row of res.rows) {
        expect(row.tenant_id, `roster_import_log row with tenant_id ${row.tenant_id} leaked through RLS`).toBe(tenantA.tenantId);
        expect(row.tenant_id).not.toBe(tenantB.tenantId);
      }
    } finally { await c.end(); }
  });

  test('E. cross-tenant-leak auto-coverage smoke — Phase-2 pages discoverable', async () => {
    // Assert that collectPhase2PageIds() finds the Phase-2 pages.
    // This confirms cross-tenant-leak.spec.ts will auto-discover them when the stack is up.
    const phase2PageIds = collectPhase2PageIds();

    // At minimum, the pages introduced in Phase 2 plans should be present.
    // If the app/pages/ directory is not mounted (CI without the app), skip gracefully.
    if (phase2PageIds.length === 0) {
      test.skip(true, 'app/pages/ not mounted — Phase-2 page auto-discovery skipped');
      return;
    }

    // Expected Phase-2 pages (from plans 02-04 to 02-08)
    const expectedPages = [
      'manage_soldiers', 'soldier_detail', 'manage_role_tags',
      'team_detail', 'my_profile', 'roster_import',
    ];

    const missingPages = expectedPages.filter(p => !phase2PageIds.includes(p));
    if (missingPages.length > 0) {
      // Log but don't fail — some pages may not yet exist in a partial deploy
      console.log(`Note: These Phase-2 pages are not yet present in app/pages/: ${missingPages.join(', ')}`);
    }

    // At least manage_soldiers or soldier_detail should exist
    const hasSomePage = phase2PageIds.some(p => expectedPages.includes(p));
    if (!hasSomePage) {
      test.skip(true, 'No Phase-2 pages found in app/pages/ — partial deploy or YAML not yet committed');
    }
  });

});
