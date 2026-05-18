// tools/test/check-bb-queries.test.mjs
// Node-test unit tests for the Layer-2 gate's parser logic.
// Run: `node --test tools/test/check-bb-queries.test.mjs`
//
// These tests focus on the parser primitives (`getDomainTables`,
// `validateQuery`, `TENANT_FILTER_PATTERN`, `EXEMPT_QUERIES`) and exercise the
// edge cases the gate must handle correctly:
//   - alias-prefixed tenant_id (s.tenant_id = …)
//   - AND-chain placement (WHERE active = TRUE AND tenant_id = …)
//   - tolerant whitespace around `::uuid` and `{{ Current User.shiftyTenantId }}`
//   - exemption beats validation
//   - non-domain-table queries are skipped
//   - framework tables (schema_migrations, account, etc.) are not in the set
//   - dropped tables (employees, shifts, …) are not in the set

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDomainTables,
  validateQuery,
  TENANT_FILTER_PATTERN,
  EXEMPT_QUERIES,
  isExempt,
} from '../check-bb-queries.mjs';

// ──────────────── EXEMPT_QUERIES ────────────────

test('EXEMPT_QUERIES contains the two W0-02 invite-redemption query names', () => {
  // WR-01 (2026-05-18): exemptions are now (app, name) tuples — match by .name
  // and assert the canonical dev app is the .app scope.
  const names = EXEMPT_QUERIES.map((e) => e.name);
  assert.ok(names.includes('resolveInviteCode_GetTenantId'));
  assert.ok(names.includes('insertAppUserOnInviteRedemption'));
  for (const e of EXEMPT_QUERIES) {
    assert.ok(typeof e.app === 'string' && e.app.length > 0, `exemption ${JSON.stringify(e)} must have .app`);
  }
});

// ──────────────── isExempt() ────────────────

test('isExempt matches on exact (app, name) tuple', () => {
  const list = [
    { app: 'app_A', name: 'resolveInviteCode_GetTenantId' },
    { app: 'app_A', name: 'insertAppUserOnInviteRedemption' },
  ];
  assert.strictEqual(isExempt('app_A', 'resolveInviteCode_GetTenantId', list), true);
  assert.strictEqual(isExempt('app_A', 'insertAppUserOnInviteRedemption', list), true);
});

test('isExempt does NOT match across apps (name collision in a different app)', () => {
  // The WR-01 scenario: a clone in app_B with the same name must not inherit
  // exempt status from app_A.
  const list = [{ app: 'app_A', name: 'resolveInviteCode_GetTenantId' }];
  assert.strictEqual(isExempt('app_B', 'resolveInviteCode_GetTenantId', list), false);
});

test('isExempt does NOT match on bare name match alone', () => {
  const list = [{ app: 'app_A', name: 'q1' }];
  assert.strictEqual(isExempt('', 'q1', list), false);
});

test('isExempt handles a malformed exempt list gracefully', () => {
  assert.strictEqual(isExempt('app_A', 'q1', null), false);
  assert.strictEqual(isExempt('app_A', 'q1', undefined), false);
  assert.strictEqual(isExempt('app_A', 'q1', 'not-an-array'), false);
});

// ──────────────── TENANT_FILTER_PATTERN regex ────────────────

test('TENANT_FILTER_PATTERN matches the canonical form verbatim', () => {
  assert.ok(TENANT_FILTER_PATTERN.test(
    `WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid`
  ));
});

test('TENANT_FILTER_PATTERN matches with alias prefix (s.tenant_id)', () => {
  assert.ok(TENANT_FILTER_PATTERN.test(
    `WHERE s.tenant_id = '{{ Current User.shiftyTenantId }}'::uuid`
  ));
});

test('TENANT_FILTER_PATTERN matches in the middle of an AND-chain', () => {
  assert.ok(TENANT_FILTER_PATTERN.test(
    `WHERE active = true AND tenant_id = '{{ Current User.shiftyTenantId }}'::uuid AND deleted_at IS NULL`
  ));
});

test('TENANT_FILTER_PATTERN tolerates extra whitespace', () => {
  assert.ok(TENANT_FILTER_PATTERN.test(
    `WHERE tenant_id  =  '{{  Current   User.shiftyTenantId  }}'  ::  uuid`
  ));
});

test('TENANT_FILTER_PATTERN does NOT match a plain tenant_id reference without the {{ }} binding', () => {
  assert.strictEqual(
    TENANT_FILTER_PATTERN.test(`WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid`),
    false,
  );
});

