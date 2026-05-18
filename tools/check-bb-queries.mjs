#!/usr/bin/env node
// tools/check-bb-queries.mjs
// Layer-2 CI gate for Budibase-mediated queries (post-pivot top defense per
// BUDIBASE-CONVENTIONS.md §2 — Layer 5 RLS no longer fires for Builder UI
// clients because Budibase connects as superuser-equivalent, so Layer 2
// — every Query MUST embed a tenant filter — is the new top defense).
//
// What this script does
// ---------------------
// 1. Default mode (no flags):
//    - Reads Builder UI Queries via the Budibase Public API.
//    - For every Query whose SQL body references a domain table, asserts that
//      the canonical filter pattern  `WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid`
//      is present somewhere in the SQL.
//    - Skips queries whose name is in EXEMPT_QUERIES.
//    - If BUDIBASE_API_KEY is unset or the API is unreachable, warns and exits 0
//      so contributors without hpg5 access still pass `npm test`.
// 2. --self-test:
//    - Builds 3 synthetic queries (one bad, one good, one exempt) and feeds them
//      to the in-process `validateQuery()` function.
//    - Proves the validator is alive without needing the live API.
// 3. --list-domain-tables:
//    - Prints the sorted list of domain table names derived from `db/migrations/`.
//
// Domain table discovery
// ----------------------
// `getDomainTables()` parses every `db/migrations/*.up.sql` file, collects
// `CREATE TABLE` names, removes any that a later migration `DROP TABLE`d, and
// subtracts a hard-coded framework/internal exclusion list (Auth.js stragglers,
// `schema_migrations`, etc.). The list automatically picks up tables added in
// future migrations — no gate edit needed.
//
// Exemption mechanism (per D-03)
// ------------------------------
// EXEMPT_QUERIES is an inline constant at the top of this file. Adding a new
// exemption is a 1-line PR diff the reviewer can audit. Exemption is exact-match
// on query name — no prefix matching (that would let a future
// `resolveInviteCode_GetTenantIdEvil` slip through).
//
// Exit codes
// ----------
//   0  — all clear, or API unreachable (skip + warn)
//   1  — violations found
//   2  — configuration error (API key rejected, etc.)

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'db', 'migrations');

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

// Canonical filter pattern per BUDIBASE-CONVENTIONS.md §3:
//   WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid
//
// NOTE on field name: we deliberately use `shiftyTenantId` (NOT `tenantId`) to avoid a
// collision with Budibase's own built-in `tenantId` field on user docs (it holds the
// Budibase workspace tenant, e.g. "default" in CE single-tenant mode, and is used by
// Budibase for its own request routing). Shifty's domain tenancy uses `shiftyTenantId`,
// a schemaless custom field populated by the W0-02 invite-redemption Automation.
// Tolerant regex:
//   - allows optional alias prefix (e.g., `s.tenant_id`)
//   - allows whitespace variance around `=`, around `::`, around `{{ }}`
//   - case-insensitive
//   - does NOT require WHERE on the same line (placement in an AND-chain is fine)
//
// ASSUMPTION (WR-07 note, 2026-05-18):
//   Queries MUST use the canonical literal binding `{{ Current User.shiftyTenantId }}`.
//   The gate does NOT recognise template-constructed bindings such as
//   `{{ "Current" + " User.shiftyTenantId" }}` — those would still resolve in
//   Budibase's Handlebars engine but the regex won't match, so the gate flags
//   them as missing the filter. This is intentional: gate authors should use
//   the canonical form, full stop. Document the canonical form in
//   docs/BUDIBASE-CONVENTIONS.md §3 and reject PRs that template-construct
//   the binding name in review.
export const TENANT_FILTER_PATTERN =
  /\b(?:\w+\.)?tenant_id\s*=\s*'\s*\{\{\s*Current\s+User\.shiftyTenantId\s*\}\}\s*'\s*::\s*uuid/i;

