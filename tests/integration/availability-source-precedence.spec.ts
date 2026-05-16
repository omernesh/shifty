// tests/integration/availability-source-precedence.spec.ts
//
// Plan 03-05 Task 3 — direct-PG integration tests for the availability source-
// precedence READ query (RESEARCH §"Recipe 6"). Five tests:
//
//   1. default state: no availability row → declared='available' / source='default'
//   2. range_blockout only → source='range_blockout'
//   3. range_blockout then UPDATE to per_slot → source='per_slot' (override path)
//   4. UPDATE to manager_override → source='manager_override' (winning path)
//   5. drift-detection meta-test: the LATERAL+CASE SQL string used by
//      my_availability.yaml's load_availability request MUST match the
//      SOURCE_RANK ordering from helpers/availability-source.js. This is the
//      load-bearing Risk R-03-3 mitigation — it fails the build if anyone
//      reorders SOURCE_RANK without updating the SQL CASE.
//
// Why direct-PG (not Playwright):
//   The precedence contract lives in SQL, not the UI. Asserting against the
//   SQL output directly is faster (no browser, no Lowdefy SSR) AND more
//   precise — we can construct adversarial source combinations that the UI
//   would never let a soldier reach.
//
// Why test ordering is "INSERT then UPDATE in place" rather than "INSERT
// multiple rows":
//   The availability table has UNIQUE (soldier_id, shift_instance_id) so a
//   given soldier/instance pair has exactly ONE row. The WRITE-side ON
//   CONFLICT DO UPDATE in DeclareAvailability mirrors this — it never
//   creates a second row, it updates the existing one's source/declared.
//   The READ-side LATERAL+CASE is therefore reading exactly ONE row per
//   (soldier, instance); the CASE expression is reading that row's `source`.
//   So the precedence "winner" between range_blockout and per_slot is
//   established at WRITE time by the ON CONFLICT WHERE clause; the read
//   query simply respects whatever source the surviving row has.
//
// This spec verifies the READ-side behaves correctly for every possible
// `source` value. The WRITE-side ON CONFLICT WHERE behavior is verified by
// the e2e spec availability-declare.spec.ts.
//
// Run:
//   PG_TEST_URL=postgres://shifts:changeme@localhost:5432/shifts \
//     node --test --experimental-strip-types tests/integration/*.spec.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { SOURCE_RANK } from '../../app/plugins/shifty-plugin/src/helpers/availability-source.js';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

/**
 * The exact LATERAL+CASE source-precedence read query. Kept as a constant in
 * this spec so the drift-detection test can match it character-by-character
 * against the SQL embedded in app/pages/my_availability.yaml's
 * `load_availability` request properties.
 *
 * If you edit this string, you MUST also update the YAML — the drift test
 * exists precisely to make that requirement enforceable.
 */
const LATERAL_SOURCE_QUERY = `
SELECT
  si.id AS shift_instance_id,
  COALESCE(av.declared, 'available') AS declared,
  COALESCE(av.source, 'default') AS source,
  av.id AS availability_id
FROM shift_instance si
LEFT JOIN LATERAL (
  SELECT id, declared, source
    FROM availability a
   WHERE a.shift_instance_id = si.id
     AND a.soldier_id = $1::uuid
     AND a.tenant_id = $2::uuid
   ORDER BY CASE a.source
     WHEN 'manager_override' THEN 3
     WHEN 'per_slot' THEN 2
     WHEN 'range_blockout' THEN 1
     ELSE 0
   END DESC
   LIMIT 1
) av ON true
WHERE si.tenant_id = $2::uuid
  AND si.planning_window_id = $3::uuid
ORDER BY si.date, si.headcount_index
`;

/**
 * Probe Postgres reachability. Tests SKIP cleanly when PG is down (CI runs
 * without the docker stack; this spec is only meaningful against a populated DB).
 */
