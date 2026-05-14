// tests/e2e/_fixtures/teardown.ts
// Full implementation (Plan 01 was a partial scaffold; Plan 04 replaces it).
// Truncates all test data in reverse FK order.
// Preserves the applied schema (does not drop tables).
//
// Layer 5 (RLS) note: migration 0013 makes `shifts` connections automatically SET ROLE
// shifty_app (NOSUPERUSER, NOBYPASSRLS). shifty_app does NOT have TRUNCATE on the audit
// tables (REVOKE in migration 0010+0013 enforces append-only). Teardown needs superuser
// to wipe everything, so we issue `SET ROLE NONE` after connect — this returns to
// session_user = shifts which is still the bootstrap SUPERUSER.

import { Client } from 'pg';

const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

export async function teardownTestData(): Promise<void> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    // SET ROLE NONE returns to session_user (shifts), which remains the bootstrap SUPERUSER
    // (Postgres refuses to demote the bootstrap user — see migration 0013 header).
    // This is required so TRUNCATE works on audit tables that REVOKE TRUNCATE from shifty_app.
    await client.query('SET ROLE NONE');
    // Reverse FK order to avoid constraint violations.
    // RESTART IDENTITY resets sequences. CASCADE drops dependent rows automatically.
    // TRUNCATE as superuser bypasses RLS.
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
