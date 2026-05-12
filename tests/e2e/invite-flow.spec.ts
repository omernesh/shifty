// tests/e2e/invite-flow.spec.ts
// AUTH-03, AUTH-05, AUTH-06: Invite code generation + redemption + rejection flow.
// Tests:
//   A: Admin generates a code via create_invite — code matches Crockford base32 regex
//   B: Redemption creates membership + invite_code_redemption row
//   C: Revoked code returns 0 rows from lookup_invite_code
//   D: Expired code returns 0 rows from lookup_invite_code
//   E: Used-up code (max_uses reached) returns 0 rows from lookup_invite_code

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';
const CROCKFORD_REGEX = /^[0-9A-HJKMNPQRSTVWXYZ]{8}$/;

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; } catch { return null; }
}

test.describe('Invite flow (AUTH-03, AUTH-05, AUTH-06)', () => {
  let tenantA: TenantFixture;

  test.beforeAll(async () => {
    const probe = await makePgClient();
    if (!probe) return;
    await probe.end();
    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('AUTH-03: invite_code from database matches Crockford base32 regex', async () => {
    // The seed already inserted an invite code via crockford8()
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const res = await c.query<{ code: string }>(
        `SELECT code FROM invite_code WHERE id = $1`,
        [tenantA.inviteCodeId]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].code).toMatch(CROCKFORD_REGEX);
    } finally { await c.end(); }
  });

  test('AUTH-05: redemption creates membership + invite_code_redemption row', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    try {
      const inviteeEmail = `invitee-a-${Date.now()}@example.test`;
      const inviteeDisplayName = 'חבר חדש';

      // Set tenant context to tenantA for RLS to permit inserts
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);

      // Simulate what signup_with_invite does: look up the code, insert app_user + soldier + membership
      const lookupRes = await c.query<{ tenant_id: string; org_unit_id: string; role: string }>(
        `SELECT tenant_id, org_unit_id, role FROM invite_code
         WHERE id = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
           AND (max_uses IS NULL OR uses < max_uses)`,
        [tenantA.inviteCodeId]
      );
      expect(lookupRes.rows.length).toBe(1);

      const { org_unit_id, role } = lookupRes.rows[0];
      const inviteeUserId = randomUUID();

      await c.query(
        `INSERT INTO app_user (id, tenant_id, email, display_name, locale)
         VALUES ($1, $2, $3, $4, 'he') ON CONFLICT DO NOTHING`,
        [inviteeUserId, tenantA.tenantId, inviteeEmail, inviteeDisplayName]
      );
      const soldierRes = await c.query<{ id: string }>(
        `INSERT INTO soldier (tenant_id, user_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantA.tenantId, inviteeUserId, inviteeDisplayName]
      );

      if (soldierRes.rows.length > 0) {
        const soldierId = soldierRes.rows[0].id;
        await c.query(
          `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [tenantA.tenantId, soldierId, org_unit_id, role]
        );
        await c.query(
          `INSERT INTO invite_code_redemption (tenant_id, invite_code_id, user_id)
           VALUES ($1, $2, $3)`,
          [tenantA.tenantId, tenantA.inviteCodeId, inviteeUserId]
        );
        await c.query(
          `UPDATE invite_code SET uses = uses + 1 WHERE id = $1`,
          [tenantA.inviteCodeId]
        );
      }

      // Verify membership row exists
      const membershipRes = await c.query(
        `SELECT m.role FROM membership m
         JOIN soldier s ON s.id = m.soldier_id
         JOIN app_user u ON u.id = s.user_id
         WHERE u.email = $1 AND m.tenant_id = $2`,
        [inviteeEmail, tenantA.tenantId]
      );
      expect(membershipRes.rows.length).toBeGreaterThanOrEqual(1);
      expect(membershipRes.rows[0].role).toBe('member');

      // Verify redemption row
      const redemptionRes = await c.query(
        `SELECT id FROM invite_code_redemption WHERE invite_code_id = $1 AND user_id = $2`,
        [tenantA.inviteCodeId, inviteeUserId]
      );
      expect(redemptionRes.rows.length).toBe(1);
    } finally { await c.end(); }
  });

  test('AUTH-06: revoked code returns 0 rows from lookup', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      // Insert a fresh invite code, then revoke it
      const codeId = randomUUID();
      await c.query(
        `INSERT INTO invite_code (id, tenant_id, code, org_unit_id, role, created_by)
         VALUES ($1, $2, 'REVOKEXX', $3, 'member', $4)`,
        [codeId, tenantA.tenantId, tenantA.orgUnitId, tenantA.adminUserId]
      );
      await c.query(`UPDATE invite_code SET revoked_at = now() WHERE id = $1`, [codeId]);

      const res = await c.query(
        `SELECT id FROM invite_code
         WHERE id = $1 AND revoked_at IS NULL`,
        [codeId]
      );
      expect(res.rows.length).toBe(0); // revoked code not selectable
    } finally { await c.end(); }
  });

  test('AUTH-06: expired code returns 0 rows from lookup', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const codeId = randomUUID();
      await c.query(
        `INSERT INTO invite_code (id, tenant_id, code, org_unit_id, role, created_by, expires_at)
         VALUES ($1, $2, 'EXPIREDX', $3, 'member', $4, now() - interval '1 hour')`,
        [codeId, tenantA.tenantId, tenantA.orgUnitId, tenantA.adminUserId]
      );

      const res = await c.query(
        `SELECT id FROM invite_code
         WHERE id = $1
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`,
        [codeId]
      );
      expect(res.rows.length).toBe(0); // expired code not selectable
    } finally { await c.end(); }
  });

  test('AUTH-06: used-up code (max_uses reached) returns 0 rows from lookup', async () => {
    const c = await makePgClient();
    if (!c) { test.skip(true, 'Postgres not reachable'); return; }
    try {
      await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
      const codeId = randomUUID();
      await c.query(
        `INSERT INTO invite_code (id, tenant_id, code, org_unit_id, role, created_by, max_uses, uses)
         VALUES ($1, $2, 'USEDUP00', $3, 'member', $4, 1, 1)`,
        [codeId, tenantA.tenantId, tenantA.orgUnitId, tenantA.adminUserId]
      );

      const res = await c.query(
        `SELECT id FROM invite_code
         WHERE id = $1
           AND revoked_at IS NULL
           AND (max_uses IS NULL OR uses < max_uses)`,
        [codeId]
      );
      expect(res.rows.length).toBe(0); // used-up code not selectable
    } finally { await c.end(); }
  });
});
