// tests/e2e/_fixtures/seed-tenants.ts
// Full implementation (Plan 01 was a scaffold; Plan 04 replaces it entirely).
// Seeds two independent tenants for cross-tenant isolation tests.
// Uses the `pg` package directly (not Lowdefy) — connects to localhost:5432.
// DDL never; only INSERT. Schema must already be applied via migrations.
//
// Layer 5 (RLS) note: migration 0013 makes `shifts` connections automatically SET ROLE
// shifty_app (NOSUPERUSER, NOBYPASSRLS). For seeding (multi-tenant inserts), we issue
// `SET ROLE NONE` after connect to return to session_user = shifts (the bootstrap
// SUPERUSER which cannot be demoted) for the seeding path. `RESET ROLE` is NOT
// equivalent — it would reset to the default-role set by ALTER ROLE, which is
// shifty_app, so RESET ROLE has no effect for our purposes.
//
// NextAuth secure-cookie naming: when NEXTAUTH_URL begins with `https://` (as it does
// in the hpg5 deployment — `https://apps.nesher.co`), Auth.js uses the `__Secure-`
// prefix on the session-token cookie name. The Cookie header sent by tests must match
// that name even when the test traffic itself goes over plain HTTP (the Cloudflare
// Tunnel terminates HTTPS upstream; the container side sees HTTP but Auth.js still
// uses secure-cookie naming based on the configured NEXTAUTH_URL). Tests use
// `__Secure-next-auth.session-token=<token>` as the Cookie header; Playwright's
// addCookies in page tests must also use that name with `secure: true`.

import { Client } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

/** NextAuth session-token cookie name in HTTPS deployments (the hpg5 default). */
export const SESSION_COOKIE_NAME = '__Secure-next-auth.session-token';

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
  // with SET ROLE NONE in seedTwoTenants(), the shifts SUPERUSER session bypasses RLS
  // for INSERTs and the app.current_tenant is the same value that tests will assert
  // against in cross-tenant-leak.spec.ts (direct-pg path).
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
    // Migration 0013 makes shifts auto SET ROLE shifty_app on connect; SET ROLE NONE
    // switches to session_user (shifts, still SUPERUSER per bootstrap rule) so seeding
    // bypasses RLS. (RESET ROLE does NOT work here — it resets to the ALTER ROLE default
    // which is shifty_app.)
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
 *
 * Cookie format: `__Secure-next-auth.session-token=<token>`. The `__Secure-` prefix is
 * required because NEXTAUTH_URL is HTTPS (`https://apps.nesher.co`); Auth.js refuses
 * to recognize the bare `next-auth.session-token` cookie name when useSecureCookies is
 * active. The cookie name is exported as SESSION_COOKIE_NAME for page-context cookie
 * setup in cross-tenant-leak.spec.ts.
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
    // Format: bare `name=value` only — Path/HttpOnly are Set-Cookie response attrs and
    // must NOT appear in a request Cookie header (some parsers reject the whole header).
    // The `__Secure-` prefix matches Auth.js's useSecureCookies=true behavior for
    // https NEXTAUTH_URL deployments.
    const cookies = `${SESSION_COOKIE_NAME}=${sessionToken}`;
    return { sessionToken, userId, cookies };
  } finally {
    await client.end();
  }
}

/**
 * Plan 03-05 — populated planning_window fixture for availability-declare tests.
 *
 * Creates a complete window: N shift_slot rows (default 2, headcount=1 each) +
 * 1 planning_window with state='open' + the cross-product shift_instance rows
 * via INSERT…SELECT (mirrors OpenPlanningWindow's CROSS JOIN LATERAL pattern).
 *
 * Uses SET ROLE NONE to bypass RLS for seeding (same pattern as seedOne above).
 *
 * @param tenantId  Tenant id to seed into.
 * @param teamId    Team (leaf org_unit) under tenantId.
 * @param options   Optional overrides:
 *                  - startDate / endDate: ISO YYYY-MM-DD (default: today → today+13)
 *                  - lockTs:    ISO TIMESTAMPTZ for constraint_lock_at
 *                               (default: start − 3 days at 23:59 Asia/Jerusalem)
 *                  - slotCount: number of shift_slot rows (default 2)
 *                  - headcount: per-slot headcount (default 1)
 *                  - state:     planning_window state (default 'open')
 *
 * Returns:
 *   { planningWindowId, slotIds: string[], instanceIds: string[] }
 *
 * Test usage:
 *   const { planningWindowId, slotIds, instanceIds } =
 *     await seedFullWindow(tenantA.tenantId, tenantA.teamId);
 *
 * REPLACES the ad-hoc seedShiftSlots+planning_window inline inserts in
 * planning-window-open.spec.ts (Plan 03-04). That spec's helpers are kept as
 * a more narrow tool (no shift_instance cross-product); availability tests
 * need the cross-product because their assertions hit per-instance rows.
 */
