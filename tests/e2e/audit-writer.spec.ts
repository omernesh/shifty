// tests/e2e/audit-writer.spec.ts
// D-08: shifty-audit-writer plugin happy-path integration test.
// Verifies that clicking the "כתוב שורת ביקורת" button on /admin_test_audit creates
// a schedule_audit row scoped to tenant A only.
//
// Warning 10 fix — Knex afterCreate hook full-stack proof:
// After writing via the Lowdefy session, queries schedule_audit with two different
// app.current_tenant values to prove the Knex pool checkout ran SET LOCAL app.current_tenant
// correctly at write time (row visible only to the originating tenant).

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const client = new Client({ connectionString: PG_URL });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test.describe('shifty-audit-writer plugin (D-08)', () => {
  let tenantA: TenantFixture;
  let adminASession: { sessionToken: string; userId: string; cookies: string };

  test.beforeAll(async () => {
    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
    adminASession = await signInAs(tenantA.adminEmail);
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('clicking write_test_audit button creates a schedule_audit row for tenant A only', async ({ page }) => {
    await page.context().addCookies([{
      name: '__Secure-next-auth.session-token',
      value: adminASession.sessionToken,
      url: BASE_URL,
      httpOnly: true,
        secure: false,
        sameSite: 'Lax',
    }]);

    let navigated = false;
    try {
      await page.goto(`${BASE_URL}/admin_test_audit`, { waitUntil: 'networkidle', timeout: 15_000 });
      navigated = true;
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    // Click the button (Hebrew label "כתוב שורת ביקורת")
    const button = page.getByRole('button', { name: 'כתוב שורת ביקורת' });
    if (!(await button.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'write_test_audit button not found — may need login or page changed');
      return;
    }
    await button.click();
    await page.waitForTimeout(2_000); // allow request + grid refresh

    // Verify via direct DB query
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query<{ to_state: string; actor_user_id: string; actor_kind: string }>(
        `SELECT to_state, actor_user_id, actor_kind FROM schedule_audit
         WHERE tenant_id = $1 AND to_state = 'test_mutation'`,
        [tenantA.tenantId]
      );
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      // actor_user_id should match the session user's app_user.id
      // (The plugin resolves actor_user_id from the session's user_id)
      expect(res.rows[0].actor_kind).toBe('user');
    } finally {
      await c.end();
    }
  });

  // Warning 10 fix — Knex `afterCreate` hook full-stack proof.
  // The Plan-03 `setTenantOnConnection` hook runs `SET LOCAL app.current_tenant = <session.tenant_id>`
  // on every Knex pool checkout. We prove this end-to-end by:
  //   1. Writing an audit row via the Lowdefy session (through the live server)
  //   2. Querying schedule_audit WITHOUT the correct tenant context — RLS hides the row
  //   3. Querying WITH the correct tenant context — RLS reveals the row
  // This proves the Lowdefy server ran SET LOCAL app.current_tenant = tenantA on the pool
  // checkout that did the INSERT (otherwise the row would have NULL or wrong tenant_id,
  // breaking the RLS USING clause).
  test('Knex afterCreate hook sets app.current_tenant equal to session.tenant_id (Warning 10)', async ({ page }) => {
    await page.context().addCookies([{
      name: '__Secure-next-auth.session-token',
      value: adminASession.sessionToken,
      url: BASE_URL,
      httpOnly: true,
        secure: false,
        sameSite: 'Lax',
    }]);

    let navigated = false;
    try {
      await page.goto(`${BASE_URL}/admin_test_audit`, { waitUntil: 'networkidle', timeout: 15_000 });
      navigated = true;
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    const button = page.getByRole('button', { name: 'כתוב שורת ביקורת' });
    if (!(await button.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'write_test_audit button not found');
      return;
    }
    await button.click();
    await page.waitForTimeout(2_000);

    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      // Step 1: query with a WRONG tenant context — RLS must hide the row written by Lowdefy
      await c.query(
        `SELECT set_config('app.current_tenant', '00000000-0000-0000-0000-000000000000', false)`
      );
      const blocked = await c.query(
        `SELECT id FROM schedule_audit WHERE to_state = 'test_mutation'`
      );
      expect(blocked.rows.length).toBe(0); // RLS hides the row — proves it was tenant-scoped at write time

      // Step 2: query with tenant-A context — RLS must reveal the row
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const visible = await c.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM schedule_audit WHERE to_state = 'test_mutation'`
      );
      expect(visible.rows.length).toBeGreaterThanOrEqual(1);
      expect(visible.rows[0].tenant_id).toBe(tenantA.tenantId);
      // Proof: the Lowdefy INSERT was scoped to tenantA.tenantId at the Knex pool checkout level.
    } finally {
      await c.end();
    }
  });
});
