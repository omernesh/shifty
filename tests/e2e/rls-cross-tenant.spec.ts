// tests/e2e/rls-cross-tenant.spec.ts
// SEC-04: Direct RLS verification via pg client.
// Sets app.current_tenant to tenant-A's UUID and asserts that:
//   - SELECT returns only tenant-A rows
//   - UPDATE on tenant-B's soldier affects 0 rows
//   - DELETE on tenant-B's soldier affects 0 rows

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { seedTwoTenants, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makeClient(): Promise<Client | null> {
  const client = new Client({ connectionString: PG_URL });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test.describe('RLS isolation (SEC-04)', () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  test.beforeAll(async () => {
    const client = await makeClient();
    if (!client) {
      return; // individual tests will skip
    }
    await client.end();

    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
    tenantB = seeded.tenantB;
  });

  test.afterAll(async () => {
    const client = await makeClient();
    if (!client) return;
    await client.end();
    await teardownTestData();
  });

  test('SELECT soldier with app.current_tenant=A returns only A rows', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query<{ id: string; tenant_id: string }>(`SELECT id, tenant_id FROM soldier`);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      for (const row of res.rows) {
        expect(row.tenant_id).toBe(tenantA.tenantId);
      }
    } finally {
      await c.end();
    }
  });

  test('UPDATE soldier with app.current_tenant=A cannot modify tenant-B rows', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      // Attempt to UPDATE tenant-B's soldier — RLS should silently affect 0 rows
      const res = await c.query(
        `UPDATE soldier SET display_name = 'HACKED' WHERE id = $1`,
        [tenantB.adminSoldierId]
      );
      expect(res.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });

  test('DELETE soldier with app.current_tenant=A cannot delete tenant-B rows', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query(`DELETE FROM soldier WHERE id = $1`, [tenantB.adminSoldierId]);
      expect(res.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });

  test('SELECT org_unit with app.current_tenant=B returns only B rows', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantB.tenantId]);
      const res = await c.query<{ id: string; tenant_id: string }>(`SELECT id, tenant_id FROM org_unit`);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      for (const row of res.rows) {
        expect(row.tenant_id).toBe(tenantB.tenantId);
      }
    } finally {
      await c.end();
    }
  });

  test('SELECT invite_code with app.current_tenant=A does not include tenant-B codes', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query<{ id: string }>(`SELECT id FROM invite_code`);
      const ids = res.rows.map(r => r.id);
      expect(ids).not.toContain(tenantB.inviteCodeId);
    } finally {
      await c.end();
    }
  });
});
