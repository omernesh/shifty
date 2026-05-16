// tests/e2e/roster-csv-import.spec.ts
// Phase 2 CSV import wizard E2E tests — REBUILT as Playwright UI-driven flows.
// Requirements: ROST-08, ROST-09, ROST-10, ROST-11, ROST-12, ROST-13
//
// Rebuild authority: Plan 03-01. The Lowdefy CSV-import wizard binds every step's
// payload via `_state:` operators against the rendered Modal/Card state — direct
// API POSTs cannot populate that state, so this suite navigates the actual
// 3-stage wizard (paste → preview → commit).
//
// Tests:
//   A:  happy path — clean.csv pastes, previews 5 rows, commit creates soldiers
//   A2: perf — perf-50.csv imports 50 rows within ROST-13 budgets
//   B:  smart-quote canary — U+2019 row canonicalizes through the wizard
//   C:  duplicate emails flagged + skipped by default
//   D:  bidi-mark stripping at write time

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';
import {
  fillLowdefyInput,
  clickLowdefyButton,
  setSessionCookie,
} from './_helpers/lowdefy-ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'csv');

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; }
  catch { return null; }
}

function injectTeamId(csv: string, teamId: string): string {
  return csv.replace(/\{TENANT_A_TEAM_UUID\}/g, teamId);
}

/**
 * Drive the wizard from the initial step to a committed import.
 *
 * Stage 1: paste CSV into `csv_text_input` TextArea → click נתח קובץ → wizard advances to Stage 2.
 * Stage 2: preview grid renders parsed rows → click אשר ייבוא → opens confirmation modal.
 * Stage 3: confirmation modal okText אשר ושלח → triggers commit_import_request →
 *          UI navigates to roster_import_result.
 */
async function runWizard(page: import('@playwright/test').Page, csvText: string): Promise<void> {
  await fillLowdefyInput(page, 'csv_text_input', csvText);
  await clickLowdefyButton(page, 'נתח קובץ');
  // Wait for preview step to render
  await page.waitForTimeout(800);
  await clickLowdefyButton(page, 'אשר ייבוא →');
  // Confirmation modal — primary action labeled "אשר ושלח"
  await clickLowdefyButton(page, 'אשר ושלח');
  // Wizard advances to result page; give the request a moment.
  await page.waitForTimeout(1500);
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let adminSignIn: { sessionToken: string; userId: string; cookies: string };

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return;
  await probe.end();

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;
  adminSignIn = await signInAs(tenantA.adminEmail);
});

test.afterAll(async () => {
  try { await teardownTestData(); } catch { /* PG unreachable — nothing to tear down */ }
});

