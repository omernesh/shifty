// tests/e2e/tenant-bootstrap.spec.ts
// TEN-01..05: Founding-admin signup flow creates full row set in one CTE.
// Verifies: tenant + org_unit + app_user + soldier + membership(unit_admin) all created.
// Also verifies org tree schema allows multi-level nesting (direct SQL insert).

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { teardownTestData } from './_fixtures/teardown';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; } catch { return null; }
}

// Simulate the bootstrap_tenant CTE from signup.yaml (TEN-01..04)
const BOOTSTRAP_CTE = `
  WITH new_tenant AS (
    INSERT INTO tenant (name, org_depth)
    VALUES ($1, $2)
    RETURNING id
  ),
  set_tenant_ctx AS (
    SELECT set_config('app.current_tenant', id::text, true) FROM new_tenant
  ),
  new_org_unit AS (
    INSERT INTO org_unit (tenant_id, parent_id, level, name)
    SELECT id, NULL, 1, $1 FROM new_tenant
    RETURNING id, tenant_id
  ),
  new_user AS (
    INSERT INTO app_user (tenant_id, email, display_name, locale)
    SELECT tenant_id, $3, $4, 'he' FROM new_org_unit
    RETURNING id, tenant_id
  ),
  new_soldier AS (
    INSERT INTO soldier (tenant_id, user_id, display_name)
    SELECT nu.tenant_id, nu.id, $4 FROM new_user nu
    RETURNING id, tenant_id
  )
  INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
  SELECT ns.tenant_id, ns.id, nou.id, 'unit_admin'
  FROM new_soldier ns, new_org_unit nou
  RETURNING tenant_id
`;

test.describe('Tenant bootstrap (TEN-01..05)', () => {
  let bootstrappedTenantId: string;

  test.beforeAll(async () => {
    await teardownTestData();
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('TEN-01..04: founding-admin CTE creates tenant + org_unit + app_user + soldier + membership', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }

    try {
      const tenantName = `Bootstrap Test ${Date.now()}`;
      const email = `bootstrap-${Date.now()}@example.test`;
      const displayName = 'Bootstrap Admin';

      // Execute the bootstrap CTE
      const result = await c.query<{ tenant_id: string }>(BOOTSTRAP_CTE, [tenantName, 2, email, displayName]);
      expect(result.rows.length).toBe(1);
      bootstrappedTenantId = result.rows[0].tenant_id;

      // Set tenant context for subsequent queries
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [bootstrappedTenantId]);

      // TEN-01: tenant row exists
      const tenantRes = await c.query<{ id: string; name: string; org_depth: number }>(
        `SELECT id, name, org_depth FROM tenant WHERE id = $1`,
        [bootstrappedTenantId]
      );
      expect(tenantRes.rows.length).toBe(1);
      expect(tenantRes.rows[0].name).toBe(tenantName);
      expect(tenantRes.rows[0].org_depth).toBe(2);

      // TEN-02: root org_unit created
      const orgRes = await c.query(
        `SELECT id, level, parent_id FROM org_unit WHERE tenant_id = $1`,
        [bootstrappedTenantId]
      );
      expect(orgRes.rows.length).toBe(1);
      expect(orgRes.rows[0].level).toBe(1);
      expect(orgRes.rows[0].parent_id).toBeNull();

      // TEN-03: app_user created with correct email
      const userRes = await c.query(
        `SELECT id, email FROM app_user WHERE tenant_id = $1`,
        [bootstrappedTenantId]
      );
      expect(userRes.rows.length).toBe(1);
      expect(userRes.rows[0].email).toBe(email);

      // TEN-04: soldier created
      const soldierRes = await c.query(
        `SELECT id FROM soldier WHERE tenant_id = $1`,
        [bootstrappedTenantId]
      );
      expect(soldierRes.rows.length).toBe(1);

      // TEN-05: unit_admin membership created
      const membershipRes = await c.query(
        `SELECT role FROM membership WHERE tenant_id = $1`,
        [bootstrappedTenantId]
      );
      expect(membershipRes.rows.length).toBe(1);
      expect(membershipRes.rows[0].role).toBe('unit_admin');
    } finally { await c.end(); }
  });

  test('TEN-05: org tree schema allows multi-level nesting (level 2 child org_unit)', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    if (!bootstrappedTenantId) {
      test.skip(true, 'Bootstrap test did not run — no tenantId available');
      return;
    }

    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [bootstrappedTenantId]);

      // Get the root org unit id
      const rootRes = await c.query<{ id: string }>(
        `SELECT id FROM org_unit WHERE tenant_id = $1 AND level = 1`,
        [bootstrappedTenantId]
      );
      expect(rootRes.rows.length).toBeGreaterThanOrEqual(1);
      const rootId = rootRes.rows[0].id;

      // Insert a child org_unit (level 2)
      const childId = randomUUID();
      await c.query(
        `INSERT INTO org_unit (id, tenant_id, parent_id, level, name)
         VALUES ($1, $2, $3, 2, 'Child Team') ON CONFLICT (id) DO NOTHING`,
        [childId, bootstrappedTenantId, rootId]
      );

      const childRes = await c.query<{ id: string; parent_id: string; level: number }>(
        `SELECT id, parent_id, level FROM org_unit WHERE id = $1`,
        [childId]
      );
      expect(childRes.rows.length).toBe(1);
      expect(childRes.rows[0].parent_id).toBe(rootId);
      expect(childRes.rows[0].level).toBe(2);
    } finally { await c.end(); }
  });
});
