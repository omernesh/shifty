// tests/e2e/layer5-rls-activation.spec.ts
// Layer 5 RLS active-enforcement proof — Phase 02-11 hotfix acceptance gate.
//
// Context (see .planning/phases/02-org-people/02-UAT-FINDINGS.md §2 + §3):
//   - Migration 0013 installs the `shifty_app` role (NOSUPERUSER NOBYPASSRLS NOLOGIN),
//     ALTER ROLE shifts SET role = shifty_app (so new shifts connections operate as
//     shifty_app by default), and FORCE ROW LEVEL SECURITY on every RLS-enabled table.
//   - The RLS policy filter is:
//        tenant_id = current_setting('app.current_tenant', true)::uuid
//   - KnexRawTenant (now registered via shifty-plugin) wraps each request in a
//     Knex transaction with `SET LOCAL app.current_tenant = '<session.tenant_id>'`.
//   - This test proves the chain CLOSES THE LOOP: with shifty_app role active +
//     app.current_tenant pinned to tenant-A, a query that targets a tenant-B id
//     returns ZERO rows at the database level — regardless of WHERE clauses, Layer-2
//     YAML bindings, or Layer-4 request-handler scope checks. Layer 5 is the bottom
//     net of the four-layer defense (PRD §8.3).
//
// Distinction from existing tenant-isolation.spec.ts:
//   tenant-isolation Test B + Test D rely on Layer 4 (request handler) + Layer 2
//   (YAML WHERE clause) for their assertions; both depend on app-level logic.
//   This spec bypasses both layers and asserts at the raw DB level, proving Layer 5
//   ALONE prevents cross-tenant access if upper layers were forged.
//
// Test shape:
//   1. SetUp: probe pg_roles for `shifty_app` (migration 0013 precondition).
//   2. Seed two tenants A and B.
//   3. Tenant-A active baseline: SET ROLE shifty_app + SET LOCAL app.current_tenant=tenantA.id
//      → SELECT for tenantA.adminSoldierId → expect 1 row (legitimate case works).
//   4. Tenant-A forged cross-tenant: same role + same SET LOCAL, but
//      SELECT for tenantB.adminSoldierId → expect 0 rows (Layer 5 blocks).
//   5. The same tenant-B id IS visible when context is switched to tenantB.id —
//      confirming the row exists but is hidden by RLS, not absent from the DB.

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import {
  seedTwoTenants,
  type TenantFixture,
} from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';

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

/**
 * Run a query in a fresh transaction with:
 *   - SET ROLE shifty_app  (drop SUPERUSER bypass; FORCE RLS now applies)
 *   - SET LOCAL app.current_tenant = <uuid>  (RLS scope binding)
 *
 * Models the exact runtime path KnexRawTenant uses.
 *
 * If shifty_app role is missing (migration 0013 not applied), the SET ROLE will
 * fail and surface the precondition violation as a clear test failure.
 */
async function runAsTenant<T>(
  client: Client,
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE shifty_app');
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

test.beforeAll(async () => {
  const probe = await makePgClient();
  if (!probe) return; // tests will skip individually if pg unreachable
  try {
    // Migration 0013 precondition: shifty_app role must exist.
    const r = await probe.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_roles WHERE rolname = 'shifty_app'`,
    );
    if (r.rows[0].count < 1) {
      throw new Error(
        'Layer 5 precondition violation: shifty_app role missing — migration 0013 not applied',
      );
    }
  } finally {
    await probe.end();
  }

  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  tenantB = seeded.tenantB;
});

test.afterAll(async () => {
  await teardownTestData();
});

test.describe('Layer 5 RLS active enforcement (02-11 hotfix acceptance gate)', () => {
  test('precondition: shifty_app role exists and is NOSUPERUSER + NOBYPASSRLS', async () => {
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      const res = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'shifty_app'`,
      );
      expect(res.rows.length, 'shifty_app role missing — migration 0013 not applied').toBe(1);
      expect(res.rows[0].rolsuper, 'shifty_app must NOT be SUPERUSER').toBe(false);
      expect(res.rows[0].rolbypassrls, 'shifty_app must NOT BYPASSRLS').toBe(false);
    } finally {
      await c.end();
    }
  });

  test('baseline: tenantA context + tenantA soldier_id returns 1 row (KnexRawTenant works)', async () => {
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      const rows = await runAsTenant(c, tenantA.tenantId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `SELECT id FROM soldier WHERE id = $1`,
          [tenantA.adminSoldierId],
        );
        return r.rows;
      });
      // Baseline proves the resolver actually works for legitimate cross-section.
      // Without this, a "0 rows for tenantB" could trivially come from a misconfigured
      // SET LOCAL — the baseline rules out resolver-broken false negatives.
      expect(rows.length, 'tenantA soldier must be visible in tenantA context').toBe(1);
      expect(rows[0].id).toBe(tenantA.adminSoldierId);
    } finally {
      await c.end();
    }
  });

  test('forged cross-tenant: tenantA context + tenantB soldier_id returns 0 rows (RLS blocks)', async () => {
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      // KnexRawTenant simulation: tenantA session executes a query targeting a tenantB id.
      // Even though the WHERE clause does NOT filter on tenant_id (intentional — we want
      // to prove Layer 5 alone blocks the row), RLS evaluates the policy before the row
      // is emitted: tenant_id = current_setting('app.current_tenant', true)::uuid
      // → tenantB.tenant_id != tenantA.tenant_id → row excluded.
      const rows = await runAsTenant(c, tenantA.tenantId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `SELECT id FROM soldier WHERE id = $1`,
          [tenantB.adminSoldierId],
        );
        return r.rows;
      });
      // THE LOAD-BEARING ASSERTION: Layer 5 enforced → zero rows.
      expect(
        rows.length,
        `Layer 5 RLS LEAK: tenantA session saw tenantB soldier ${tenantB.adminSoldierId} ` +
          `— migration 0013 + KnexRawTenant chain is not closing the loop`,
      ).toBe(0);
    } finally {
      await c.end();
    }
  });

  test('symmetric proof: same tenantB id IS visible when context switches to tenantB', async () => {
    // Confirms the row exists but is hidden by RLS, not absent from the DB.
    // Without this assertion, the "0 rows" result above could trivially come from
    // a missing seed row.
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      const rows = await runAsTenant(c, tenantB.tenantId, async (cli) => {
        const r = await cli.query<{ id: string }>(
          `SELECT id FROM soldier WHERE id = $1`,
          [tenantB.adminSoldierId],
        );
        return r.rows;
      });
      expect(rows.length, 'tenantB soldier must be visible in tenantB context').toBe(1);
      expect(rows[0].id).toBe(tenantB.adminSoldierId);
    } finally {
      await c.end();
    }
  });

  test('membership table: tenantA context cannot see tenantB membership rows', async () => {
    // Broader proof: the same RLS policy applies to every tenant-scoped table.
    // membership is one of the highest-value tables to lock down (org chart integrity).
    const c = await makePgClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable');
      return;
    }
    try {
      const rows = await runAsTenant(c, tenantA.tenantId, async (cli) => {
        const r = await cli.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM membership WHERE tenant_id = $1`,
          [tenantB.tenantId],
        );
        return r.rows;
      });
      expect(
        rows.length,
        `Layer 5 RLS LEAK on membership: tenantA session saw ${rows.length} tenantB membership rows`,
      ).toBe(0);
    } finally {
      await c.end();
    }
  });
});