// Per D-03: inline whitelist. PR-visible diff is the audit trail.
//
// WR-01 fix (2026-05-18): each exemption is scoped to an (app, name) tuple.
// Previously this list was a flat array of bare query names; a malicious
// clone of an exempt query in a second Budibase app would silently inherit
// exempt status. Now an exemption must specify both the Builder app ID and
// the exact query name.
//
// SEED EXEMPTIONS (from W0-02 invite-redemption Automation):
//   resolveInviteCode_GetTenantId   — CANNOT filter on tenant_id (the query RESOLVES it from invite code)
//   insertAppUserOnInviteRedemption — CREATES the tenant-bound row; no filter applicable
// The app ID below pins these to the canonical dev workspace; clones in
// other apps must add their own exemption row with explicit reason.
// Add new exemptions one line at a time with a 1-line reason comment.
export const EXEMPT_QUERIES = [
  { app: 'app_dev_169e766804934fd18f2e20200d8fd22d', name: 'resolveInviteCode_GetTenantId' },     // W0-02: resolves tenant_id from invite code (CANNOT filter)
  { app: 'app_dev_169e766804934fd18f2e20200d8fd22d', name: 'insertAppUserOnInviteRedemption' },   // W0-02: creates the tenant-bound row (no filter applicable)
  { app: 'app_dev_169e766804934fd18f2e20200d8fd22d', name: 'shift-slot-create' },                 // W1-01: INSERT — tenant_id is written into the VALUES clause from {{ Current User.shiftyTenantId }}, no filterable column applies
];

/**
 * Decide whether a (appId, queryName) tuple matches an entry in EXEMPT_QUERIES.
 * Exported so the unit tests can exercise the matcher directly.
 *
 * @param {string} appId
 * @param {string} queryName
 * @param {Array<{app: string, name: string}>} exemptList
 * @returns {boolean}
 */
export function isExempt(appId, queryName, exemptList) {
  if (!Array.isArray(exemptList)) return false;
  return exemptList.some((e) => e && e.app === appId && e.name === queryName);
}

// Framework / internal tables that should NEVER be gated. These are NOT business
// data — `schema_migrations` is golang-migrate's own state; the Auth.js tables
// (account/session/verification_token/users + the legacy snake_case variants)
// were used in the Lowdefy era and may or may not have been dropped by 0008 — be
// defensive and exclude them regardless. `availability_legacy` was renamed and
// dropped (see 0004 → 0008).
const FRAMEWORK_TABLES = new Set([
  'schema_migrations',
  // Auth.js (NextAuth) tables — Phase 1 era; Budibase replaces these
  'account',
  'accounts',
  'session',
  'sessions',
  'verification_token',
  'verification_tokens',
  'verificationtoken',
  'users',
  // Phase 1 legacy that 0008 dropped (defensive even if DROP TABLE parsing catches it)
  'availability_legacy',
  // Phase-0 bootstrap tables dropped in 0008
  'employees',
  'shifts',
  'assignments',
  'time_clock_entries',
]);

// API endpoint config (used by main_default). Declared before the dispatch
// because TDZ rules mean `const` is not hoisted and the dispatch block runs
// at module-evaluation time.
const DEFAULT_API_URL = 'http://hpg5:8080';
const REQUEST_TIMEOUT_MS = 15000;

// CLI dispatch (gated so unit tests can `import` this module without executing main).
// WR-09 fix (2026-05-18): use exact resolved-path equality (Windows path is
// case-insensitive). Replaces the prior endsWith heuristic which could
// false-positive on suffix-matching siblings (e.g., `check-bb-queries.mjs.bak`).
function isMainModule() {
  if (!process.argv[1]) return false;
  // import.meta.url is always a file:// URL; fileURLToPath handles Windows %20
  // decoding + drive-letter normalisation. Resolve both paths so relative
  // process.argv[1] (e.g. `tools/check-bb-queries.mjs`) is compared against an
  // absolute import.meta path on equal footing.
  const metaPath = resolvePath(fileURLToPath(import.meta.url));
  const argPath = resolvePath(process.argv[1]);
  // Case-insensitive comparison because Windows is case-insensitive at the FS
  // level and macOS HFS+ is too by default. Linux is case-sensitive but the
  // path equality still holds.
  return metaPath.toLowerCase() === argPath.toLowerCase();
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (args.includes('--list-domain-tables')) {
    main_listDomainTables();
  } else if (args.includes('--self-test')) {
    main_selfTest();
  } else {
    main_default().catch((err) => {
      console.error(`check-bb-queries: unexpected error: ${err?.stack ?? err}`);
      process.exit(2);
    });
  }
}

// ─────────────────────────────────────────────
// DOMAIN TABLE EXTRACTION
// ─────────────────────────────────────────────

/**
 * Parse `db/migrations/*.up.sql` and return the Set of domain table names.
 *
 * Algorithm:
 *   1. Read all *.up.sql files in numerical order.
 *   2. For each file, collect CREATE TABLE matches → add to set.
 *   3. For each file, collect DROP TABLE matches → remove from set.
 *   4. Subtract FRAMEWORK_TABLES.
 *
 * @param {string} [migrationsDir] — override for tests
 * @returns {Set<string>}
 */
