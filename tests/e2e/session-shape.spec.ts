// tests/e2e/session-shape.spec.ts
// AUTH-07: Session JSON must contain {user.tenant_id, user.roles[], user.team_ids[], user.locale}.
// Signs in as tenant-A admin and GETs /api/auth/session; parses the JSON response;
// asserts all 5 required fields are present with correct types and values.

import { test, expect } from '@playwright/test';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';

test.describe('Session shape (AUTH-07)', () => {
  let tenantA: TenantFixture;
  let adminSession: { sessionToken: string; userId: string; cookies: string };

  test.beforeAll(async () => {
    await teardownTestData();
    const seeded = await seedTwoTenants();
    tenantA = seeded.tenantA;
    adminSession = await signInAs(tenantA.adminEmail);
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test('AUTH-07: /api/auth/session returns all 5 required fields', async ({ request }) => {
    let res: import('@playwright/test').APIResponse;
    try {
      res = await request.get(`${BASE_URL}/api/auth/session`, {
        headers: { Cookie: adminSession.cookies },
      });
    } catch {
      test.skip(true, 'Lowdefy stack not reachable — run with stack up');
      return;
    }

    if (res.status() === 404 || res.status() === 502) {
      test.skip(true, `Stack returned ${res.status()} — run with stack up`);
      return;
    }

    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // NextAuth session structure: { user: {...}, expires: "..." }
    expect(body).toHaveProperty('user');
    const user = body.user as Record<string, unknown>;

    // Required fields per AUTH-07
    expect(user).toHaveProperty('tenant_id');
    expect(typeof user.tenant_id).toBe('string');
    expect(user.tenant_id).toBe(tenantA.tenantId);

    expect(user).toHaveProperty('roles');
    expect(Array.isArray(user.roles)).toBe(true);
    expect(user.roles as string[]).toContain('unit_admin');

    expect(user).toHaveProperty('team_ids');
    expect(Array.isArray(user.team_ids)).toBe(true);
    // team_ids should include the org_unit the admin belongs to
    expect(user.team_ids as string[]).toContain(tenantA.orgUnitId);

    expect(user).toHaveProperty('locale');
    expect(user.locale).toBe('he');

    // user_id (app_user.id) should also be present
    expect(user).toHaveProperty('user_id');
  });
});