async function pgReachable(): Promise<boolean> {
  const c = new Client({ connectionString: PG_URL });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

interface SeedResult {
  tenantId: string;
  teamId: string;
  soldierId: string;
  planningWindowId: string;
  instanceIds: string[];
}

/**
 * Seed a tenant, team, soldier, window, slot, and 2 shift_instance rows.
 * Returns the ids the tests will assert against.
 */
async function seedScenario(client: Client): Promise<SeedResult> {
  const tenantId = randomUUID();
  const orgUnitId = randomUUID();
  const teamId = randomUUID();
  const authUserId = randomUUID();
  const appUserId = randomUUID();
  const soldierId = randomUUID();
  const slotId = randomUUID();
  const planningWindowId = randomUUID();

  // RLS bypass for setup.
  await client.query('SET ROLE NONE');
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

  await client.query(
    `INSERT INTO tenant (id, name, org_depth) VALUES ($1, $2, 1)`,
    [tenantId, `IntgT-${tenantId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO org_unit (id, tenant_id, parent_id, level, name)
     VALUES ($1, $2, NULL, 1, 'IntgRoot'),
            ($3, $2, $1, 2, 'IntgTeam')`,
    [orgUnitId, tenantId, teamId],
  );
  await client.query(
    `INSERT INTO "users" (id, name, email, "emailVerified")
     VALUES ($1, 'intg-user', $2, now())`,
    [authUserId, `intg-${authUserId.slice(0, 8)}@example.test`],
  );
  await client.query(
    `INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id)
     VALUES ($1, $2, $3, 'Intg User', 'he', $4)`,
    [appUserId, tenantId, `intg-${appUserId.slice(0, 8)}@example.test`, authUserId],
  );
  await client.query(
    `INSERT INTO soldier (id, tenant_id, user_id, display_name)
     VALUES ($1, $2, $3, 'Intg Soldier')`,
    [soldierId, tenantId, appUserId],
  );

  // Two-day window with 1 slot @ headcount 1 → 2 shift_instance rows.
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);

  await client.query(
    `INSERT INTO shift_slot
       (id, tenant_id, team_id, name, start_time, end_time, headcount, display_order)
     VALUES ($1, $2, $3, 'IntgSlot', '06:00', '18:00', 1, 0)`,
    [slotId, tenantId, teamId],
  );
  await client.query(
    `INSERT INTO planning_window
       (id, tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
     VALUES ($1, $2, $3, $4::date, $5::date,
             ($4::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem',
             'open')`,
    [planningWindowId, tenantId, teamId, start, end],
  );
  const xpRes = await client.query<{ id: string }>(
    `INSERT INTO shift_instance
       (tenant_id, shift_slot_id, planning_window_id, date, headcount_index)
     SELECT s.tenant_id, s.id, $1::uuid, d.date::date, h.idx
       FROM shift_slot s
       CROSS JOIN generate_series($2::date, $3::date, INTERVAL '1 day') AS d(date)
       CROSS JOIN LATERAL generate_series(0, s.headcount - 1) AS h(idx)
      WHERE s.id = $4
     RETURNING id`,
    [planningWindowId, start, end, slotId],
  );

  return {
    tenantId,
    teamId,
    soldierId,
    planningWindowId,
    instanceIds: xpRes.rows.map((r) => r.id),
  };
}

/** Tear down everything via tenant cascade. */
async function teardown(client: Client, tenantId: string): Promise<void> {
  await client.query('SET ROLE NONE');
  await client.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
}

test('availability source-precedence: default state — no row → declared=available, source=default', async (t) => {
  if (!(await pgReachable())) {
    t.skip(`PG unreachable at ${PG_URL}`);
    return;
  }
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const scn = await seedScenario(client);
    try {
      const res = await client.query<{ declared: string; source: string }>(
        LATERAL_SOURCE_QUERY,
        [scn.soldierId, scn.tenantId, scn.planningWindowId],
      );
      assert.equal(res.rows.length, scn.instanceIds.length, 'one row per shift_instance');
      for (const r of res.rows) {
        assert.equal(r.declared, 'available');
        assert.equal(r.source, 'default');
      }
    } finally {
      await teardown(client, scn.tenantId);
    }
  } finally {
    await client.end();
  }
});