export function getDomainTables(migrationsDir = MIGRATIONS_DIR) {
  const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
  // WR-08 fix (2026-05-18): match the entire table-list payload of DROP TABLE
  // (everything up to the terminating semicolon) so the comma-separated form
  // `DROP TABLE foo, bar, baz;` removes ALL three names instead of just `foo`.
  // The capture group keeps a CASCADE/RESTRICT modifier outside; we strip it
  // when splitting on commas below.
  const dropMultiPattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;

  if (!existsSync(migrationsDir)) {
    throw new Error(`migrations directory not found: ${migrationsDir}`);
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.up.sql'))
    .sort(); // numerical order via lexical sort because of zero-padding (0001..0014)

  const tables = new Set();

  for (const f of files) {
    const content = readFileSync(join(migrationsDir, f), 'utf-8');

    // WR-08 fix: strip BOTH block (`/* ... */`) AND line (`-- …`) comments so
    // a commented-out CREATE TABLE or DROP TABLE doesn't pollute the set.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');

    for (const m of stripped.matchAll(createPattern)) {
      tables.add(m[1].toLowerCase());
    }
    for (const m of stripped.matchAll(dropMultiPattern)) {
      // The capture is the entire table-list before the semicolon. Split on
      // commas, drop a trailing CASCADE/RESTRICT modifier (these live in the
      // last element only), and normalise each name (lowercase + strip
      // `public.` prefix + strip quotes).
      const rawList = m[1].replace(/\b(CASCADE|RESTRICT)\b/gi, '').trim();
      const names = rawList.split(',')
        .map((s) => s.trim()
          .replace(/^public\./i, '')
          .replace(/^"|"$/g, '')
          .toLowerCase()
        )
        .filter((n) => /^\w+$/.test(n)); // only well-formed identifiers
      for (const n of names) tables.delete(n);
    }
  }

  // Subtract framework/internal tables
  for (const t of FRAMEWORK_TABLES) tables.delete(t);

  return tables;
}

// ─────────────────────────────────────────────
// QUERY VALIDATION (placeholder — full impl in Task 2)
// ─────────────────────────────────────────────

/**
 * Decide whether a single query should be flagged as a Layer-2 violation.
 *
 * @param {{ name: string, fields?: { sql?: string }, _id?: string, transformer?: string }} query
 * @param {Set<string>} domainTables
 * @param {Array<{app: string, name: string}>} exemptList — tuple-scoped exemptions
 * @param {string} [appId] — Builder app ID owning this query (used for exemption matching).
 *                          Defaults to '' so unit tests can still pass a query-name-only Set
 *                          via the legacy code path (see backwards-compat shim below).
 * @returns {{ violation: boolean, reason?: string, table?: string }}
 */
export function validateQuery(query, domainTables, exemptList, appId = '') {
  if (!query || typeof query !== 'object') {
    return { violation: false, reason: 'not a query object' };
  }

  // Backwards-compat: tests historically passed a `Set` of query names as the
  // third argument. Translate that into a per-app exemption list keyed on the
  // current appId so existing tests keep their semantics.
  let exemptions;
  if (exemptList instanceof Set) {
    exemptions = Array.from(exemptList).map((name) => ({ app: appId, name }));
  } else {
    exemptions = exemptList;
  }

  // Skip exempt queries — tuple match on (appId, query.name)
  if (isExempt(appId, query.name, exemptions)) {
    return { violation: false, reason: 'exempt' };
  }

  // Skip queries without a SQL body (e.g., REST/Mongo/transformer queries)
  const sql = query?.fields?.sql;
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    return { violation: false, reason: 'no SQL body' };
  }

  // Identify which domain tables the SQL references. Use word-boundary matching
  // so `soldier` does not match `soldier_role_tag` (we want both tables flagged
  // independently if both appear).
  const referenced = [];
  for (const t of domainTables) {
    const re = new RegExp(`\\b${t}\\b`, 'i');
    if (re.test(sql)) referenced.push(t);
  }

  if (referenced.length === 0) {
    return { violation: false, reason: 'no domain table referenced' };
  }

  // WR-07 fix (2026-05-18): a non-default transformer can post-process row
  // shape and bypass tenant filtering at the JS layer (Budibase supports a
  // JS post-processor on queries). The canonical default is "return data"
  // (sometimes serialized as the empty string). Anything else demands an
  // explicit exemption with rationale.
  if (typeof query.transformer === 'string') {
    const t = query.transformer.trim();
    if (t !== '' && t !== 'return data') {
      return {
        violation: true,
        reason:
          `query has a non-trivial transformer (${query.transformer.length} chars) — manual review required; ` +
          `transformers can mutate row shape and bypass tenant filtering. ` +
          `Add an EXEMPT_QUERIES entry with rationale if intended.`,
        table: referenced[0],
      };
    }
  }

  // Check the canonical filter pattern
  if (TENANT_FILTER_PATTERN.test(sql)) {
    return { violation: false, reason: 'tenant filter present' };
  }

  return {
    violation: true,
    reason: `missing tenant_id filter on domain table(s): ${referenced.join(', ')}`,
    table: referenced[0],
  };
}

