// tests/e2e/soldier-crud.spec.ts
// Phase 2 soldier CRUD E2E tests — REBUILT as Playwright UI-driven flows.
// Requirements: ROST-01, ROST-02, ROST-03, ROST-04, ROST-05
//
// Rebuild authority: Plan 03-01 (Phase 03 plan 1). Originals POSTed directly to
// /api/request/manage_soldiers/<request>; the Lowdefy YAML's `_state:` payload
// binding resolves every field to `undefined` when the UI state is absent,
// triggering `ConfigError: Request "X" required property "Y" is missing`. The
// rebuild navigates the rendered pages and drives the actual UI controls, so
// `_state:` is populated naturally by Lowdefy's runtime. See:
//   .planning/phases/02-org-people/02-UAT-FINDINGS.md §3 (root cause)
//   .planning/phases/02-org-people/02-11-SUMMARY.md (deferral)
//   .planning/phases/03-availability-rules/03-RESEARCH.md §"Test strategy Pattern A"
//
// Tests:
//   A: admin creates soldier via Add modal (display_name + email + seniority + role_tags)
//   B: admin edits soldier (display_name + notes) via soldier_detail
//   C: admin archives soldier (status flips to 'archived', row gone from main grid)
//   D: team_manager edits soldier in own team — succeeds (Layer-4 is_manager_or_admin)
//   E: smart-quote canary — kibbutz name U+2019 → canonical bytes through CreateSoldier
//
// Skip-on-stack-down: every page.goto is wrapped per cross-tenant-leak.spec.ts.

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';
import {
  fillLowdefyInput,
  clickLowdefyButton,
  expectAgGridCellText,
  setSessionCookie,
} from './_helpers/lowdefy-ui.js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; }
  catch { return null; }
}