test('TENANT_FILTER_PATTERN does NOT match a literal string without ::uuid cast', () => {
  assert.strictEqual(
    TENANT_FILTER_PATTERN.test(`WHERE tenant_id = '{{ Current User.shiftyTenantId }}'`),
    false,
  );
});

// ──────────────── getDomainTables() ────────────────

test('getDomainTables returns a non-empty set', () => {
  const tables = getDomainTables();
  assert.ok(tables instanceof Set);
  assert.ok(tables.size >= 15, `expected ≥15 domain tables, got ${tables.size}`);
});

test('getDomainTables includes core Phase-2/3 domain tables', () => {
  const tables = getDomainTables();
  for (const t of [
    'tenant', 'org_unit', 'soldier', 'shift_slot', 'planning_window',
    'shift_instance', 'availability', 'assignment', 'swap_request',
    'notification_log', 'role_tag', 'solver_run',
  ]) {
    assert.ok(tables.has(t), `expected domain table "${t}" in the set`);
  }
});

test('getDomainTables excludes framework / internal tables', () => {
  const tables = getDomainTables();
  for (const t of [
    'schema_migrations',
    'account', 'accounts',
    'session', 'sessions',
    'verification_token', 'verification_tokens',
    'users',
    'availability_legacy',
  ]) {
    assert.ok(!tables.has(t), `framework table "${t}" should NOT be in the domain set`);
  }
});

test('getDomainTables excludes Phase-0 bootstrap tables dropped in 0008', () => {
  const tables = getDomainTables();
  for (const t of ['employees', 'shifts', 'assignments', 'time_clock_entries']) {
    assert.ok(!tables.has(t), `dropped Phase-0 table "${t}" should NOT be in the domain set`);
  }
});

// ──────────────── validateQuery() ────────────────

const DOMAIN = new Set(['soldier', 'shift_instance', 'tenant']);
const EXEMPT = new Set(['resolveInviteCode_GetTenantId', 'insertAppUserOnInviteRedemption']);

test('validateQuery flags a domain-table SELECT missing the tenant filter', () => {
  const r = validateQuery(
    { name: 'q1', fields: { sql: 'SELECT id FROM soldier' } },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, true);
  assert.match(r.reason, /missing tenant_id filter/);
});

