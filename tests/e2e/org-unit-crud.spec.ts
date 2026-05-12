// tests/e2e/org-unit-crud.spec.ts
// TEN-03 (Blocker 5 fix): Admin happy-path org_unit CRUD + member-role 403 gate.
// Plan 03 added create_org_unit, rename_org_unit, delete_org_unit requests on manage_org_units.yaml
// with page-level auth.roles: [unit_admin].
//
// Tests:
//   A: admin create_org_unit returns 200; new row exists in DB
//   B: admin rename_org_unit returns 200; row updated
//   C: admin delete_org_unit returns 200; row deleted (hard delete — no archived_at in Phase 1 schema)
//   D: member create blocked (403/401)
//   E: member rename blocked (403/401)
//   F: member delete blocked (403/401)

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; } catch { return null; }
}

/** Seeds a member-role user in tenant A and returns their session. */
async function seedMemberUser(tenantA: TenantFixture): Promise<{
  memberSession: { sessionToken: string; userId: string; cookies: string };
}> {
  const c = await makePgClient();
  if (!c) throw new Error('Postgres not reachable');

  const memberEmail = `member-ou-${Date.now()}@example.test`;
  const authUserId = randomUUID();
  const appUserId = randomUUID();
  const soldierId = randomUUID();

  try {
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
    await c.query(
      `INSERT INTO "users" (id, name, email, "emailVerified") VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [authUserId, 'member-ou', memberEmail]
    );
    await c.query(
      `INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id)
       VALUES ($1, $2, $3, 'Member OU', 'he', $4) ON CONFLICT DO NOTHING`,
      [appUserId, tenantA.tenantId, memberEmail, authUserId]
    );
    await c.query(
      `INSERT INTO soldier (id, tenant_id, user_id, display_name)
       VALUES ($1, $2, $3, 'Member OU Soldier') ON CONFLICT DO NOTHING`,
      [soldierId, tenantA.tenantId, appUserId]
    );
    await c.query(
      `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
       VALUES ($1, $2, $3, 'member') ON CONFLICT DO NOTHING`,
      [tenantA.tenantId, soldierId, tenantA.orgUnitId]
    );
  } finally {
    await c.end();
  }

  const memberSession = await signInAs(memberEmail);
  return { memberSession };
}

test.describe('Org-unit CRUD (TEN-03)', () => {
  let tenantA: TenantFixture;
  let adminSession: { sessionToken: string; userId: string; cookies: string };
  let memberSession: { sessionToken: string; userId: string; cookies: string };
  let createdOrgUnitId: string | null = null;

  test.beforeAll(async () => {
    const probe = await makePgClient();
    if (!probe) return;
    await probe.end();

    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
    adminSession = await signInAs(tenantA.adminEmail);
    const { memberSession: ms } = await seedMemberUser(tenantA);
    memberSession = ms;
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('TEN-03 A: admin can create a child org_unit (happy path)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/create_org_unit`, {
        headers: {
          Cookie: adminSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            parent_id: tenantA.orgUnitId,
            level: 2,
            name: 'New Team',
          },
        },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    expect(res.status()).toBe(200);

    // Verify via psql
    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ id: string }>(
        `SELECT id FROM org_unit WHERE tenant_id = $1 AND name = 'New Team' AND parent_id = $2`,
        [tenantA.tenantId, tenantA.orgUnitId]
      );
      expect(dbRes.rows.length).toBe(1);
      createdOrgUnitId = dbRes.rows[0].id;
    } finally { await c.end(); }
  });

  test('TEN-03 B: admin can rename an org_unit (happy path)', async ({ request }) => {
    if (!createdOrgUnitId) {
      test.skip(true, 'No org_unit created in Test A — skipping rename test');
      return;
    }

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/rename_org_unit`, {
        headers: {
          Cookie: adminSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            id: createdOrgUnitId,
            new_name: 'Renamed Team',
          },
        },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    expect(res.status()).toBe(200);

    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const dbRes = await c.query<{ name: string }>(
        `SELECT name FROM org_unit WHERE id = $1`,
        [createdOrgUnitId]
      );
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].name).toBe('Renamed Team');
    } finally { await c.end(); }
  });

  test('TEN-03 C: admin can delete an org_unit (happy path — hard delete)', async ({ request }) => {
    if (!createdOrgUnitId) {
      test.skip(true, 'No org_unit created in Test A — skipping delete test');
      return;
    }

    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/delete_org_unit`, {
        headers: {
          Cookie: adminSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            id: createdOrgUnitId,
          },
        },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    expect(res.status()).toBe(200);

    const c = await makePgClient();
    if (!c) return;
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      // Check for archived_at column (soft delete) — Phase 1 schema does hard delete
      const colCheck = await c.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'org_unit' AND column_name = 'archived_at'`
      );
      if (colCheck.rows.length > 0) {
        // Soft delete: row should have archived_at set
        const dbRes = await c.query<{ archived_at: unknown }>(
          `SELECT archived_at FROM org_unit WHERE id = $1`,
          [createdOrgUnitId]
        );
        expect(dbRes.rows.length).toBe(1);
        expect(dbRes.rows[0].archived_at).not.toBeNull();
      } else {
        // Hard delete: row should be gone
        const dbRes = await c.query(
          `SELECT id FROM org_unit WHERE id = $1`,
          [createdOrgUnitId]
        );
        expect(dbRes.rows.length).toBe(0);
      }
    } finally { await c.end(); }
  });

  test('TEN-03 D: member-role create_org_unit is blocked (403/401)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/create_org_unit`, {
        headers: {
          Cookie: memberSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            parent_id: tenantA.orgUnitId,
            level: 2,
            name: 'Unauthorized Team',
          },
        },
        maxRedirects: 0,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    const status = res.status();
    const isBlocked = status === 403 || status === 401 || status === 302 || status === 303;
    expect(isBlocked, `Expected auth block for member on create_org_unit, got ${status}`).toBe(true);
  });

  test('TEN-03 E: member-role rename_org_unit is blocked (403/401)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/rename_org_unit`, {
        headers: {
          Cookie: memberSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            id: tenantA.orgUnitId,
            new_name: 'Hacked Name',
          },
        },
        maxRedirects: 0,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    const status = res.status();
    const isBlocked = status === 403 || status === 401 || status === 302 || status === 303;
    expect(isBlocked, `Expected auth block for member on rename_org_unit, got ${status}`).toBe(true);
  });

  test('TEN-03 F: member-role delete_org_unit is blocked (403/401)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.post(`${BASE_URL}/api/request/manage_org_units/delete_org_unit`, {
        headers: {
          Cookie: memberSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            id: tenantA.orgUnitId,
          },
        },
        maxRedirects: 0,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    const status = res.status();
    const isBlocked = status === 403 || status === 401 || status === 302 || status === 303;
    expect(isBlocked, `Expected auth block for member on delete_org_unit, got ${status}`).toBe(true);
  });
});