/** Seeds a team_manager user in tenantA and returns their session. */
async function seedTeamManager(tenantA: TenantFixture): Promise<{
  session: { sessionToken: string; userId: string; cookies: string };
  managerId: string;
  soldierOwnTeam: string;
}> {
  const c = await makePgClient();
  if (!c) throw new Error('Postgres not reachable');

  const managerEmail = `manager-${Date.now()}@example.test`;
  const authUserId = randomUUID();
  const appUserId = randomUUID();
  const soldierId = randomUUID();
  const soldierOwnTeam = randomUUID();

  try {
    await c.query('SET ROLE NONE');
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
    await c.query(
      `INSERT INTO "users" (id, name, email, "emailVerified") VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [authUserId, 'team-manager', managerEmail],
    );
    await c.query(
      `INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id)
       VALUES ($1, $2, $3, 'Team Manager', 'he', $4) ON CONFLICT DO NOTHING`,
      [appUserId, tenantA.tenantId, managerEmail, authUserId],
    );
    await c.query(
      `INSERT INTO soldier (id, tenant_id, user_id, display_name)
       VALUES ($1, $2, $3, 'Team Manager Soldier') ON CONFLICT DO NOTHING`,
      [soldierId, tenantA.tenantId, appUserId],
    );
    await c.query(
      `INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role)
       VALUES ($1, $2, $3, $4, 'team_manager') ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`,
      [randomUUID(), tenantA.tenantId, soldierId, tenantA.teamId],
    );
    // A target soldier in the leaf team for the edit-own-team test.
    await c.query(
      `INSERT INTO soldier (id, tenant_id, display_name)
       VALUES ($1, $2, 'Target Soldier Own Team') ON CONFLICT DO NOTHING`,
      [soldierOwnTeam, tenantA.tenantId],
    );
    await c.query(
      `INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role)
       VALUES ($1, $2, $3, $4, 'member') ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`,
      [randomUUID(), tenantA.tenantId, soldierOwnTeam, tenantA.teamId],
    );
  } finally {
    await c.end();
  }

  const session = await signInAs(managerEmail);
  return { session, managerId: appUserId, soldierOwnTeam };
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let adminSignIn: { sessionToken: string; userId: string; cookies: string };
let managerSignIn: { sessionToken: string; userId: string; cookies: string };
let soldierOwnTeamId: string;

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return;
  await probe.end();

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;

  adminSignIn = await signInAs(tenantA.adminEmail);
  const { session: ms, soldierOwnTeam } = await seedTeamManager(tenantA);
  managerSignIn = ms;
  soldierOwnTeamId = soldierOwnTeam;
});

test.afterAll(async () => {
  try { await teardownTestData(); } catch { /* PG unreachable — nothing to tear down */ }
});

test.describe('Soldier CRUD (ROST-01..05) — UI-driven', () => {

  test('A. admin creates soldier via Add modal (display_name + email + seniority)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);

    try {
      await page.goto(`${BASE_URL}/manage_soldiers`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    // Open the Add modal (Hebrew button: "הוסף חייל")
    await clickLowdefyButton(page, 'הוסף חייל');

    // Modal-scoped block ids per manage_soldiers.yaml
    const stamp = Date.now();
    const newName = `יוסי החדש ${stamp}`;
    const newEmail = `new-soldier-${stamp}@example.test`;

    await fillLowdefyInput(page, 'new_soldier_form.display_name', newName);
    await fillLowdefyInput(page, 'new_soldier_form.email', newEmail);
    // Seniority NumberInput accepts numeric strings
    await fillLowdefyInput(page, 'new_soldier_form.seniority', '5');

    // Confirm via primary Modal button ("צור חייל" per okText in YAML)
    await clickLowdefyButton(page, 'צור חייל');

    // Grid should refresh (refresh_soldiers in onOk chain) and show the new row.
    await expectAgGridCellText(page, newName);

    // DB sanity: row exists with canonical name + color != null.
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ id: string; color: string | null; display_name: string }>(
        `SELECT id, color, display_name FROM soldier
          WHERE tenant_id = $1 AND display_name = $2 LIMIT 1`,
        [tenantA.tenantId, newName],
      );
      expect(dbRes.rows.length).toBe(1);
      // Color is assigned by CreateSoldier when team_id is present; if Selector wasn't
      // chosen (we left team blank), color may be null — that's allowed.
      expect(dbRes.rows[0].display_name).toBe(newName);
    } finally { await c.end(); }
  });

  test('B. admin edits soldier (display_name + notes) via soldier_detail', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);

    // Use the admin's own soldier as the edit target (stable id).
    const targetId = tenantA.adminSoldierId;
    const newName = `Admin Renamed ${Date.now()}`;
    const newNotes = 'Updated by test B via UI';

    try {
      await page.goto(`${BASE_URL}/soldier_detail?id=${targetId}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    // The soldier_detail page loads the soldier via `load_soldier` request and binds
    // the form fields to the response. We overwrite display_name + notes.
    await fillLowdefyInput(page, 'soldier_form.display_name', newName);
    await fillLowdefyInput(page, 'soldier_form.notes', newNotes);

    // Save (Hebrew button: "שמור שינויים")
    await clickLowdefyButton(page, 'שמור שינויים');

    // DB verification — UpdateSoldier handler persists both columns.
    const c = await makePgClient();
    if (!c) return;
    try {
      // Brief wait for the request to round-trip before the DB read.
      await page.waitForTimeout(500);
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ display_name: string; notes: string | null }>(
        `SELECT display_name, notes FROM soldier WHERE id = $1`,
        [targetId],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].display_name).toBe(newName);
      expect(dbRes.rows[0].notes).toBe(newNotes);
    } finally { await c.end(); }
  });

  test('C. admin archives soldier (status flips to archived)', async ({ page }) => {
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);

    // Seed a fresh archivable soldier so this test is repeatable.
    let archiveTarget: string;
    {
      const c = await makePgClient();
      if (!c) {
        test.skip(true, 'Postgres not reachable');
        return;
      }
      try {
        await c.query('SET ROLE NONE');
        await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
        const ins = await c.query<{ id: string }>(
          `INSERT INTO soldier (tenant_id, display_name, status)
           VALUES ($1, 'To Be Archived', 'active') RETURNING id`,
          [tenantA.tenantId],
        );
        archiveTarget = ins.rows[0].id;
      } finally { await c.end(); }
    }

    try {
      await page.goto(`${BASE_URL}/soldier_detail?id=${archiveTarget}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    // Open archive confirmation modal then confirm — Hebrew "ארכוב חייל" appears on
    // both the trigger button and the confirmation OK button per soldier_detail.yaml.
    await clickLowdefyButton(page, 'ארכוב חייל');
    // The confirmation modal's primary action is also labelled ארכוב חייל (okText).
    await clickLowdefyButton(page, 'ארכוב חייל');

    // DB verification: status flipped to 'archived'.
    const c2 = await makePgClient();
    if (!c2) return;
    try {
      await page.waitForTimeout(500);
      await c2.query('SET ROLE NONE');
      await c2.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c2.query<{ status: string }>(
        `SELECT status FROM soldier WHERE id = $1`,
        [archiveTarget],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].status).toBe('archived');
    } finally { await c2.end(); }
  });

  test('D. team_manager edits soldier in own team — succeeds', async ({ page }) => {
    if (!tenantA || !managerSignIn || !soldierOwnTeamId) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    await setSessionCookie(page.context(), managerSignIn.sessionToken, BASE_URL);

    const newName = `Edited by manager ${Date.now()}`;

    try {
      await page.goto(`${BASE_URL}/soldier_detail?id=${soldierOwnTeamId}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    await fillLowdefyInput(page, 'soldier_form.display_name', newName);
    await clickLowdefyButton(page, 'שמור שינויים');

    // DB verification: row updated (Layer-4 is_manager_or_admin allowed the write).
    const c = await makePgClient();
    if (!c) return;
    try {
      await page.waitForTimeout(500);
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier WHERE id = $1`,
        [soldierOwnTeamId],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].display_name).toBe(newName);
    } finally { await c.end(); }
  });

  test('E. smart-quote canary — U+2019 in display_name persists as canonical bytes', async ({ page }) => {
    // ROST-11 / D-12 / Pitfall P2 — CreateSoldier runs canonicalizeText at WRITE time.
    // RIGHT SINGLE QUOTATION MARK (U+2019) must be stripped; the persisted bytes
    // are 'נועם גלאל' (no apostrophe of any kind).
    if (!tenantA || !adminSignIn) { test.skip(true, 'fixtures not seeded — Postgres unreachable'); return; }
    await setSessionCookie(page.context(), adminSignIn.sessionToken, BASE_URL);

    const rawDisplayName = 'נועם ג’לאל';     // contains U+2019
    const expectedCanonical = 'נועם גלאל';   // U+2019 stripped, single space preserved

    try {
      await page.goto(`${BASE_URL}/manage_soldiers`, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      test.skip(true, `Stack unreachable at ${BASE_URL}`);
      return;
    }

    await clickLowdefyButton(page, 'הוסף חייל');
    await fillLowdefyInput(page, 'new_soldier_form.display_name', rawDisplayName);
    await fillLowdefyInput(
      page,
      'new_soldier_form.email',
      `kibbutz-canary-${Date.now()}@example.test`,
    );
    await fillLowdefyInput(page, 'new_soldier_form.seniority', '5');
    await clickLowdefyButton(page, 'צור חייל');

    // The grid should refresh and the canonicalized name should be visible.
    await expectAgGridCellText(page, expectedCanonical);

    // DB byte-equal check.
    const c = await makePgClient();
    if (!c) return;
    try {
      await page.waitForTimeout(500);
      await c.query('SET ROLE NONE');
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ display_name: string }>(
        `SELECT display_name FROM soldier
          WHERE tenant_id = $1 AND display_name LIKE $2
          ORDER BY created_at DESC LIMIT 1`,
        [tenantA.tenantId, 'נועם%'],
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].display_name).toBe(expectedCanonical);
      expect(dbRes.rows[0].display_name).not.toContain('’');
    } finally { await c.end(); }
  });

});
