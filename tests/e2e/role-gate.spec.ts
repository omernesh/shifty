// tests/e2e/role-gate.spec.ts
// SEC-09 (Blocker 3 fix): Invite listing + creation requires unit_admin role.
// A member-role user must be blocked from /manage_invites and from the create_invite request.
// Positive control: unit_admin user is allowed through.
//
// Note: Lowdefy 5.3.0 enforces auth gates at the PAGE level only (request-level auth.roles
// is not supported). The page-level gate (auth.roles: [unit_admin] in manage_invites.yaml)
// is what provides the protection. Both the page redirect and the API endpoint are tested.

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
  memberEmail: string;
  memberSession: { sessionToken: string; userId: string; cookies: string };
}> {
  const c = await makePgClient();
  if (!c) throw new Error('Postgres not reachable');

  const memberEmail = `member-a-${Date.now()}@example.test`;
  const authUserId = randomUUID();
  const appUserId = randomUUID();
  const soldierId = randomUUID();

  try {
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);

    await c.query(
      `INSERT INTO "users" (id, name, email, "emailVerified") VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [authUserId, 'member-a', memberEmail]
    );
    await c.query(
      `INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id)
       VALUES ($1, $2, $3, 'Member A', 'he', $4) ON CONFLICT DO NOTHING`,
      [appUserId, tenantA.tenantId, memberEmail, authUserId]
    );
    await c.query(
      `INSERT INTO soldier (id, tenant_id, user_id, display_name)
       VALUES ($1, $2, $3, 'Member A Soldier') ON CONFLICT DO NOTHING`,
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
  return { memberEmail, memberSession };
}

test.describe('Role gate (SEC-09)', () => {
  let tenantA: TenantFixture;
  let adminSession: { sessionToken: string; userId: string; cookies: string };
  let memberSession: { sessionToken: string; userId: string; cookies: string };

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

  test('SEC-09 A: member-role user is blocked from GET /manage_invites (403 or redirect)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.get(`${BASE_URL}/manage_invites`, {
        headers: { Cookie: memberSession.cookies },
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

    // Lowdefy page-level auth gate should redirect or return 403
    const status = res.status();
    const isBlocked = status === 403 || status === 302 || status === 303 || status === 401;
    expect(isBlocked, `Expected auth block (403/302/303/401), got ${status}`).toBe(true);
  });

  test('SEC-09 B: member-role user POST to create_invite is blocked', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      // Lowdefy API endpoint pattern: /api/request/<pageId>/<requestId>
      res = await request.post(`${BASE_URL}/api/request/manage_invites/create_invite`, {
        headers: {
          Cookie: memberSession.cookies,
          'Content-Type': 'application/json',
        },
        data: {
          payload: {
            tenant_id: tenantA.tenantId,
            org_unit_id: tenantA.orgUnitId,
            role: 'member',
            max_uses: 1,
            expires_at: null,
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

    // The page-level auth gate blocks the member before the request handler executes
    const status = res.status();
    const isBlocked = status === 403 || status === 401 || status === 302 || status === 303;
    expect(isBlocked, `Expected auth block for member on create_invite, got ${status}`).toBe(true);
  });

  test('SEC-09 C: unit_admin user can access GET /manage_invites (positive control)', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.get(`${BASE_URL}/manage_invites`, {
        headers: { Cookie: adminSession.cookies },
        maxRedirects: 5,
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 502 || res.status() === 503) {
      test.skip(true, `Stack returned ${res.status()}`);
      return;
    }

    // Admin should get 200 (page loads)
    expect(res.status()).toBe(200);
  });
});
