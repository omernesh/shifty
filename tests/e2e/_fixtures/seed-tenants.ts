// tests/e2e/_fixtures/seed-tenants.ts
// Full implementation (Plan 01 was a scaffold; Plan 04 replaces it entirely).
// Seeds two independent tenants for cross-tenant isolation tests.
// Uses the `pg` package directly (not Lowdefy) — connects to localhost:5432.
// DDL never; only INSERT. Schema must already be applied via migrations.
//
// Layer 5 (RLS) note: migration 0013 makes `shifts` connections automatically SET ROLE
// shifty_app (NOSUPERUSER, NOBYPASSRLS). For seeding (multi-tenant inserts), we issue
// `SET ROLE NONE` after connect to return to session_user = shifts (the bootstrap SUPERUSER
// which bypasses RLS). This keeps the seed logic simple — set_config per tenant still
// scopes app.current_tenant correctly for the assertions in cross-tenant-leak.spec.ts.

import { Client } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

export interface TenantFixture {
  tenantId: string;
  orgUnitId: string;
  teamId: string;         // leaf org_unit for roster/soldier tests (Phase 2)
  adminEmail: string;
  adminUserId: string;    // app_user.id
  adminAuthUserId: string; // users.id (Auth.js)
  adminSoldierId: string;
  inviteCode: string;     // 8-char Crockford base32
  inviteCodeId: string;
  roleTagDriving: string; // role_tag.key = 'driving'
  roleTagComms: string;   // role_tag.key = 'comms'
  roleTagMedic: string;   // role_tag.key = 'medic'
}

/** Generates a random 8-character Crockford base32 string (AUTH-04 format). */
function crockford8(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % 32];
  return out;
}

