// Run: node --test app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs
// Unit tests for AuditWrite request handler.
// These tests do NOT hit a real DB — they verify input validation and the
// actor-from-session invariant (D-08, T-02-01) at the unit level.
//
// Integration test (Plan 04 audit-writer.spec.ts) covers:
// - Test 1 happy path: AuditWrite succeeds and inserts a row into schedule_audit
//   (requires a live Postgres connection and Lowdefy page context)
// - Test 6 end-to-end: writing through the YAML page produces a schedule_audit row
//   TODO: implement in tests/e2e/audit-writer.spec.ts (Plan 04)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AuditWrite from '../src/connections/requests/AuditWrite.js';

// Test 1 (merged Tests 4+5 from behavior spec): static properties
test('schema requires to_state and connectionType is Knex', () => {
  assert.equal(AuditWrite.connectionType, 'Knex');
  assert.deepEqual(AuditWrite.schema.required, ['to_state']);
});

// Test 2: actor_user_id must come from session (never from properties)
test('throws when actor_user_id missing (unauthenticated)', async () => {
  await assert.rejects(
    () => AuditWrite({
      request: { user: undefined, properties: { to_state: 'test_mutation' } },
      connection: { client: 'pg' },
    }),
    /actor_user_id missing/
  );
});

// Test 3: to_state is required in properties
test('throws when to_state missing', async () => {
  await assert.rejects(
    () => AuditWrite({
      request: { user: { user_id: 'u1', tenant_id: 't1' }, properties: {} },
      connection: { client: 'pg' },
    }),
    /to_state is required/
  );
});