// ─────────────────────────────────────────────
// CLI ENTRY POINTS
// ─────────────────────────────────────────────

function main_listDomainTables() {
  const tables = getDomainTables();
  const sorted = [...tables].sort();
  for (const t of sorted) console.log(t);
  process.exit(0);
}

// ─────────────────────────────────────────────
// BUDIBASE PUBLIC API CLIENT
// ─────────────────────────────────────────────

/**
 * Wrap fetch with a timeout so an unreachable hpg5 doesn't hang the gate.
 * Uses AbortController, not the bare `signal: AbortSignal.timeout(...)` shortcut,
 * to support Node 22's stable API surface.
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/public/v1/applications → list of app IDs.
 *
 * The Budibase Public API requires the `x-budibase-api-key` header. The applications
 * endpoint does NOT need `x-budibase-app-id` (that's the endpoint that DISCOVERS app IDs).
 *
 * @param {string} apiUrl
 * @param {string} apiKey
 * @returns {Promise<Array<{ _id: string, name: string }>>}
 */
export async function listApplications(apiUrl, apiKey) {
  const url = `${apiUrl.replace(/\/$/, '')}/api/public/v1/applications/search`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'x-budibase-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: '' }), // empty filter → all apps
  });

  if (res.status === 401 || res.status === 403) {
    throw new ApiAuthError(`Public API rejected the API key (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`listApplications failed: HTTP ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  // Budibase Public API responses are shaped `{ data: [...] }` for list endpoints.
  return Array.isArray(body) ? body : (body?.data ?? []);
}

/**
 * POST /api/public/v1/queries/search → list of all queries for an app.
 *
 * @param {string} apiUrl
 * @param {string} apiKey
 * @param {string} appId
 * @returns {Promise<Array<{ name: string, _id: string, fields?: { sql?: string } }>>}
 */
export async function searchQueries(apiUrl, apiKey, appId) {
  const url = `${apiUrl.replace(/\/$/, '')}/api/public/v1/queries/search`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'x-budibase-api-key': apiKey,
      'x-budibase-app-id': appId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: '' }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ApiAuthError(`Public API rejected the API key (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`searchQueries(app=${appId}) failed: HTTP ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  return Array.isArray(body) ? body : (body?.data ?? []);
}

class ApiAuthError extends Error {
  constructor(msg) { super(msg); this.name = 'ApiAuthError'; }
}

// ─────────────────────────────────────────────
// DEFAULT MODE — live API check
// ─────────────────────────────────────────────

async function main_default() {
  const apiKey = process.env.BUDIBASE_API_KEY;
  const apiUrl = process.env.BUDIBASE_API_URL ?? DEFAULT_API_URL;

  if (!apiKey) {
    console.warn(`check-bb-queries: BUDIBASE_API_KEY not set — skipping live API check.`);
    console.warn(`  (Self-test runs independently: \`node tools/check-bb-queries.mjs --self-test\`.)`);
    process.exit(0);
  }

  let apps;
  try {
    apps = await listApplications(apiUrl, apiKey);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      console.error(`check-bb-queries: ${err.message}`);
      console.error(`  Verify BUDIBASE_API_KEY against .env on hpg5. Aborting.`);
      process.exit(2);
    }
    // Network unreachable (ECONNREFUSED, DNS failure, AbortError on timeout) — skip + warn.
    const code = err?.cause?.code ?? err?.code ?? err?.name;
    console.warn(`check-bb-queries: Public API unreachable at ${apiUrl} (${code ?? err.message}) — skipping live check.`);
    process.exit(0);
  }

  if (!apps.length) {
    console.log(`check-bb-queries: no applications found at ${apiUrl}. Nothing to validate.`);
    process.exit(0);
  }

  const domainTables = getDomainTables();
  // WR-01: exemptions are (app, name) tuples now. Pass the raw array through
  // to validateQuery, which performs tuple matching against the current appId.
  const exemptList = EXEMPT_QUERIES;

  let totalQueries = 0;
  let totalValidated = 0;
  let totalExempt = 0;
  let totalSkipped = 0;
  const violations = [];

  for (const app of apps) {
    const appId = app._id ?? app.appId;
    if (!appId) continue;

    let queries;
    try {
      queries = await searchQueries(apiUrl, apiKey, appId);
    } catch (err) {
      if (err instanceof ApiAuthError) {
        console.error(`check-bb-queries: ${err.message}`);
        process.exit(2);
      }
      console.warn(`check-bb-queries: failed to fetch queries for app ${appId}: ${err.message}`);
      continue;
    }

    for (const q of queries) {
      totalQueries++;
      const result = validateQuery(q, domainTables, exemptList, appId);
      if (result.reason === 'exempt') {
        totalExempt++;
        continue;
      }
      if (result.reason === 'no SQL body' ||
          result.reason === 'no domain table referenced' ||
          result.reason === 'not a query object') {
        totalSkipped++;
        continue;
      }
      totalValidated++;
      if (result.violation) {
        violations.push({ appId, appName: app.name ?? '(unnamed)', query: q, result });
      }
    }
  }

  // Report
  console.log(`check-bb-queries: scanned ${apps.length} app(s), ${totalQueries} query(ies) total.`);
  console.log(`  validated: ${totalValidated}, exempt: ${totalExempt}, skipped (no SQL or no domain table): ${totalSkipped}.`);

  if (violations.length === 0) {
    console.log(`check-bb-queries: PASS — all domain-table queries embed the canonical tenant filter.`);
    process.exit(0);
  }

  console.error('');
  console.error(`check-bb-queries: FAIL — ${violations.length} violation(s):`);
  for (const v of violations) {
    const sql = v.query?.fields?.sql ?? '(no SQL)';
    const snippet = sql.length > 200 ? sql.slice(0, 200) + '…' : sql;
    console.error(`\nFAIL: query "${v.query.name}" (app ${v.appName}/${v.appId})`);
    console.error(`  ${v.result.reason}`);
    console.error(`  SQL: ${snippet.replace(/\n/g, ' ')}`);
    console.error(`  Fix: add \`WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid\` to the query, or`);
    console.error(`       add "${v.query.name}" to EXEMPT_QUERIES in tools/check-bb-queries.mjs with a 1-line reason.`);
  }
  process.exit(1);
}