async function seedOne(client: Client, label: 'A' | 'B'): Promise<TenantFixture> {
  const tenantId = randomUUID();
  const orgUnitId = randomUUID();
  const teamId = randomUUID();          // leaf team for Phase 2 roster tests
  const adminEmail = `admin-${label.toLowerCase()}@example.test`;
  const adminAuthUserId = randomUUID(); // users.id (Auth.js)
  const adminUserId = randomUUID();     // app_user.id
  const adminSoldierId = randomUUID();
  const inviteCodeId = randomUUID();
  const inviteCode = crockford8();

  // Set RLS context before each tenant's inserts.
  // set_config with false (not local) persists for the connection session — combined
  // with SET ROLE NONE in seedTwoTenants(), the shifts SUPERUSER session bypasses RLS for
  // INSERTs and the app.current_tenant is the same value that tests will assert against.
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

  await client.query(
    `INSERT INTO tenant (id, name, org_depth) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING`,
    [tenantId, `Test Tenant ${label}`]
  );
  await client.query(
    `INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES ($1, $2, NULL, 1, $3) ON CONFLICT (id) DO NOTHING`,
    [orgUnitId, tenantId, `Test Unit ${label}`]
  );
  // Insert Auth.js users row first (app_user.user_id FK references users.id)
  await client.query(
    `INSERT INTO "users" (id, name, email, "emailVerified") VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO NOTHING`,
    [adminAuthUserId, `admin-${label}`, adminEmail]
  );
  await client.query(
    `INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id) VALUES ($1, $2, $3, $4, 'he', $5) ON CONFLICT (id) DO NOTHING`,
    [adminUserId, tenantId, adminEmail, `Admin ${label}`, adminAuthUserId]
  );
  await client.query(
    `INSERT INTO soldier (id, tenant_id, user_id, display_name) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [adminSoldierId, tenantId, adminUserId, `Admin ${label} Soldier`]
  );
  await client.query(
    `INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role)
     VALUES ($1, $2, $3, $4, 'unit_admin')
     ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`,
    [randomUUID(), tenantId, adminSoldierId, orgUnitId]
  );
  await client.query(
    `INSERT INTO invite_code (id, tenant_id, code, org_unit_id, role, created_by)
     VALUES ($1, $2, $3, $4, 'member', $5)
     ON CONFLICT (id) DO NOTHING`,
    [inviteCodeId, tenantId, inviteCode, orgUnitId, adminUserId]
  );

  // Phase 2: Insert a leaf org_unit (team) for roster/soldier tests.
  // The leaf team is a child of the root org_unit and is used as team_id in CSV fixtures.
  await client.query(
    `INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES ($1, $2, $3, 2, $4) ON CONFLICT (id) DO NOTHING`,
    [teamId, tenantId, orgUnitId, `Test Team ${label}`]
  );

  // Phase 2: Insert 3 role_tag rows per tenant (driving, comms, medic).
  // These tags are referenced by CSV fixtures and soldier-crud tests.
  for (const key of ['driving', 'comms', 'medic']) {
    await client.query(
      `INSERT INTO role_tag (id, tenant_id, key, label) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, key) DO NOTHING`,
      [randomUUID(), tenantId, key, key]
    );
  }

  return {
    tenantId, orgUnitId, teamId, adminEmail, adminUserId, adminAuthUserId,
    adminSoldierId, inviteCode, inviteCodeId,
    roleTagDriving: 'driving', roleTagComms: 'comms', roleTagMedic: 'medic',
  };
}

export async function seedTwoTenants(): Promise<{ tenantA: TenantFixture; tenantB: TenantFixture }> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    // Migration 0013 makes shifts auto SET ROLE shifty_app on connect; reset to
    // session_user (shifts, still SUPERUSER per bootstrap rule) so seeding bypasses RLS.
    await client.query('SET ROLE NONE');
    const tenantA = await seedOne(client, 'A');
    const tenantB = await seedOne(client, 'B');
    return { tenantA, tenantB };
  } finally {
    await client.end();
  }
}

export interface SignInResult {
  sessionToken: string;
  userId: string;       // Auth.js users.id
  cookies: string;      // Cookie header value for Playwright request context
}

/**
 * Inserts a session row directly into the `sessions` table (bypassing the email link click).
 * Returns the cookie value that NextAuth would set after a successful magic-link callback.
 * Used for test speed — NOT a production attack surface.
 */
export async function signInAs(email: string): Promise<SignInResult> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    // SET ROLE NONE so the session insert works without RLS interference.
    // `sessions` is an Auth.js table, intentionally not RLS-protected, but the lookup
    // of users by email above is also unprotected and needs no tenant scope.
    await client.query('SET ROLE NONE');
    const userResult = await client.query<{ id: string }>(
      `SELECT id FROM "users" WHERE email = $1`,
      [email]
    );
    if (userResult.rows.length === 0) {
      throw new Error(`signInAs: no users row for email ${email}`);
    }
    const userId = userResult.rows[0].id;
    const sessionToken = randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO sessions (id, "sessionToken", "userId", expires)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [randomUUID(), sessionToken, userId]
    );
    // NextAuth default cookie name for HTTP: `next-auth.session-token`
    // (in HTTPS production: `__Secure-next-auth.session-token`).
    // Format: bare `name=value` only — Path/HttpOnly are Set-Cookie response attrs and
    // must NOT appear in a request Cookie header (some parsers reject the whole header).
    const cookies = `next-auth.session-token=${sessionToken}`;
    return { sessionToken, userId, cookies };
  } finally {
    await client.end();
  }
}

export function getTenantBIds(tenantB: TenantFixture): {
  soldiers: string[];
  windows: string[];    // empty in Phase 1 (no planning_window seeded)
  assignments: string[]; // empty in Phase 1
  orgUnits: string[];
  invites: string[];
  tenantId: string;
} {
  return {
    soldiers: [tenantB.adminSoldierId],
    windows: [],
    assignments: [],
    orgUnits: [tenantB.orgUnitId, tenantB.teamId],
    invites: [tenantB.inviteCodeId],
    tenantId: tenantB.tenantId,
  };
}
