// tests/e2e/_fixtures/seed-tenants.ts
// Seeds two independent tenants for cross-tenant isolation tests.
// Uses the `pg` package directly (not Lowdefy) — connects to localhost:5432.
// DDL never; only INSERT. Schema must already be applied via migrations.

import { Client } from 'pg';

const PG_TEST_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

export interface TenantSeed {
  tenantId: string;
  adminEmail: string;
  orgUnitId: string;
  soldierId: string;
}

export interface SeedResult {
  tenantA: TenantSeed;
  tenantB: TenantSeed;
}

export async function seedTwoTenants(): Promise<SeedResult> {
  const client = new Client({ connectionString: PG_TEST_URL });
  await client.connect();
  try {
    // Tenant A
    const tenantAId = '11111111-1111-1111-1111-111111111111';
    const tenantBId = '22222222-2222-2222-2222-222222222222';
    const orgUnitAId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const orgUnitBId = 'bbbbbbbb-0000-0000-0000-000000000001';
    const appUserAId = 'aaaaaaaa-0000-0000-0000-000000000002';
    const appUserBId = 'bbbbbbbb-0000-0000-0000-000000000002';
    const soldierAId = 'aaaaaaaa-0000-0000-0000-000000000003';
    const soldierBId = 'bbbbbbbb-0000-0000-0000-000000000003';

    await client.query(`
      INSERT INTO tenant (id, name, org_depth) VALUES
        ($1, 'Tenant A (test)', 1),
        ($2, 'Tenant B (test)', 1)
      ON CONFLICT (id) DO NOTHING
    `, [tenantAId, tenantBId]);

    await client.query(`
      INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES
        ($1, $3, NULL, 1, 'Unit A'),
        ($2, $4, NULL, 1, 'Unit B')
      ON CONFLICT (id) DO NOTHING
    `, [orgUnitAId, orgUnitBId, tenantAId, tenantBId]);

    await client.query(`
      INSERT INTO app_user (id, tenant_id, email, display_name, locale) VALUES
        ($1, $3, 'admin-a@example.test', 'Admin A', 'he'),
        ($2, $4, 'admin-b@example.test', 'Admin B', 'he')
      ON CONFLICT (id) DO NOTHING
    `, [appUserAId, appUserBId, tenantAId, tenantBId]);

    await client.query(`
      INSERT INTO soldier (id, tenant_id, display_name, user_id) VALUES
        ($1, $3, 'Admin Soldier A', $5),
        ($2, $4, 'Admin Soldier B', $6)
      ON CONFLICT (id) DO NOTHING
    `, [soldierAId, soldierBId, tenantAId, tenantBId, appUserAId, appUserBId]);

    await client.query(`
      INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role) VALUES
        (gen_random_uuid(), $3, $1, $5, 'unit_admin'),
        (gen_random_uuid(), $4, $2, $6, 'unit_admin')
      ON CONFLICT (soldier_id, org_unit_id) DO NOTHING
    `, [soldierAId, soldierBId, tenantAId, tenantBId, orgUnitAId, orgUnitBId]);

    return {
      tenantA: { tenantId: tenantAId, adminEmail: 'admin-a@example.test', orgUnitId: orgUnitAId, soldierId: soldierAId },
      tenantB: { tenantId: tenantBId, adminEmail: 'admin-b@example.test', orgUnitId: orgUnitBId, soldierId: soldierBId },
    };
  } finally {
    await client.end();
  }
}

// TODO (Plan 03 will implement): signs in as the given email via the NextAuth magic-link flow
// and returns session cookies. Until then, tests using this function should be skipped.
export async function signInAs(_email: string): Promise<{ cookies: string[]; userId: string }> {
  return { cookies: [], userId: '' };
}

export function getTenantBIds(tenantB: TenantSeed): { soldiers: string[]; windows: string[]; assignments: string[] } {
  // Phase 1 only seeds tenants + soldiers; later phases extend with windows and assignments.
  return { soldiers: [tenantB.soldierId], windows: [], assignments: [] };
}
