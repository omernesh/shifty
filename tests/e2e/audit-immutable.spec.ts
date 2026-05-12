// tests/e2e/audit-immutable.spec.ts
// SEC-07: Audit append-only enforcement.
// Verifies that UPDATE/DELETE/TRUNCATE on schedule_audit fail with permission denied (PG code 42501).
// Also verifies that UPDATE on notification_log SUCCEEDS (positive control — not revoked).

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

test.describe('Audit append-only (SEC-07)', () => {
  let tenantA: TenantFixture;

  test.beforeAll(async () => {
    const probe = await makeClient();
    if (!probe) return;
    await probe.end();

    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;

    // Seed one schedule_audit row so UPDATE/DELETE have something to attempt
    const c = await makeClient();
    if (!c) return;
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      await c.query(
        `INSERT INTO schedule_audit (tenant_id, to_state, actor_user_id, actor_kind)
         VALUES ($1, 'test_seed', $2, 'system')`,
        [tenantA.tenantId, tenantA.adminUserId]
      );
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('UPDATE schedule_audit fails with permission denied (42501)', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      await expect(
        c.query(`UPDATE schedule_audit SET to_state = 'tampered' WHERE id IS NOT NULL`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  test('DELETE schedule_audit fails with permission denied (42501)', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      await expect(
        c.query(`DELETE FROM schedule_audit WHERE id IS NOT NULL`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  test('TRUNCATE schedule_audit fails with permission denied (42501)', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await expect(
        c.query(`TRUNCATE schedule_audit`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  test('UPDATE notification_log status SUCCEEDS (positive control — not revoked)', async () => {
    const c = await makeClient();
    if (!c) {
      test.skip(true, 'Postgres not reachable — run with compose stack up');
      return;
    }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      // Insert a notification_log row
      const ins = await c.query<{ id: string }>(
        `INSERT INTO notification_log (tenant_id, user_id, event_type, channel, status)
         VALUES ($1, $2, 'test_event', 'email', 'queued')
         RETURNING id`,
        [tenantA.tenantId, tenantA.adminUserId]
      );
      const id = ins.rows[0].id;
      // UPDATE should succeed (notification_log is NOT in the REVOKE list)
      await c.query(`UPDATE notification_log SET status = 'sent' WHERE id = $1`, [id]);
      const res = await c.query<{ status: string }>(`SELECT status FROM notification_log WHERE id = $1`, [id]);
      expect(res.rows[0].status).toBe('sent');
    } finally {
      await c.end();
    }
  });
});
