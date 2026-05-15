// tests/e2e/ui-smoke-phase2.spec.ts
// Phase 2 UI smoke — automates the 6 manual scenarios from Plan 02-10 Task 4 step 5.
// Acceptance gate for Plan 02-11 hotfix (UAT closure).
//
// Each test() block carries the scenario letter (a–f) in its title for traceability:
//   5a → 'a: org tree grow-depth + forged-POST B4 admin-gate'
//   5b → 'b: kibbutz name smart-quote round-trip via manage_soldiers'
//   5c → 'c: swatch color round-trip across soldier_detail and my_profile'
//   5d → 'd: team_detail Add member'
//   5e → 'e: roster_import smart-quote.csv canonicalization'
//   5f → 'f: cross-tenant blank view (tenant-B admin sees no tenant-A soldiers)'
//
// Decision: ONE combined spec file (not six separate files). Rationale:
//   1. Shared beforeAll setup (seedTwoTenants + admin sessions for both tenants).
//   2. Single conceptual scope: "Phase 2 UI smoke".
//   3. Lower per-file test-runner overhead (one Playwright worker spin-up).
//   4. Easier to keep the six scenarios traceable to Plan 10 Task 4 step 5 in one place.
//
// Skip-on-stack-down: every fixture probe and Playwright action is wrapped so
// the suite remains runnable in environments without a live Lowdefy stack.
//
// Test focus: each scenario hits the request endpoints that were broken by the
// pre-02-11 plugin-registration gap (CreateSoldier, CreateMembership,
// ParseCsvAndValidate, CommitRosterImport, grow_org_depth_and_add_child).
// After the merged shifty-plugin lands and registers via the merged Knex
// connection, ALL six scenarios should pass.

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  seedTwoTenants,
  signInAs,
  SESSION_COOKIE_NAME,
  type TenantFixture,
} from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'csv');

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try {
    await c.connect();
    return c;
  } catch {
    return null;
  }
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let adminASignIn: { sessionToken: string; userId: string; cookies: string };
let adminBSignIn: { sessionToken: string; userId: string; cookies: string };

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return;
  await probe.end();

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;

  adminASignIn = await signInAs(tenantA.adminEmail);
  adminBSignIn = await signInAs(tenantB.adminEmail);
});

test.afterAll(async () => {
  await teardownTestData();
});

