// tests/e2e/_fixtures/teardown.ts
// Truncates all test data in reverse FK order.
// Preserves the applied schema (does not drop tables).
// Uses the `pg` package directly (not Lowdefy).

import { Client } from 'pg';

const PG_TEST_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

export async function teardownTestData(): Promise<void> {
  const client = new Client({ connectionString: PG_TEST_URL });
  await client.connect();
  try {
    // TRUNCATE in reverse FK order so constraint violations don't occur.
    // NextAuth tables first (depend on users), then domain tables.
    await client.query(`
      TRUNCATE TABLE
        membership,
        soldier,
        app_user,
        org_unit,
        sessions,
        accounts,
        verification_tokens,
        users,
        tenant
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
}