export interface SeedFullWindowResult {
  planningWindowId: string;
  slotIds: string[];
  instanceIds: string[];
  startDate: string;
  endDate: string;
}

export async function seedFullWindow(
  tenantId: string,
  teamId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    lockTs?: string | null;
    slotCount?: number;
    headcount?: number;
    state?: string;
  },
): Promise<SeedFullWindowResult> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query('SET ROLE NONE');
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

    const slotCount = options?.slotCount ?? 2;
    const headcount = options?.headcount ?? 1;
    const state = options?.state ?? 'open';

    // Default dates: today → today + 13 days (14-day inclusive window).
    const today = new Date();
    const isoDate = (offset: number): string => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const startDate = options?.startDate ?? isoDate(0);
    const endDate = options?.endDate ?? isoDate(13);

    // Seed N shift_slot rows with headcount=1 each (display_order = i).
    const slotIds: string[] = [];
    for (let i = 0; i < slotCount; i++) {
      const slotId = randomUUID();
      slotIds.push(slotId);
      await client.query(
        `INSERT INTO shift_slot
           (id, tenant_id, team_id, name, start_time, end_time, headcount, display_order)
         VALUES ($1, $2, $3, $4, '06:00', '18:00', $5, $6)
         ON CONFLICT DO NOTHING`,
        [slotId, tenantId, teamId, `Slot ${i + 1}`, headcount, i],
      );
    }

    // Seed planning_window. lock_at default: (start - 3d) at 23:59 Asia/Jerusalem.
    const planningWindowId = randomUUID();
    if (options?.lockTs === undefined) {
      // Default: server-side computed expression.
      await client.query(
        `INSERT INTO planning_window
           (id, tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
         VALUES ($1, $2, $3, $4::date, $5::date,
                 ($4::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem',
                 $6)
         ON CONFLICT DO NOTHING`,
        [planningWindowId, tenantId, teamId, startDate, endDate, state],
      );
    } else {
      // Explicit lock_ts (may be null for no lock or a past timestamp for tests).
      await client.query(
        `INSERT INTO planning_window
           (id, tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
         VALUES ($1, $2, $3, $4::date, $5::date, $6::timestamptz, $7)
         ON CONFLICT DO NOTHING`,
        [planningWindowId, tenantId, teamId, startDate, endDate, options.lockTs, state],
      );
    }

    // Materialize the cross-product. Same pattern as OpenPlanningWindow.
    const xpRes = await client.query<{ id: string }>(
      `INSERT INTO shift_instance
         (tenant_id, shift_slot_id, planning_window_id, date, headcount_index)
       SELECT s.tenant_id, s.id, $1::uuid, d.date::date, h.idx
         FROM shift_slot s
         CROSS JOIN generate_series($2::date, $3::date, INTERVAL '1 day') AS d(date)
         CROSS JOIN LATERAL generate_series(0, s.headcount - 1) AS h(idx)
        WHERE s.tenant_id = $4
          AND s.team_id = $5
          AND s.id = ANY($6::uuid[])
       RETURNING id`,
      [planningWindowId, startDate, endDate, tenantId, teamId, slotIds],
    );
    const instanceIds = xpRes.rows.map((r) => r.id);

    return { planningWindowId, slotIds, instanceIds, startDate, endDate };
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