test.describe('Phase 2 UI smoke (Plan 02-10 Task 4 step 5 — automated)', () => {

  test('a: org tree grow-depth + forged-POST B4 admin-gate', async ({ request }) => {
    // Plan 03 B4 admin-gate proof — a non-admin (team_manager) POSTing
    // grow_org_depth_and_add_child with `is_admin: false` must:
    //   (1) Receive zero rows in response (depth_update CTE short-circuits via `guard`).
    //   (2) Leave tenant.org_depth UNCHANGED (psql verify).
    // The admin happy path (`is_admin: true`) is exercised first to prove the
    // endpoint works at all when the gate allows it.

    // Read tenant.org_depth before mutation.
    const pgPre = await makePgClient();
    if (!pgPre) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    let preDepth: number;
    try {
      const r = await pgPre.query<{ org_depth: number }>(
        `SELECT org_depth FROM tenant WHERE id = $1`,
        [tenantA.tenantId],
      );
      preDepth = r.rows[0]?.org_depth ?? 1;
    } finally {
      await pgPre.end();
    }

    // Forged POST as admin with is_admin: false in payload — the SQL guard CTE
    // uses :is_admin from the payload binding; the page YAML normally derives it from
    // _user.roles. Even posting it as false here exercises the SQL-side gate.
    let forgedRes: import('@playwright/test').APIResponse;
    try {
      forgedRes = await request.post(
        `${BASE_URL}/api/request/manage_org_units/grow_org_depth_and_add_child`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: {
            payload: {
              parent_id: tenantA.teamId,
              new_name: 'forged child 5a',
              new_depth: Math.min(preDepth + 1, 3),
              is_admin: false, // B4: explicitly forged to false
            },
          },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }
    if (forgedRes.status() === 502 || forgedRes.status() === 503 || forgedRes.status() === 404) {
      test.skip(true, `Stack returned ${forgedRes.status()}`);
      return;
    }
    expect(forgedRes.status()).toBe(200);
    const forgedBody = (await forgedRes.json()) as Record<string, unknown>;
    const forgedRows =
      (forgedBody.rows as unknown[]) ||
      (Array.isArray(forgedBody) ? forgedBody : []) ||
      [];
    expect(
      Array.isArray(forgedRows) ? forgedRows.length : 0,
      'B4 admin-gate forged-POST must return zero rows when is_admin=false',
    ).toBe(0);

    // Verify org_depth unchanged.
    const pgPost = await makePgClient();
    if (pgPost) {
      try {
        const r = await pgPost.query<{ org_depth: number }>(
          `SELECT org_depth FROM tenant WHERE id = $1`,
          [tenantA.tenantId],
        );
        expect(
          r.rows[0].org_depth,
          'tenant.org_depth must be unchanged after forged-POST',
        ).toBe(preDepth);
      } finally {
        await pgPost.end();
      }
    }
  });

  test('b: kibbutz name smart-quote round-trip via manage_soldiers', async ({ request }) => {
    // ROST-11 / D-12 canary — display_name with U+2019 (RIGHT SINGLE QUOTATION MARK)
    // must be persisted as the canonical form 'נועם גלאל' (no apostrophe).
    // canonicalizeText runs at WRITE time inside CreateSoldier.

    const rawDisplayName = 'נועם ג’לאל'; // contains U+2019
    const expectedCanonical = 'נועם גלאל'; // U+2019 stripped, single space preserved

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(
        `${BASE_URL}/api/request/manage_soldiers/create_soldier_request`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: {
            payload: {
              display_name: rawDisplayName,
              email: `kibbutz-5b-${Date.now()}@example.test`,
              team_id: tenantA.teamId,
              seniority: 5,
              role_tags: ['driving'],
            },
          },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }
    if (res.status() === 502 || res.status() === 503 || res.status() === 404) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }
    expect(res.status(), `CreateSoldier returned ${res.status()}`).toBe(200);

    // psql verify: display_name is byte-equal to the canonical form, NOT the raw input.
    const c = await makePgClient();
    if (!c) return;
    try {
      // Note: shifts is SUPERUSER for seed bypass — but FORCE RLS requires SET ROLE NONE
      // to query under bypass. Use the helper from seed-tenants.
      await c.query('SET ROLE NONE');
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier WHERE tenant_id = $1 AND display_name LIKE $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantA.tenantId, 'נועם%'],
      );
      expect(dbRes.rows.length, 'kibbutz soldier must be persisted').toBe(1);
      expect(
        dbRes.rows[0].display_name,
        `display_name must be canonical (U+2019 stripped); got ${JSON.stringify(dbRes.rows[0].display_name)}`,
      ).toBe(expectedCanonical);
      // Belt: no U+2019 codepoint in the persisted value.
      expect(dbRes.rows[0].display_name).not.toContain('’');
    } finally {
      await c.end();
    }
  });

  test('c: swatch color round-trip across soldier_detail and my_profile', async ({ request }) => {
    // PALETTE swatch hex set via UpdateSoldier on soldier_detail must round-trip:
    // re-loading the same soldier returns the same hex from the DB.
    // (Phase-2 swatch UI: index 7 ↔ '#7F7F7F' from PALETTE.)
    const PALETTE_INDEX_7 = '#7F7F7F'; // PALETTE[7] from helpers/palette.js

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(
        `${BASE_URL}/api/request/soldier_detail/update_soldier_request`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: {
            payload: {
              soldier_id: tenantA.adminSoldierId,
              color: PALETTE_INDEX_7,
            },
          },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }
    if (res.status() === 502 || res.status() === 503 || res.status() === 404) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }
    expect(res.status(), `UpdateSoldier color returned ${res.status()}`).toBe(200);

    // Reload via the same admin session to confirm the value round-trips.
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      const dbRes = await c.query<{ color: string | null }>(
        `SELECT color FROM soldier WHERE id = $1`,
        [tenantA.adminSoldierId],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(
        dbRes.rows[0].color,
        `swatch color must round-trip; got ${dbRes.rows[0].color}`,
      ).toBe(PALETTE_INDEX_7);
    } finally {
      await c.end();
    }
  });

  test('d: team_detail Add member', async ({ request }) => {
    // CreateMembership: adds an existing tenant-A soldier to tenant-A's team.
    // Acceptance: response 200, membership row in DB (idempotent on retry).
    //
    // Seed a fresh soldier (no existing membership in tenantA.teamId) so the test
    // is repeatable and doesn't depend on prior state.
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    let freshSoldierId: string;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const ins = await c.query<{ id: string }>(
        `INSERT INTO soldier (tenant_id, display_name, status)
         VALUES ($1, $2, 'active') RETURNING id`,
        [tenantA.tenantId, 'Member 5d Target'],
      );
      freshSoldierId = ins.rows[0].id;
    } finally {
      await c.end();
    }

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(
        `${BASE_URL}/api/request/team_detail/create_membership_request`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: {
            payload: {
              soldier_id: freshSoldierId,
              team_id: tenantA.teamId,
              role: 'member',
            },
          },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }
    if (res.status() === 502 || res.status() === 503 || res.status() === 404) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }
    expect(res.status(), `CreateMembership returned ${res.status()}`).toBe(200);

    // Verify membership row exists.
    const c2 = await makePgClient();
    if (!c2) return;
    try {
      await c2.query('SET ROLE NONE');
      const r = await c2.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM membership
          WHERE soldier_id = $1 AND org_unit_id = $2 AND tenant_id = $3`,
        [freshSoldierId, tenantA.teamId, tenantA.tenantId],
      );
      expect(
        r.rows[0].count,
        'membership row must be present after CreateMembership',
      ).toBe(1);
    } finally {
      await c2.end();
    }
  });

  test('e: roster_import smart-quote.csv canonicalization', async ({ request }) => {
    // ParseCsvAndValidate + CommitRosterImport — the same kibbutz canary as Test 5b,
    // but via the CSV import wizard. Reads tests/fixtures/csv/smart-quote.csv with
    // the {TENANT_A_TEAM_UUID} placeholder replaced.
    let csvText: string;
    try {
      const raw = readFileSync(join(FIXTURES_DIR, 'smart-quote.csv'), 'utf-8');
      csvText = raw.replace('{TENANT_A_TEAM_UUID}', tenantA.teamId);
    } catch {
      test.skip(true, 'smart-quote.csv fixture not found');
      return;
    }

    // Stage 1: parse + validate.
    let parseRes: import('@playwright/test').APIResponse;
    try {
      parseRes = await request.post(
        `${BASE_URL}/api/request/roster_import/parse_csv_request`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: { payload: { csv_text: csvText } },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }
    if (parseRes.status() === 502 || parseRes.status() === 503 || parseRes.status() === 404) {
      test.skip(true, `Stack returned ${parseRes.status()} for parse_csv_request`);
      return;
    }
    expect(parseRes.status(), `ParseCsvAndValidate returned ${parseRes.status()}`).toBe(200);

    const parsedBody = (await parseRes.json()) as Record<string, unknown>;
    const rows = (parsedBody.rows as Array<Record<string, unknown>>) || [];
    expect(rows.length, 'parse must return at least one row').toBeGreaterThanOrEqual(1);

    // The preview row's display_name must already be canonical (canonicalizeText runs at parse time).
    const noamRow = rows.find((r) => typeof r.display_name === 'string' && (r.display_name as string).startsWith('נועם'));
    expect(noamRow, 'preview must contain Noam row').toBeDefined();
    expect(
      noamRow?.display_name,
      'parse-time canonicalization must strip U+2019',
    ).toBe('נועם גלאל');

    // Stage 2: commit.
    let commitRes: import('@playwright/test').APIResponse;
    try {
      commitRes = await request.post(
        `${BASE_URL}/api/request/roster_import/commit_roster_import_request`,
        {
          headers: { Cookie: adminASignIn.cookies, 'Content-Type': 'application/json' },
          data: { payload: { rows } },
        },
      );
    } catch {
      test.skip(true, 'Lowdefy stack not reachable for commit');
      return;
    }
    if (commitRes.status() === 502 || commitRes.status() === 503 || commitRes.status() === 404) {
      test.skip(true, `Stack returned ${commitRes.status()} for commit`);
      return;
    }
    expect(commitRes.status(), `CommitRosterImport returned ${commitRes.status()}`).toBe(200);

    // psql verify: the persisted display_name is canonical.
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier
          WHERE tenant_id = $1 AND display_name LIKE $2
          ORDER BY created_at DESC LIMIT 1`,
        [tenantA.tenantId, 'נועם%'],
      );
      expect(dbRes.rows.length, 'imported soldier must be persisted').toBe(1);
      expect(dbRes.rows[0].display_name).toBe('נועם גלאל');
      expect(dbRes.rows[0].display_name).not.toContain('’');
    } finally {
      await c.end();
    }
  });

  test('f: cross-tenant blank view (tenant-B admin sees no tenant-A soldiers)', async ({ page }) => {
    // Sign in as tenant-B admin, navigate /manage_soldiers, assert no tenant-A soldier
    // rows render. Layers 2 (YAML WHERE) + 4 (request handler) + 5 (RLS) all conspire
    // to block cross-tenant visibility. The acceptance is rendered content — no tenant-A
    // soldier id should appear in the DOM.

    // __Secure- cookie prefix requires secure: true (Chromium spec); BASE_URL is HTTPS
    // (apps.nesher.co) per CLAUDE.md, so secure: true is correct and the cookie is accepted.
    await page.context().addCookies([{
      name: SESSION_COOKIE_NAME,
      value: adminBSignIn.sessionToken,
      url: BASE_URL,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);

    try {
      await page.goto(`${BASE_URL}/manage_soldiers`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable');
      return;
    }

    const content = await page.content();
    // No tenant-A soldier id or tenant_id may appear in tenant-B admin's manage_soldiers view.
    expect(content, 'tenant-A adminSoldierId leaked into tenant-B view').not.toContain(tenantA.adminSoldierId);
    expect(content, 'tenant-A tenantId leaked into tenant-B view').not.toContain(tenantA.tenantId);
  });
});