test('validateQuery accepts the canonical filter form', () => {
  const r = validateQuery(
    {
      name: 'q2',
      fields: { sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid" },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery accepts alias-prefixed tenant_id (s.tenant_id)', () => {
  const r = validateQuery(
    {
      name: 'q3',
      fields: {
        sql: `SELECT s.id FROM soldier s JOIN org_unit o ON o.id = s.org_unit_id WHERE s.tenant_id = '{{ Current User.shiftyTenantId }}'::uuid`,
      },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery accepts the filter mid-AND-chain', () => {
  const r = validateQuery(
    {
      name: 'q4',
      fields: {
        sql: `SELECT id FROM soldier WHERE active = TRUE AND tenant_id = '{{ Current User.shiftyTenantId }}'::uuid AND deleted_at IS NULL`,
      },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery does NOT flag a non-domain-table query (SELECT NOW())', () => {
  const r = validateQuery(
    { name: 'q5', fields: { sql: 'SELECT NOW()' } },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
  assert.match(r.reason, /no domain table referenced/);
});

test('validateQuery does NOT flag a query against schema_migrations (not in DOMAIN set)', () => {
  const r = validateQuery(
    { name: 'q6', fields: { sql: 'SELECT version FROM schema_migrations' } },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
  assert.match(r.reason, /no domain table referenced/);
});

test('validateQuery exempts a query whose exact name is in EXEMPT_QUERIES', () => {
  // Use a "bad" SQL that would otherwise be flagged
  const r = validateQuery(
    {
      name: 'resolveInviteCode_GetTenantId',
      fields: { sql: 'SELECT tenant_id, role FROM invite_code WHERE code = {{ params.code }}' },
    },
    new Set(['invite_code']),
    EXEMPT,
  );
  assert.strictEqual(r.violation, false);
  assert.strictEqual(r.reason, 'exempt');
});

test('validateQuery exempt is exact-match (no prefix bypass)', () => {
  // A name that PREFIXES an exempt name must not be exempted
  const r = validateQuery(
    {
      name: 'resolveInviteCode_GetTenantIdEvil',
      fields: { sql: 'SELECT * FROM soldier' },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, true);
});

test('validateQuery skips a query with no SQL body (REST/Mongo datasource)', () => {
  const r = validateQuery({ name: 'restQuery', fields: {} }, DOMAIN, EXEMPT);
  assert.strictEqual(r.violation, false);
  assert.match(r.reason, /no SQL body/);
});

test('validateQuery skips a query with an empty SQL body', () => {
  const r = validateQuery(
    { name: 'emptySql', fields: { sql: '   \n  ' } },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
  assert.match(r.reason, /no SQL body/);
});

test('validateQuery handles INSERT against a domain table with the binding in VALUES', () => {
  // INSERT with the {{ Current User.shiftyTenantId }} binding embedded directly — would pass
  // (the gate is heuristic; it matches the canonical pattern wherever it appears in the SQL).
  // Use the canonical form to confirm; bare INSERT…VALUES without the binding is flagged.
  const bad = validateQuery(
    {
      name: 'insertBad',
      fields: { sql: `INSERT INTO soldier (id, display_name) VALUES (gen_random_uuid(), 'x')` },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(bad.violation, true);

  const good = validateQuery(
    {
      name: 'insertGood',
      fields: {
        sql: `INSERT INTO soldier (id, tenant_id, display_name) SELECT gen_random_uuid(), tenant_id, 'x' FROM tenant WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid`,
      },
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(good.violation, false);
});

test('validateQuery gracefully handles a malformed query object', () => {
  assert.strictEqual(validateQuery(null, DOMAIN, EXEMPT).violation, false);
  assert.strictEqual(validateQuery(undefined, DOMAIN, EXEMPT).violation, false);
  assert.strictEqual(validateQuery('string', DOMAIN, EXEMPT).violation, false);
});

// ──────────────── validateQuery — WR-07 transformer check ────────────────

test('validateQuery flags a non-default transformer even with the canonical filter (WR-07)', () => {
  const r = validateQuery(
    {
      name: 'transformerBad',
      fields: { sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid" },
      transformer: 'return data.map(r => ({ ...r, tenant_id: "leaked" }))',
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, true);
  assert.match(r.reason, /non-trivial transformer/);
});

test('validateQuery accepts the canonical default transformer ("return data") (WR-07)', () => {
  const r = validateQuery(
    {
      name: 'transformerDefault',
      fields: { sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid" },
      transformer: 'return data',
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery accepts an empty-string transformer as default (WR-07)', () => {
  const r = validateQuery(
    {
      name: 'transformerEmpty',
      fields: { sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid" },
      transformer: '',
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery accepts a "return data" transformer with surrounding whitespace (WR-07)', () => {
  const r = validateQuery(
    {
      name: 'transformerPadded',
      fields: { sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid" },
      transformer: '  return data  \n',
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
});

test('validateQuery does NOT trip the transformer check when SQL has no domain table (WR-07)', () => {
  // Transformer-only queries that don't touch domain tables (e.g., REST
  // datasource glue) should still skip via the "no domain table" path.
  const r = validateQuery(
    {
      name: 'transformerNonDomain',
      fields: { sql: 'SELECT NOW()' },
      transformer: 'return data.map(r => r)',
    },
    DOMAIN, EXEMPT,
  );
  assert.strictEqual(r.violation, false);
  assert.match(r.reason, /no domain table referenced/);
});

// ──────────────── validateQuery — WR-01 (app, name) tuple scoping ────────────────

test('validateQuery exempts only when appId matches the exemption tuple (WR-01)', () => {
  const tupleList = [{ app: 'app_A', name: 'resolveInviteCode_GetTenantId' }];
  const goodSqlForExemptName = 'SELECT tenant_id FROM invite_code WHERE code = {{ params.code }}';

  // Same app → exempt
  const inApp = validateQuery(
    { name: 'resolveInviteCode_GetTenantId', fields: { sql: goodSqlForExemptName } },
    new Set(['invite_code']),
    tupleList,
    'app_A',
  );
  assert.strictEqual(inApp.violation, false);
  assert.strictEqual(inApp.reason, 'exempt');

  // Different app → NOT exempt (must validate against the regular rules)
  const otherApp = validateQuery(
    { name: 'resolveInviteCode_GetTenantId', fields: { sql: 'SELECT * FROM soldier' } },
    DOMAIN,
    tupleList,
    'app_B',
  );
  assert.strictEqual(otherApp.violation, true);
  assert.match(otherApp.reason, /missing tenant_id filter/);
});