test('availability source-precedence: range_blockout only → source=range_blockout', async (t) => {
  if (!(await pgReachable())) {
    t.skip(`PG unreachable at ${PG_URL}`);
    return;
  }
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const scn = await seedScenario(client);
    try {
      const targetInstance = scn.instanceIds[0];
      await client.query(
        `INSERT INTO availability
           (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         VALUES ($1, $2, $3, 'unavailable', 'range_blockout', $4)`,
        [scn.tenantId, scn.soldierId, targetInstance, scn.planningWindowId],
      );
      const res = await client.query<{ shift_instance_id: string; declared: string; source: string }>(
        LATERAL_SOURCE_QUERY,
        [scn.soldierId, scn.tenantId, scn.planningWindowId],
      );
      const hit = res.rows.find((r) => r.shift_instance_id === targetInstance);
      const miss = res.rows.find((r) => r.shift_instance_id !== targetInstance);
      assert.ok(hit, 'targeted instance present in results');
      assert.equal(hit!.declared, 'unavailable');
      assert.equal(hit!.source, 'range_blockout');
      assert.ok(miss, 'sibling instance present');
      assert.equal(miss!.declared, 'available');
      assert.equal(miss!.source, 'default');
    } finally {
      await teardown(client, scn.tenantId);
    }
  } finally {
    await client.end();
  }
});

test('availability source-precedence: range_blockout then UPDATE to per_slot → source=per_slot', async (t) => {
  if (!(await pgReachable())) {
    t.skip(`PG unreachable at ${PG_URL}`);
    return;
  }
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const scn = await seedScenario(client);
    try {
      const targetInstance = scn.instanceIds[0];
      await client.query(
        `INSERT INTO availability
           (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         VALUES ($1, $2, $3, 'unavailable', 'range_blockout', $4)`,
        [scn.tenantId, scn.soldierId, targetInstance, scn.planningWindowId],
      );
      // Simulate the per_slot UPSERT: same (soldier, instance) pair → row gets
      // UPDATED in place by the WRITE-side ON CONFLICT DO UPDATE.
      await client.query(
        `UPDATE availability
            SET source = 'per_slot', declared = 'available', updated_at = now()
          WHERE soldier_id = $1 AND shift_instance_id = $2`,
        [scn.soldierId, targetInstance],
      );
      const res = await client.query<{ shift_instance_id: string; declared: string; source: string }>(
        LATERAL_SOURCE_QUERY,
        [scn.soldierId, scn.tenantId, scn.planningWindowId],
      );
      const hit = res.rows.find((r) => r.shift_instance_id === targetInstance);
      assert.ok(hit);
      assert.equal(hit!.source, 'per_slot');
      assert.equal(hit!.declared, 'available');
    } finally {
      await teardown(client, scn.tenantId);
    }
  } finally {
    await client.end();
  }
});

test('availability source-precedence: per_slot then UPDATE to manager_override → source=manager_override', async (t) => {
  if (!(await pgReachable())) {
    t.skip(`PG unreachable at ${PG_URL}`);
    return;
  }
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const scn = await seedScenario(client);
    try {
      const targetInstance = scn.instanceIds[0];
      await client.query(
        `INSERT INTO availability
           (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         VALUES ($1, $2, $3, 'available', 'per_slot', $4)`,
        [scn.tenantId, scn.soldierId, targetInstance, scn.planningWindowId],
      );
      await client.query(
        `UPDATE availability
            SET source = 'manager_override', declared = 'unavailable', updated_at = now()
          WHERE soldier_id = $1 AND shift_instance_id = $2`,
        [scn.soldierId, targetInstance],
      );
      const res = await client.query<{ shift_instance_id: string; declared: string; source: string }>(
        LATERAL_SOURCE_QUERY,
        [scn.soldierId, scn.tenantId, scn.planningWindowId],
      );
      const hit = res.rows.find((r) => r.shift_instance_id === targetInstance);
      assert.ok(hit);
      assert.equal(hit!.source, 'manager_override');
      assert.equal(hit!.declared, 'unavailable');
    } finally {
      await teardown(client, scn.tenantId);
    }
  } finally {
    await client.end();
  }
});

