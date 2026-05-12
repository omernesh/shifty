// tests/e2e/_fixtures/teardown.ts
// Full implementation (Plan 01 was a partial scaffold; Plan 04 replaces it).
// Truncates all test data in reverse FK order.
// Preserves the applied schema (does not drop tables).
// TRUNCATE bypasses RLS (it's DDL-adjacent, not DML) — no need to set app.current_tenant.

import { Client } from 'pg';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

export async function teardownTestData(): Promise<void> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    // Reverse FK order to avoid constraint violations.
    // RESTART IDENTITY resets sequences. CASCADE drops dependent rows automatically.
    // Tables that may not exist in all migration states are listed but protected by CASCADE.
    await client.query(`
      TRUNCATE TABLE
        invite_code_redemption,
        schedule_audit,
        solver_run,
        notification_log,
        roster_import_log,
        swap_request,
        assignment,
        availability,
        rule_override,
        rule,
        shift_instance,
        planning_window,
        shift_slot,
        ical_subscription_token,
        push_subscription,
        report_recipient,
        notification_pref,
        invite_code,
        membership,
        soldier,
        app_user,
        org_unit,
        tenant,
        sessions,
        accounts,
        verification_tokens,
        "users"
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
}