// ─────────────────────────────────────────────
// SELF-TEST MODE
// ─────────────────────────────────────────────
// Mirrors the spirit of tools/check-queries.mjs --self-test (Lowdefy era) but
// adapted to a Public-API gate: we don't mutate a file, we run synthetic query
// objects through the in-process validator and assert it behaves correctly.
// This is the "gate is alive" assertion — it passes even when no live API is
// reachable, so CI / contributors / pre-commit can run it unconditionally.

function main_selfTest() {
  const domainTables = getDomainTables();
  // WR-01: tuple-scoped exemptions. Use the canonical dev app ID so the
  // seed exemption row matches the exempt-name case below.
  const SELFTEST_APP_ID = 'app_dev_169e766804934fd18f2e20200d8fd22d';
  const exemptList = EXEMPT_QUERIES;

  const cases = [
    {
      label: 'bad — missing filter on a domain-table SELECT',
      query: {
        name: 'SELFTEST_synthetic_bad',
        fields: { sql: 'SELECT id, display_name FROM soldier' },
      },
      expectViolation: true,
    },
    {
      label: 'good — canonical filter present',
      query: {
        name: 'SELFTEST_synthetic_good',
        fields: {
          sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid",
        },
      },
      expectViolation: false,
    },
    {
      label: 'exempt — known (app, name) tuple beats validation',
      query: {
        name: 'resolveInviteCode_GetTenantId',
        fields: { sql: 'SELECT id FROM soldier' }, // would be bad but exempt
      },
      expectViolation: false,
    },
    {
      // WR-07 selftest: non-default transformer must trigger a violation
      // even when the SQL itself has the canonical filter.
      label: 'transformer — non-default transformer flagged (WR-07)',
      query: {
        name: 'SELFTEST_transformer_bad',
        fields: {
          sql: "SELECT id FROM soldier WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid",
        },
        transformer: 'return data.map(r => ({ ...r, tenant_id: "leaked" }))',
      },
      expectViolation: true,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const result = validateQuery(c.query, domainTables, exemptList, SELFTEST_APP_ID);
    const actual = !!result.violation;
    if (actual === c.expectViolation) {
      console.log(`  PASS: ${c.label}`);
      passed++;
    } else {
      console.error(`  FAIL: ${c.label}`);
      console.error(`        expected violation=${c.expectViolation}, got violation=${actual}, reason=${result.reason}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\nSELF-TEST FAIL: ${failed}/${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nSELF-TEST PASS: ${passed}/${cases.length} cases. Gate is alive.`);
  process.exit(0);
}