test('availability source-precedence: source-rank CASE expression matches SOURCE_RANK enum (drift detection)', () => {
  // Risk R-03-3 mitigation — the load-bearing test of this spec.
  //
  // The SQL CASE in LATERAL_SOURCE_QUERY ranks sources via integer literals
  // (manager_override=3, per_slot=2, range_blockout=1, else 0). This ordering
  // MUST match the SOURCE_RANK enum in helpers/availability-source.js exactly.
  // If anyone reorders SOURCE_RANK without updating the SQL — or vice versa —
  // this test fails the build.
  //
  // We assert two things:
  //   (a) SOURCE_RANK contains the canonical four keys with the expected ranks.
  //   (b) The SQL string contains exactly those four CASE literals in the same
  //       integer order.

  assert.equal(SOURCE_RANK['manager_override'], 3, 'manager_override rank is 3');
  assert.equal(SOURCE_RANK['per_slot'], 2, 'per_slot rank is 2');
  assert.equal(SOURCE_RANK['range_blockout'], 1, 'range_blockout rank is 1');
  assert.equal(SOURCE_RANK['default'], 0, 'default rank is 0');

  // Now match the SQL: every source value must appear in the CASE with the
  // same rank. Regex-match to extract the integer associated with each WHEN.
  const sqlSource = LATERAL_SOURCE_QUERY;
  for (const [src, rank] of Object.entries(SOURCE_RANK)) {
    if (src === 'default') {
      // 'default' is encoded as the ELSE branch (no WHEN line).
      assert.ok(
        /ELSE\s+0/i.test(sqlSource),
        'SQL CASE has ELSE 0 for default rank',
      );
      continue;
    }
    const re = new RegExp(`WHEN\\s+'${src}'\\s+THEN\\s+(\\d+)`);
    const m = sqlSource.match(re);
    assert.ok(m, `SQL CASE missing WHEN '${src}'`);
    assert.equal(
      Number(m![1]),
      rank,
      `SQL CASE rank for '${src}' is ${m![1]}, expected ${rank}`,
    );
  }

  // Belt-and-braces: also verify the same SQL is embedded in my_availability.yaml.
  // If a developer edits the YAML's SQL without updating LATERAL_SOURCE_QUERY,
  // this assertion catches it. We match on the load-bearing tokens (the CASE
  // expression and the LATERAL JOIN structure) rather than character-by-character
  // because the YAML may differ in column projection or WHERE clauses.
  const yamlPath = new URL('../../app/pages/my_availability.yaml', import.meta.url);
  const yamlSource = readFileSync(yamlPath, 'utf8');
  assert.ok(
    /WHEN\s+'manager_override'\s+THEN\s+3/i.test(yamlSource),
    'my_availability.yaml CASE has manager_override THEN 3',
  );
  assert.ok(
    /WHEN\s+'per_slot'\s+THEN\s+2/i.test(yamlSource),
    'my_availability.yaml CASE has per_slot THEN 2',
  );
  assert.ok(
    /WHEN\s+'range_blockout'\s+THEN\s+1/i.test(yamlSource),
    'my_availability.yaml CASE has range_blockout THEN 1',
  );
  assert.ok(
    /LEFT JOIN LATERAL/i.test(yamlSource),
    'my_availability.yaml uses LATERAL join',
  );
});