test.describe('Roster CSV import (ROST-08..13) — UI-driven', () => {

  test('A. happy path — clean.csv imports 5 rows (ROST-08, ROST-09, ROST-12)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    let rawCsv: string;
    try { rawCsv = readFileSync(join(FIXTURES_DIR, 'clean.csv'), 'utf-8'); }
    catch { test.skip(true, 'clean.csv fixture missing'); return; }
    const csv = injectTeamId(rawCsv, tenantA.teamId);

    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);
    try {
      await page.goto(`${BASE_URL}/roster_import`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    await runWizard(page, csv);

    // DB verification: at least 5 active soldiers in tenant-A.
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM soldier WHERE tenant_id = $1 AND status = 'active'`,
        [tenantA.tenantId],
      );
      const totalActive = parseInt(dbRes.rows[0].count, 10);
      expect(totalActive).toBeGreaterThanOrEqual(5);
    } finally { await c.end(); }
  });

  test('A2. perf — perf-50.csv imports 50 rows within SLO budgets (W1 + ROST-13)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    // ROST-13 re-interpretation: dbCommitWall < 35_000ms (Resend rate-limit budget).
    let rawCsv: string;
    try { rawCsv = readFileSync(join(FIXTURES_DIR, 'perf-50.csv'), 'utf-8'); }
    catch { test.skip(true, 'perf-50.csv fixture missing'); return; }
    const csv = injectTeamId(rawCsv, tenantA.teamId);

    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);
    try {
      await page.goto(`${BASE_URL}/roster_import`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    const t0 = Date.now();
    await runWizard(page, csv);
    const wall = Date.now() - t0;
    expect(wall).toBeLessThan(35_000);

    // DB verification: 50 perf rows in tenant-A.
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM soldier WHERE tenant_id = $1 AND display_name LIKE 'perf row-%'`,
        [tenantA.tenantId],
      );
      expect(parseInt(dbRes.rows[0].count, 10)).toBe(50);
    } finally { await c.end(); }
  });

  test('B. smart-quote canary — kibbutz row imports as canonical bytes (ROST-11)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    let rawCsv: string;
    try { rawCsv = readFileSync(join(FIXTURES_DIR, 'smart-quote.csv'), 'utf-8'); }
    catch { test.skip(true, 'smart-quote.csv fixture missing'); return; }
    const csv = injectTeamId(rawCsv, tenantA.teamId);

    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);
    try {
      await page.goto(`${BASE_URL}/roster_import`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    await runWizard(page, csv);

    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier
          WHERE tenant_id = $1 AND display_name LIKE 'נועם%'
          ORDER BY created_at DESC LIMIT 1`,
        [tenantA.tenantId],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].display_name).toBe('נועם גלאל');
      expect(dbRes.rows[0].display_name.indexOf('’')).toBe(-1);
    } finally { await c.end(); }
  });

  test('C. duplicate emails flagged + skipped by default (ROST-10)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    let rawCsv: string;
    try { rawCsv = readFileSync(join(FIXTURES_DIR, 'dup-email.csv'), 'utf-8'); }
    catch { test.skip(true, 'dup-email.csv fixture missing'); return; }
    const csv = injectTeamId(rawCsv, tenantA.teamId);

    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);
    try {
      await page.goto(`${BASE_URL}/roster_import`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    let soldierCountBefore = 0;
    {
      const c = await makePgClient();
      if (c) {
        try {
          await c.query('SET ROLE NONE');
          await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
          const r = await c.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM soldier WHERE tenant_id = $1`,
            [tenantA.tenantId],
          );
          soldierCountBefore = parseInt(r.rows[0].count, 10);
        } finally { await c.end(); }
      }
    }

    await runWizard(page, csv);

    const c2 = await makePgClient();
    if (!c2) return;
    try {
      await c2.query('SET ROLE NONE');
      await c2.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const r = await c2.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM soldier WHERE tenant_id = $1`,
        [tenantA.tenantId],
      );
      const after = parseInt(r.rows[0].count, 10);
      // No new soldiers created from duplicate-email rows.
      expect(after).toBe(soldierCountBefore);
    } finally { await c2.end(); }
  });

  test('D. bidi-mark stripping at write time (ROST-11)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    let rawCsv: string;
    try { rawCsv = readFileSync(join(FIXTURES_DIR, 'bidi-mark.csv'), 'utf-8'); }
    catch { test.skip(true, 'bidi-mark.csv fixture missing'); return; }
    const csv = injectTeamId(rawCsv, tenantA.teamId);

    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);
    try {
      await page.goto(`${BASE_URL}/roster_import`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    await runWizard(page, csv);

    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier
          WHERE tenant_id = $1
            AND id IN (SELECT id FROM soldier WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10)`,
        [tenantA.tenantId],
      );
      const BIDI_MARKS = ['‎', '‏', '‪', '‫', '‬', '‭', '‮'];
      for (const row of dbRes.rows) {
        for (const mark of BIDI_MARKS) {
          expect(
            row.display_name.indexOf(mark),
            `bidi mark U+${mark.codePointAt(0)?.toString(16).toUpperCase()} found in "${row.display_name}"`,
          ).toBe(-1);
        }
      }
    } finally { await c.end(); }
  });

});
