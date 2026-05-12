# Phase 2: Org & People — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 34 new/modified
**Analogs found:** 30 / 34 (4 require external reference — flagged below)

This document tells the planner exactly which existing Phase-1 file each new Phase-2 file should copy from, and which lines hold the load-bearing pattern. Anything marked "UPGRADE" extends an existing file in place; anything marked "NEW" is a fresh write that should clone the analog's structure.

---

## File Classification

### Wave 0 — Schema + Plugin Scaffold

| New / modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `db/migrations/0011_role_tag.up.sql` | migration (DDL + RLS) | request-response (Postgres) | `db/migrations/0007_imports_and_exports.up.sql` (table+composite-index shape) + `db/migrations/0009_rls_policies.up.sql` (RLS policy literal) | exact |
| `db/migrations/0012_org_unit_last_color_index.up.sql` | migration (ALTER TABLE ADD COLUMN) | request-response (Postgres) | `db/migrations/0007_imports_and_exports.up.sql` header + `db/migrations/0002_tenancy_and_org.up.sql` lines 80–96 (column CHECK constraint shape) | role-match |
| `app/plugins/shifty-roster/package.json` | plugin manifest | n/a | `app/plugins/shifty-audit-writer/package.json` | exact |
| `app/plugins/shifty-roster/src/types.js` | plugin type registry | n/a | `app/plugins/shifty-audit-writer/src/types.js` + `app/plugins/shifty-auth/src/types.js` | exact |
| `app/plugins/shifty-roster/src/connections.js` | plugin aggregator | n/a | `app/plugins/shifty-audit-writer/src/connections.js` | exact |
| `app/plugins/shifty-roster/src/helpers/palette.js` | utility (pure JS export) | n/a | none in repo — pure module, no analog needed (cite **`app/plugins/shifty-auth/src/auth/providers.js` lines 1–47** for ESM-export shape) | external |
| `app/plugins/shifty-roster/src/helpers/canonicalize.js` | utility (pure JS function) | transform | `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` lines 1–11 (module header + guard-clause idiom) | role-match |
| `app/plugins/shifty-roster/src/helpers/role-tag.js` | utility | transform | same as canonicalize | role-match |
| `app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js` | plugin request handler | transform (CSV in → rows[] out) | `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` (entire file is the canonical request-handler shape) | role-match |
| `app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js` | plugin request handler | CRUD (transactional INSERT batch + Resend dispatch) | `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` | role-match |
| `app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js` | plugin request handler | CRUD | same | role-match |
| `app/plugins/shifty-roster/src/connections/requests/UpdateSoldier.js` | plugin request handler | CRUD | same | role-match |
| `app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js` | plugin request handler | CRUD | same | role-match |
| `app/plugins/shifty-roster/src/connections/requests/CreateMembership.js` | plugin request handler | CRUD | same | role-match |
| `app/plugins/shifty-roster/src/connections/requests/InviteLater.js` | plugin request handler (Resend dispatch) | event-driven | `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` for shape + `app/plugins/shifty-auth/src/auth/providers.js` lines 28–45 for `next-auth` resolution | role-match |
| `app/plugins/shifty-roster/src/dispatch/resend.js` | server helper | event-driven (outbound HTTP) | `app/plugins/shifty-auth/src/auth/providers.js` lines 28–45 for `createRequire(process.cwd())` resolution idiom | role-match |

### Wave 1 — Tree-table + Roster + Role-tag list

| New / modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `app/pages/admin/manage_org_units.yaml` (UPGRADE) | page (Lowdefy YAML) | CRUD | itself (already exists — extend in place) | exact |
| `app/pages/admin/manage_soldiers.yaml` | page | CRUD (list) | `app/pages/admin/manage_invites.yaml` (toolbar + AgGrid + Modal create) | exact |
| `app/pages/admin/manage_role_tags.yaml` | page (read-only) | CRUD (read) | `app/pages/admin/admin_test_audit.yaml` lines 1–22, 49–58 (page + single list query + AgGrid) | exact |
| `app/lowdefy.yaml` (UPDATE) | config (plugins + menus + auth.pages.roles + page refs) | n/a | itself (lines 5–18 plugins; lines 30–45 auth.roles; lines 73–113 menus; lines 184–192 page refs) | exact |

### Wave 2 — Soldier Detail + Profile + Team Detail

| New / modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `app/pages/admin/soldier_detail.yaml` | page with URL param `{id}` | CRUD (read + update) | `app/pages/admin/manage_invites.yaml` (form layout + KnexRaw payload pattern) + `app/pages/admin/manage_org_units.yaml` lines 45–62 (UPDATE with `tenant_id` + scoped row) | role-match |
| `app/pages/admin/team_detail.yaml` | page with URL param `{id}` | CRUD (read + update) | `app/pages/admin/manage_invites.yaml` + `app/pages/admin/admin_dashboard.yaml` (org_unit list query) | role-match |
| `app/pages/my_profile.yaml` | page (every authenticated role) | CRUD (single UPDATE) | `app/pages/dashboards/my_dashboard.yaml` lines 1–32 (no-`unit_admin` auth.roles list + `_user` operator usage) | exact |
| `app/blocks/color_swatches.yaml` | shared block (`_ref`d from soldier_detail + my_profile) | request-response (SetState) | none in repo — no shared block exists yet | external (cite Lowdefy skill `reference/03-blocks.md` Box+grid recipe) |
| `app/blocks/color_dot_cell.yaml` | shared cell-renderer block | n/a | none in repo | external |

### Wave 3 — CSV Import Pipeline

| New / modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `app/pages/admin/roster_import.yaml` | page (3-step wizard) | CRUD (upload → preview → commit) + event-driven (Resend dispatch progress) | `app/pages/admin/admin_test_audit.yaml` (button → request → grid refresh) + `app/pages/admin/manage_invites.yaml` (form-then-grid layout) + UI-SPEC §"Page 5: roster_import" wireframe | role-match |
| `app/pages/admin/roster_import_result.yaml` | page (Result summary) | request-response (read summary row) | `app/pages/dashboards/my_dashboard.yaml` (minimal page shape with a single Title + content block) | role-match |

### Wave 4 — Cleanup + E2E + Unit Tests + Fixtures

| New / modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `db/migrations/0008_legacy_drop.up.sql` | migration (DROP TABLE) | request-response (Postgres) | `db/migrations/0010_audit_revokes.up.sql` (idempotent BEGIN/COMMIT + comment header style) | role-match |
| `app/lowdefy.yaml` (UPDATE — second time, Wave 4) | config | n/a | itself (remove `/employees` page block at lines 131–183 and the `employees_link` menu entry at lines 81–85) | exact |
| `tests/e2e/roster-csv-import.spec.ts` | test (Playwright HTTP-API) | request-response | `tests/e2e/org-unit-crud.spec.ts` (admin + member sessions + POST `/api/request/<page>/<request>`) | exact |
| `tests/e2e/soldier-crud.spec.ts` | test | request-response | `tests/e2e/org-unit-crud.spec.ts` | exact |
| `tests/e2e/tenant-isolation.spec.ts` | test (auto-derive forge spec) | request-response | `tests/e2e/cross-tenant-leak.spec.ts` lines 17–94 (walks `app/pages/**/*.yaml` and asserts no tenant-B IDs leak) | exact |
| `tests/unit/canonicalize.spec.ts` | unit test | transform | `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` (node:test + assert/strict + fixture imports) | exact |
| `tests/unit/color-palette.spec.ts` | unit test | n/a | same | exact |
| `tests/unit/role-tag-canonical.spec.ts` | unit test | n/a | same | exact |
| `tests/fixtures/csv/clean.csv`, `smart-quote.csv`, `dup-email.csv`, `bidi-mark.csv` | fixture | n/a | `tools/fixtures/kibbutz.sql` (header comment style; smart-quote canary) | role-match |
| `tests/fixtures/db/seed-phase2.sql` | fixture (SQL seed) | request-response | `tools/fixtures/kibbutz.sql` lines 1–40 | exact |

---

## Pattern Assignments

### `db/migrations/0011_role_tag.up.sql` (migration, DDL+RLS)

**Analogs:** `db/migrations/0007_imports_and_exports.up.sql` + `db/migrations/0009_rls_policies.up.sql`

**Header pattern** (copy verbatim, adjust for table+REQ-ID) — from `0007_imports_and_exports.up.sql` lines 1–7:

```sql
-- 0011_role_tag.up.sql -- per-tenant role-tag catalog (D-13, ROST-07)
-- Backs autocomplete in soldier_detail + CSV import preview.
-- Composite (tenant_id, ...) indexes per PERF-04.
-- RLS policy inlined (mirrors 0009 pattern for tables created post-0009).
-- No RLS preamble needed — RLS is added by this migration itself.

BEGIN;
```

**Table-with-CHECK-and-CITEXT pattern** — adapted from `0002_tenancy_and_org.up.sql` lines 25–43 (tenant table CHECK constraint) and lines 64–74 (app_user CITEXT + COLLATE):

```sql
CREATE TABLE role_tag (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$'),
    label       TEXT        COLLATE "he-x-icu",
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE INDEX idx_role_tag_tenant ON role_tag(tenant_id);
```

**RLS policy literal** — copy from `0009_rls_policies.up.sql` lines 98–105 (the `EXECUTE format` literal — extract as plain SQL since `role_tag` isn't in the DO-block loop yet):

```sql
ALTER TABLE role_tag ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON role_tag;
CREATE POLICY tenant_isolation ON role_tag
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
```

**Notes:** The `0009` migration is locked (already applied at `schema_migrations.version=10`). Do NOT extend the DO-block loop in 0009 — apply the policy directly in 0011 as shown above. The pattern is identical to what 0009 produces; it just lands in a different migration file.

---

### `db/migrations/0012_org_unit_last_color_index.up.sql` (migration, ALTER TABLE)

**Analog:** `db/migrations/0007_imports_and_exports.up.sql` (header + BEGIN/COMMIT shape) and `db/migrations/0002_tenancy_and_org.up.sql` lines 86 (column CHECK with range constraint).

**Pattern:**

```sql
-- 0012_org_unit_last_color_index.up.sql -- 24-color round-robin anchor (D-15, ROST-06)
-- Tracks last color index assigned in this team so the next assignment
-- can use (last + 2) mod 24 to avoid adjacent-color collisions.
-- -1 sentinel = "no color assigned yet"; first soldier gets index 0.

BEGIN;

ALTER TABLE org_unit
  ADD COLUMN last_color_index SMALLINT NOT NULL DEFAULT -1
    CHECK (last_color_index BETWEEN -1 AND 23);

COMMIT;
```

**Notes:** No new index needed; `org_unit` already has `idx_org_unit_tenant` (`0002` line 45). The CHECK constraint mirrors `seniority SMALLINT NOT NULL DEFAULT 0 CHECK (seniority BETWEEN 0 AND 10)` from `soldier` (`0002` line 86). RLS already enabled on `org_unit` via `0009`; the column inherits.

---

### `db/migrations/0008_legacy_drop.up.sql` (migration, DROP TABLE)

**Analog:** `db/migrations/0010_audit_revokes.up.sql` (idempotent BEGIN/COMMIT + comment-heavy preamble).

**Pattern** — extract the rationale-as-comment style from `0010` lines 1–9 and reuse for the drop:

```sql
-- 0008_legacy_drop.up.sql -- drop Phase-0 bootstrap tables once Phase 2 supersedes them
-- Phase 1 D-06 deferred this migration to the Phase 2 boundary.
-- Pre-flight checklist (verify before applying):
--   1. app/lowdefy.yaml no longer contains the `employees` page (was lines 131–183).
--   2. app/lowdefy.yaml `menus.links` no longer contains employees_link (was lines 81–85).
--   3. tools/check-queries.mjs reports zero violations.
--   4. Playwright cross-tenant-leak.spec.ts run is clean without `/employees` in scope.
--
-- Order: drop in reverse FK dependency to avoid FK violations.
-- The trigger function set_updated_at() is referenced by other tables — DO NOT drop it.

BEGIN;

DROP TABLE IF EXISTS time_clock_entries;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS availability;
DROP TABLE IF EXISTS employees;

COMMIT;
```

**Notes:** The exact FK order should be verified by reading `0001_init.up.sql` before writing the plan. Drop legacy tables only; preserve the `set_updated_at()` function used by `0002`+ tables.

---

### `app/plugins/shifty-roster/package.json` (plugin manifest)

**Analog:** `app/plugins/shifty-audit-writer/package.json` (lines 1–13, full file).

**Pattern:**

```json
{
  "name": "shifty-roster",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./connections": "./src/connections.js",
    "./types": "./src/types.js",
    "./helpers/palette": "./src/helpers/palette.js",
    "./helpers/canonicalize": "./src/helpers/canonicalize.js",
    "./helpers/role-tag": "./src/helpers/role-tag.js"
  },
  "dependencies": {
    "knex": "*",
    "papaparse": "^5.5.3"
  }
}
```

**Notes:** Lowdefy resolves first-party plugins via `file:../../plugins/shifty-roster` in `app/lowdefy.yaml` plugins list — same pattern as `shifty-audit-writer` (see `app/lowdefy.yaml` lines 16–17). `papaparse` is the only third-party dep added (CSV parse for D-09).

---

### `app/plugins/shifty-roster/src/types.js` (plugin type registry)

**Analog:** `app/plugins/shifty-audit-writer/src/types.js` (full file, 8 lines).

**Pattern:**

```javascript
// app/plugins/shifty-roster/src/types.js
// Plugin type registry for shifty-roster.
// Registers Phase 2 request types: ParseCsvAndValidate, CommitRosterImport,
// CreateSoldier, UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater.
// TypeName must match exactly the `type:` field used in YAML request blocks.
export default {
  requests: [
    'ParseCsvAndValidate',
    'CommitRosterImport',
    'CreateSoldier',
    'UpdateSoldier',
    'ArchiveSoldier',
    'CreateMembership',
    'InviteLater',
  ],
};
```

---

### `app/plugins/shifty-roster/src/connections.js` (plugin aggregator)

**Analog:** `app/plugins/shifty-audit-writer/src/connections.js` (full file, 7 lines).

**Pattern:**

```javascript
// app/plugins/shifty-roster/src/connections.js
// Aggregator: re-exports all request handlers for this plugin.
import ParseCsvAndValidate from './connections/requests/ParseCsvAndValidate.js';
import CommitRosterImport from './connections/requests/CommitRosterImport.js';
import CreateSoldier from './connections/requests/CreateSoldier.js';
import UpdateSoldier from './connections/requests/UpdateSoldier.js';
import ArchiveSoldier from './connections/requests/ArchiveSoldier.js';
import CreateMembership from './connections/requests/CreateMembership.js';
import InviteLater from './connections/requests/InviteLater.js';

export default {
  ParseCsvAndValidate,
  CommitRosterImport,
  CreateSoldier,
  UpdateSoldier,
  ArchiveSoldier,
  CreateMembership,
  InviteLater,
};
```

---

### `app/plugins/shifty-roster/src/connections/requests/*.js` (plugin request handlers — all 7)

**Analog:** `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` (the entire file is the canonical shape).

**Imports / module header pattern** (lines 1–9):

```javascript
// app/plugins/shifty-roster/src/connections/requests/<Name>.js
// Lowdefy custom request: <one-line purpose>.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
```

**Guard-clause + tenant-derivation pattern** (lines 11–22):

```javascript
async function CreateSoldier({ request, connection }) {
  const { display_name, seniority, role_tags, email } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  const actor_user_id = request.user?.user_id;

  if (!actor_user_id) {
    throw new Error('CreateSoldier: actor_user_id missing from session — unauthenticated request');
  }
  if (!tenant_id) {
    throw new Error('CreateSoldier: tenant_id missing from session');
  }
  if (!display_name) {
    throw new Error('CreateSoldier: display_name is required');
  }
```

**Dynamic-knex + try/finally cleanup pattern** (lines 24–41):

```javascript
  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // ... use db.transaction(...) for CommitRosterImport; single insert for CreateSoldier
    const [row] = await db('soldier').insert({
      tenant_id,
      display_name,        // already canonicalized by caller per D-12
      seniority: seniority ?? 0,
      role_tags: role_tags ?? [],
    }).returning(['id', 'display_name', 'color']);
    return { success: true, soldier: row };
  } finally {
    await db.destroy();
  }
}
```

**Schema + connectionType static-property pattern** (lines 43–55):

```javascript
CreateSoldier.schema = {
  type: 'object',
  required: ['display_name'],
  properties: {
    display_name: { type: 'string', minLength: 1 },
    seniority: { type: 'integer', minimum: 0, maximum: 10 },
    role_tags: { type: 'array', items: { type: 'string' } },
    email: { type: 'string', format: 'email' },
  },
};
CreateSoldier.connectionType = 'Knex';

export default CreateSoldier;
```

**Notes — divergences for each request:**
- **`ParseCsvAndValidate`** — no `db.transaction`; reads `request.properties.csv_base64`, decodes, runs `papaparse.parse(csvText, { header: true })`, applies `canonicalizeText` + `canonicalizeRoleTag`, pre-flight `SELECT email FROM app_user WHERE tenant_id = :t AND email = ANY(:emails)` for duplicate detection, returns `{ rows: [{ status, errors[], warnings[], data }] }`.
- **`CommitRosterImport`** — wraps everything in `db.transaction(async trx => { ... })`; on success writes one `roster_import_log` row using **live schema** column names (`imported_by`, `source`, NOT `actor_id`, NOT `rows_total` per RESEARCH §"Schema discrepancy"); then dispatches Resend invites in a sync loop using helper from `src/dispatch/resend.js`.
- **`InviteLater`** — no DB writes beyond the `verification_tokens` insert that NextAuth triggers via `Login` action; thin wrapper that calls into the shared `resend.js` dispatcher.
- **`ArchiveSoldier`** — UPDATE only, no DELETE. Sets `status='archived'`; does NOT touch `membership` rows (per D-08).

---

### `app/plugins/shifty-roster/src/helpers/palette.js` (utility)

**Analog:** none in-repo (no existing pure helper modules). Closest shape: `app/plugins/shifty-auth/src/auth/providers.js` lines 1–47 (ESM module header + named export).

**Pattern** (write fresh — palette is product data per UI-SPEC §"Color B. 24-color soldier-calendar palette"):

```javascript
// app/plugins/shifty-roster/src/helpers/palette.js
// FROZEN 24-color Glasbey-style perceptually-distinct palette.
// Array INDEX is the adjacency identifier per D-15: index ±1 in this array
// is considered an "adjacent" color and must not be assigned to two soldiers
// in the same team in immediate succession.
// Hex values from UI-SPEC §"Color B" — do NOT reorder; persisted color indices
// reference this array's positions.

export const PALETTE = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B',
  '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF', '#AEC7E8', '#FFBB78',
  '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#C7C7C7',
  '#DBDB8D', '#9EDAE5', '#393B79', '#637939', '#8C6D31', '#843C39',
];

/**
 * Picks the next palette index, jumping by 2 to avoid adjacent-color collisions.
 * @param {number} lastIndex — previous assignment (-1 = no prior assignment)
 * @returns {number} next index in [0, 23]
 */
export function pickNextColor(lastIndex) {
  if (lastIndex === undefined || lastIndex === null || lastIndex < 0) return 0;
  return (lastIndex + 2) % PALETTE.length;
}
```

---

### `app/plugins/shifty-roster/src/helpers/canonicalize.js` (utility)

**Analog:** `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` lines 1–11 (module-header style + guard-clause idiom). The function itself has no analog; it's a pure transform.

**Pattern:**

```javascript
// app/plugins/shifty-roster/src/helpers/canonicalize.js
// Smart-quote + bidi-mark stripper (D-12, ROST-11).
// Strip set per CONTEXT D-12: U+2019 (right single quotation mark),
// U+200E (LRM), U+200F (RLM), U+202A..U+202E (LRE/RLE/PDF/LRO/RLO).
// Applied to soldier.display_name on every write path (single-row create + CSV import).

const STRIP_REGEX = /[’‎‏‪-‮]/g;

/**
 * Strips smart quotes and Unicode bidi marks from text.
 * Belt-and-braces defense: same stripping in both single-row and CSV write paths.
 * @param {string|null|undefined} text
 * @returns {string} canonicalized string (empty string for null/undefined)
 */
export function canonicalizeText(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(STRIP_REGEX, '');
}
```

---

### `app/plugins/shifty-roster/src/helpers/role-tag.js` (utility)

**Analog:** same as canonicalize.js.

**Pattern:**

```javascript
// app/plugins/shifty-roster/src/helpers/role-tag.js
// Canonicalize free-form role-tag input to lowercase kebab-case (ROST-07).
// Matches the DB CHECK constraint key ~ '^[a-z][a-z0-9-]*$' on role_tag.key (0011 migration).

export function canonicalizeRoleTag(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/[’‎‏‪-‮]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}
```

---

### `app/plugins/shifty-roster/src/dispatch/resend.js` (server helper)

**Analog:** `app/plugins/shifty-auth/src/auth/providers.js` lines 18–45 (the `createRequire(process.cwd())` resolution idiom — needed because pnpm strict isolation breaks `import.meta.url`-based resolution).

**Pattern excerpt** from the analog:

```javascript
// Resolution note: createRequire is called with process.cwd() + '/package.json' so that
// Node.js resolves next-auth and nodemailer from the Lowdefy server's working directory
// (/build/.lowdefy/server/), where both packages are installed as direct dependencies.
// Do NOT use import.meta.url for createRequire — pnpm's strict isolation means the plugin's
// own node_modules tree does not contain next-auth or nodemailer symlinks.

import { createRequire } from 'module';
// ...
const serverRequire = createRequire(process.cwd() + '/package.json');
```

**Apply to `resend.js`** — wrap the Resend SDK with the same idiom (resend@6.12.3 must be in `app/package.json` deps; plugin imports it via `serverRequire('resend')`). Implement the retry loop (NOTF-07 backoff: 1s → 4s → 16s, max 3 attempts) for HTTP 429 responses per D-10 step 3.

**Notes:** The actual Resend dispatch invocation — single email per call — should also call NextAuth's `Login` action mechanism to ensure the magic-link token is created in `verification_tokens`. The cleanest pattern is to expose two functions: `sendInvite({ email, callbackUrl })` (NextAuth-driven) and `bulkDispatchWithBackoff(rows, onProgress)`.

---

### `app/pages/admin/manage_org_units.yaml` (UPGRADE — page)

**Analog:** itself (already exists). The Phase-1 file is the canonical tenant-scoped CRUD shape.

**What to preserve verbatim:**
- `auth.roles: [unit_admin]` (lines 3–5) — extend to add `team_manager` per D-02.
- All 4 KnexRaw requests `list_units`, `create_org_unit`, `rename_org_unit`, `delete_org_unit` (lines 9–82) — payload + parameters shape stays. The `tenant_id: { _user: tenant_id }` (line 13) is non-negotiable.
- Leaf-only delete guard `AND NOT EXISTS (SELECT 1 FROM org_unit child WHERE child.parent_id = :id)` (line 78) — preserve.

**What to upgrade:**
- Replace the flat AgGrid (lines 90–97) with an AgGridAlpine block that has `treeData: true` + `getDataPath: { _function: ... }` (deriving the path from `parent_id` chains). The skill ref `.claude/skills/lowdefy/reference/03-blocks.md` is the source — UI-SPEC §"Page 1" wireframe gives column shape.
- Add per-row "Add child here" button rendered via a `cellRenderer` on a new `actions` column.
- Add `level: { _payload: parent_level + 1 }` server-side derivation so the NumberInput goes away (D-01).
- Add D-04 grow-`org_depth` confirmation modal as an inline Confirm action chained before `create_org_unit` for nodes at `tenant.org_depth`.

---

### `app/pages/admin/manage_soldiers.yaml` (NEW — page)

**Analog:** `app/pages/admin/manage_invites.yaml` (full file). It has the exact shape: page header → multiple KnexRaw requests → list query → create form in a Card → AgGrid at bottom.

**Page header pattern** (lines 1–7):

```yaml
id: manage_soldiers
type: PageHeaderMenu
auth:
  roles:
    - unit_admin
properties:
  title: 'ניהול חיילים | shifty'
```

**KnexRaw list+create pattern** (lines 9–86):

The `list_active_codes` query at lines 23–41 is the canonical "tenant-scoped SELECT with joins and ORDER BY" pattern — apply to `list_soldiers` and adapt:

```yaml
- id: list_soldiers
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
  properties:
    query: |
      SELECT s.id, s.display_name, s.color, s.seniority, s.role_tags,
             s.phone_e164, s.status, au.email
      FROM soldier s
      LEFT JOIN app_user au ON au.id = s.user_id
      WHERE s.tenant_id = :tenant_id
        AND s.status = 'active'
      ORDER BY s.display_name
    parameters:
      tenant_id: { _payload: tenant_id }
```

**Toolbar + AgGrid pattern** — extend the layout shown in `manage_invites.yaml` lines 131–143 with the column shape from UI-SPEC §"Page 2: manage_soldiers" (color dot, name, email, seniority, tags, status). Add row-click navigation via `onRowClicked: { type: Link, params: { pageId: soldier_detail, urlQuery: { id: _event.data.id } } }` (Lowdefy 5.3 event arg syntax per skill `reference/05-events.md`).

---

### `app/pages/admin/soldier_detail.yaml` (NEW — page with `{id}` param)

**Analogs:** `app/pages/admin/manage_invites.yaml` (form fields + KnexRaw mutation) + `app/pages/admin/manage_org_units.yaml` lines 45–62 (UPDATE-by-id pattern).

**URL parameter pattern** — UI-SPEC §"Page 3" reads `id` from URL. Lowdefy's `_input` operator reads from the URL query/route. Combine with the canonical UPDATE shape:

**UPDATE-with-scope pattern** (extend from `manage_org_units.yaml` lines 45–62) — must add Layer-4 scope check per RESEARCH §"Layer 4":

```yaml
- id: update_soldier
  type: UpdateSoldier   # custom plugin request
  connectionId: shifts_db
  properties:
    soldier_id: { _input: id }
    display_name: { _state: form.display_name }
    seniority: { _state: form.seniority }
    role_tags: { _state: form.role_tags }
    phone_e164: { _state: form.phone_e164 }
    notes: { _state: form.notes }
    status: { _state: form.status }
```

**Notes:** The custom `UpdateSoldier` request handler enforces (a) `canonicalizeText` on `display_name`, (b) the role-check gate for `notes`, (c) the Layer-4 scope check that `request.user.tenant_id` matches the row's `tenant_id`. The page-level `auth.roles: [unit_admin, team_manager]` is Layer 3; the request handler is Layer 4.

**Form layout** — UI-SPEC §"Page 3" Page 3 wireframe is the source-of-truth for card grouping (זהות → תפקיד וותק → חברות → צבע) and the manager-only `notes` field visibility:

```yaml
- id: notes_input
  type: TextArea
  properties:
    label: הערות
  visible:
    _array.includes:
      on: { _user: roles }
      value: team_manager
```

The `visible: { _user: roles }` operator usage is taken from `app/pages/dashboards/manager_dashboard.yaml` (read but not pasted — same idiom).

---

### `app/pages/admin/team_detail.yaml` (NEW — page with `{id}` param)

**Analogs:** `app/pages/admin/admin_dashboard.yaml` (org_unit query + AgGrid) + `app/pages/admin/manage_invites.yaml` (CRUD layout).

**Page-scoped read pattern** (adapt from `admin_dashboard.yaml` lines 9–21):

```yaml
- id: get_team
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
    team_id: { _input: id }
  properties:
    query: |
      SELECT ou.id, ou.name, ou.parent_id, ou.level, ou.last_color_index
      FROM org_unit ou
      WHERE ou.tenant_id = :tenant_id
        AND ou.id = :team_id
    parameters:
      tenant_id: { _payload: tenant_id }
      team_id: { _payload: team_id }
```

**Member-list query** — same shape as `manage_soldiers.list_soldiers` but joined to `membership` with `WHERE m.org_unit_id = :team_id`.

**Phase 3 placeholder card** — UI-SPEC §"Page 4" wireframe specifies a `Result` block with status `info` and icon `AiOutlineClockCircle` (deferred Phase 3 callout).

---

### `app/pages/my_profile.yaml` (NEW — page, all authenticated)

**Analog:** `app/pages/dashboards/my_dashboard.yaml` (lines 1–32, full file).

**Auth pattern** (lines 1–9):

```yaml
id: my_profile
type: PageHeaderMenu
auth:
  roles:
    - unit_admin
    - team_manager
    - member
    - viewer
properties:
  title: 'הפרופיל שלי | shifty'
```

**`_user` operator usage** (lines 14–20 in `my_dashboard.yaml` show the `_user: true` pattern that fetches the whole session.user object for Nunjucks templates).

**UPDATE pattern** — Phase 2's color override is a single-row UPDATE scoped by `(user_id, tenant_id)` per CONTEXT D-16. Use the `manage_org_units.rename_org_unit` shape (lines 45–62) but the WHERE clause is `WHERE user_id = :user_id AND tenant_id = :tenant_id`:

```yaml
- id: update_my_color
  type: KnexRaw
  connectionId: shifts_db
  payload:
    user_id: { _user: user_id }
    tenant_id: { _user: tenant_id }
    color: { _state: selected_color_hex }
  properties:
    query: |
      UPDATE soldier
      SET color = :color, updated_at = now()
      WHERE user_id = :user_id AND tenant_id = :tenant_id
      RETURNING id, color
    parameters:
      user_id: { _payload: user_id }
      tenant_id: { _payload: tenant_id }
      color: { _payload: color }
```

**Notes:** Both `user_id` and `tenant_id` come from `_user` (session) per RESEARCH §"Layer 1" — never from `_state` or `_input`. The `_ref: ../blocks/color_swatches.yaml` block injects the 24-swatch picker.

---

### `app/pages/admin/roster_import.yaml` (NEW — 3-step wizard)

**Analogs:** `app/pages/admin/admin_test_audit.yaml` (button → request → grid refresh — the simplest "trigger a custom request" page) + UI-SPEC §"Page 5: roster_import" wireframe (the recipes for step indicator, status pill cellRenderer, re-invite checkbox column are inlined in UI-SPEC).

**Page header + auth.roles** — from `admin_test_audit.yaml` lines 1–7:

```yaml
id: roster_import
type: PageHeaderMenu
auth:
  roles:
    - unit_admin
    - team_manager
properties:
  title: 'ייבוא חיילים מקובץ CSV | shifty'
```

**Request → grid-refresh flow** — pattern from `admin_test_audit.yaml` lines 41–48:

```yaml
events:
  onClick:
    - { id: do_parse, type: Request, params: { requestId: parse_csv } }
    - { id: refresh_preview, type: Request, params: { requestId: get_preview_state } }
```

**Wizard step visibility** — use `visible:` operators on three Cards, gated by `_state.wizard_step` (1, 2, 3). UI-SPEC §"Page 5" lines 470–473 give the Ant Steps block usage; planner verifies block exposure at Plan time.

**Status pill cellRenderer** — copy directly from UI-SPEC §"Reusable Components — 3. Status pill" (already a complete recipe).

**Re-invite checkbox column** — copy from UI-SPEC §"Page 5" lines 491–493.

**Notes:** This page has NO direct KnexRaw — every mutation/parse goes through the `shifty-roster` plugin requests (`ParseCsvAndValidate`, `CommitRosterImport`, `InviteLater`). The CI grep gate (`tools/check-queries.mjs`) only scans Knex* request types, so plugin requests are auto-exempt — Layer 2 protection moves into the plugin's request handler instead.

---

### `app/pages/admin/roster_import_result.yaml` (NEW — Result summary page)

**Analog:** `app/pages/dashboards/my_dashboard.yaml` (minimal page shape).

**Pattern** — read the just-committed `roster_import_log` row by id (passed via `_input.import_id`), render an Ant `Result` block per UI-SPEC §"Page 6" wireframe. Disable the "צפה ביומן הייבוא" link (Phase 7 destination) with `disabled: true` per UI-SPEC §"Page 6" final note.

---

### `app/pages/admin/manage_role_tags.yaml` (NEW — read-only)

**Analog:** `app/pages/admin/admin_test_audit.yaml` lines 1–22, 49–58 (page header + single SELECT + read-only AgGrid).

**Pattern:**

```yaml
id: manage_role_tags
type: PageHeaderMenu
auth:
  roles:
    - unit_admin
properties:
  title: 'תגיות תפקיד | shifty'
requests:
  - id: list_role_tags
    type: KnexRaw
    connectionId: shifts_db
    payload:
      tenant_id: { _user: tenant_id }
    properties:
      query: |
        SELECT id, key, label, created_at
        FROM role_tag
        WHERE tenant_id = :tenant_id
        ORDER BY key
      parameters:
        tenant_id: { _payload: tenant_id }
blocks:
  - id: title
    type: Title
    properties: { content: תגיות תפקיד, level: 1 }
  - id: notice
    type: Alert
    properties:
      type: info
      message: 'עריכת תגיות תתווסף בשלב v1.1.'
      description: 'בינתיים, ניתן ליצור תגיות חדשות בעת ייבוא CSV או הוספת חייל.'
      showIcon: true
  - id: tags_grid
    type: AgGridAlpine
    properties:
      rowData: { _request: list_role_tags }
      columnDefs:
        - { field: key, headerName: 'מפתח (key)' }
        - { field: label, headerName: 'תיוג בעברית' }
        - { field: created_at, headerName: 'נוצר' }
```

---

### `app/lowdefy.yaml` (UPDATE — config)

**Analog:** itself.

**Plugin-list extension pattern** (insert after line 17):

```yaml
  - name: 'shifty-roster'
    version: 'file:../../plugins/shifty-roster'
```

**auth.pages.roles extension pattern** (extend lines 30–44):

```yaml
    roles:
      unit_admin:
        - admin_dashboard
        - admin_test_audit
        - manage_invites
        - manage_org_units
        - manage_soldiers       # NEW
        - manage_role_tags      # NEW
        - roster_import         # NEW
        - soldier_detail        # NEW
        - team_detail           # NEW
        - my_profile            # NEW
        - manager_dashboard
        - my_dashboard
      team_manager:
        - manage_org_units      # NEW (read + own-team rename per D-02)
        - manage_soldiers       # NEW (team-scoped at query level)
        - soldier_detail        # NEW
        - team_detail           # NEW
        - roster_import         # NEW
        - my_profile            # NEW
        - manager_dashboard
        - my_dashboard
      member:
        - my_profile            # NEW
        - my_dashboard
      viewer:
        - my_profile            # NEW
        - my_dashboard
```

**Menus extension pattern** (insert into `menus.links` list per UI-SPEC §"Sidebar / Navigation" order):

```yaml
      - id: manage_soldiers_link
        type: MenuLink
        pageId: manage_soldiers
        properties:
          title: חיילים
        visible: { _user: tenant_id }
      - id: roster_import_link
        type: MenuLink
        pageId: roster_import
        properties:
          title: ייבוא חיילים
        visible: { _user: tenant_id }
      - id: manage_role_tags_link
        type: MenuLink
        pageId: manage_role_tags
        properties:
          title: תגיות תפקיד
        visible: { _user: tenant_id }
      - id: my_profile_link
        type: MenuLink
        pageId: my_profile
        properties:
          title: הפרופיל שלי
        visible: { _user: tenant_id }
```

**Page-ref extension pattern** (insert after line 191 — match existing `_ref:` style):

```yaml
  - _ref: pages/admin/manage_soldiers.yaml
  - _ref: pages/admin/soldier_detail.yaml
  - _ref: pages/admin/team_detail.yaml
  - _ref: pages/admin/roster_import.yaml
  - _ref: pages/admin/roster_import_result.yaml
  - _ref: pages/admin/manage_role_tags.yaml
  - _ref: pages/my_profile.yaml
```

**Wave 4 update — remove employees** (lines 81–85 menu entry AND lines 131–183 page block):
- Delete the entire `- id: employees_link` block (lines 81–85).
- Delete the entire `- id: employees ... type: PageHeaderMenu` block (lines 131–183).
- Verify `tools/check-queries.mjs` reports no violations (the `-- @gsd-allow-untenanted:` exempt query disappears with the block).

---

### `tests/e2e/roster-csv-import.spec.ts` (NEW)

**Analog:** `tests/e2e/org-unit-crud.spec.ts` (full file — POST `/api/request/<page>/<request>` with cookie sessions, member-vs-admin role split, DB verification via `pg`).

**Imports + fixture pattern** (lines 14–67):

```typescript
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { seedTwoTenants, signInAs, type TenantFixture } from './_fixtures/seed-tenants';
import { teardownTestData } from './_fixtures/teardown';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const PG_URL = process.env.PG_TEST_URL ?? 'postgres://shifts:changeme@localhost:5432/shifts';

async function makePgClient(): Promise<Client | null> {
  const c = new Client({ connectionString: PG_URL });
  try { await c.connect(); return c; } catch { return null; }
}
```

**Skip-on-stack-down pattern** (lines 109–117 of analog):

```typescript
try {
  res = await request.post(`${BASE_URL}/api/request/roster_import/commit_roster_import`, { ... });
} catch {
  test.skip(true, 'Lowdefy stack not reachable — run with stack up');
  return;
}
if (res.status() === 502 || res.status() === 503) {
  test.skip(true, `Stack returned ${res.status()}`);
  return;
}
expect(res.status()).toBe(200);
```

**DB verification pattern** (lines 121–133 of analog):

```typescript
const c = await makePgClient();
if (!c) return;
try {
  await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantA.tenantId]);
  const dbRes = await c.query<{ id: string }>(
    `SELECT id FROM soldier WHERE tenant_id = $1 AND display_name = $2`,
    [tenantA.tenantId, 'נועם גלאל']  // canonicalized (U+2019 stripped)
  );
  expect(dbRes.rows.length).toBe(1);
} finally { await c.end(); }
```

**SLO assertion (ROST-13 — 50 rows ≤10s)** — use Playwright's `test.setTimeout(15_000)` and wrap the POST in a `performance.now()` measurement; assert `elapsed < 10_000`.

---

### `tests/e2e/soldier-crud.spec.ts` (NEW)

**Analog:** `tests/e2e/org-unit-crud.spec.ts` — clone verbatim, adapt the route and payload shape. Tests A–F structure (admin create / rename / archive happy paths + member-role 403 gate) maps 1:1 onto `create_soldier`, `update_soldier`, `archive_soldier`.

---

### `tests/e2e/tenant-isolation.spec.ts` (NEW)

**Analog:** `tests/e2e/cross-tenant-leak.spec.ts` (lines 17–94 are the `collectPageIds()` walker + per-page assertion).

**Auto-discovery pattern** (lines 17–40):

```typescript
function collectPageIds(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.yaml')) {
        const content = readFileSync(full, 'utf-8');
        try {
          const doc = YAML.parse(content) as Record<string, unknown> | null;
          if (doc && typeof doc.id === 'string' && typeof doc.type === 'string' && /Page/.test(doc.type)) {
            out.push(doc.id);
          }
        } catch { /* skip */ }
      }
    }
  }
  walk('app/pages');
  return out;
}
```

**Notes:** The existing `cross-tenant-leak.spec.ts` already auto-covers Phase 2's new pages — so a separate `tenant-isolation.spec.ts` may be redundant. **Recommendation for planner:** verify Phase 2 pages are picked up by `cross-tenant-leak.spec.ts` (they will be — the walker is non-discriminating), and only add a NEW spec file if Phase 2 has additional forge scenarios beyond simple page-leak detection (e.g., POSTing a CSV containing tenant-B email to roster_import → assert duplicate-detection scope stops at tenant-A boundary).

---

### `tests/unit/canonicalize.spec.ts`, `color-palette.spec.ts`, `role-tag-canonical.spec.ts` (NEW)

**Analog:** `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` (lines 1–42, full file).

**Test-harness pattern** (lines 11–13):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeText } from '../../app/plugins/shifty-roster/src/helpers/canonicalize.js';
```

**Assertion pattern** (lines 15–19):

```javascript
test('strips U+2019 from kibbutz canary name', () => {
  // נועם ג'לאל with U+2019 should become נועם גלאל with no apostrophe
  assert.equal(canonicalizeText('נועם ג’לאל'), 'נועם גלאל');
});

test('strips bidi marks (U+200E, U+200F, U+202A..U+202E)', () => {
  assert.equal(canonicalizeText('hello‎world'), 'helloworld');
  assert.equal(canonicalizeText('a‮b‬c'), 'abc');
});

test('returns empty string for null/undefined', () => {
  assert.equal(canonicalizeText(null), '');
  assert.equal(canonicalizeText(undefined), '');
});
```

**Color-palette tests** — assert `pickNextColor(-1) === 0`, `pickNextColor(0) === 2`, `pickNextColor(22) === 0` (wraparound), `pickNextColor(23) === 1`, `PALETTE.length === 24`, and that no two consecutive indices in the natural-order ring share the same hex (uniqueness check).

**Role-tag tests** — assert `canonicalizeRoleTag('Driving') === 'driving'`, `canonicalizeRoleTag('long range comms') === 'long-range-comms'`, `canonicalizeRoleTag('-leading-dash-') === 'leading-dash'`, etc. The output should match the DB CHECK `^[a-z][a-z0-9-]*$` for all valid inputs.

---

### `tests/fixtures/csv/*.csv` (NEW)

**Analog:** `tools/fixtures/kibbutz.sql` (header comment + smart-quote canary at line 35).

**Pattern** — 4 fixture files, each with a leading comment line explaining the test purpose:

```
# clean.csv — happy-path CSV (D-09); 5 rows, all valid, no warnings, no errors
display_name,email,role_tags,seniority,team_id
יוסי כהן,yossi@example.test,driving,5,22222222-2222-2222-2222-222222222222
...
```

```
# smart-quote.csv — D-12 canary; row 1 has U+2019 in display_name (matches kibbutz.sql line 35)
# After canonicalization the name should equal "נועם גלאל" (no apostrophe).
display_name,email,role_tags,seniority,team_id
נועם ג’לאל,noam@example.test,comms,7,...
```

```
# dup-email.csv — D-11; two rows share the same email; pre-flight detects duplicate
```

```
# bidi-mark.csv — D-12; rows contain U+200E/U+200F/U+202A..U+202E that must be stripped
```

---

### `tests/fixtures/db/seed-phase2.sql` (NEW)

**Analog:** `tools/fixtures/kibbutz.sql` (lines 1–40).

**Pattern** — BEGIN; INSERT tenant + admin user + org_unit + role_tag seed rows; COMMIT;. The existing `seed-tenants.ts` (`tests/e2e/_fixtures/seed-tenants.ts`) already seeds the multi-tenant baseline via direct `pg.Client` inserts — **planner check:** decide whether `seed-phase2.sql` is needed as a static fixture OR whether the existing `seedTwoTenants()` helper is extended to include `role_tag` seed rows. Recommend extension over a new SQL fixture (consistency with Phase 1).

---

## Shared Patterns

### Tenant isolation (Layer 1 — session-derived `tenant_id`)

**Source:** `app/plugins/shifty-auth/src/auth/callbacks.js` lines 51–72 (ShiftySessionCallback hydrates `session.user.tenant_id` from `app_user` row keyed by email).

**Apply to:** every Phase 2 page payload + every Phase 2 plugin request handler. The pattern in YAML:

```yaml
payload:
  tenant_id: { _user: tenant_id }   # Layer 1
```

The pattern in plugin JS:

```javascript
const tenant_id = request.user?.tenant_id;
if (!tenant_id) throw new Error('<RequestName>: tenant_id missing from session');
```

### Tenant isolation (Layer 2 — query WHERE filter)

**Source:** `app/pages/admin/manage_org_units.yaml` lines 16–22 (canonical SELECT with `WHERE tenant_id = :tenant_id`).

**Apply to:** every KnexRaw block in every Phase 2 YAML page. The CI grep gate `tools/check-queries.mjs` enforces it — no `-- @gsd-allow-untenanted` exemptions expected.

```sql
WHERE tenant_id = :tenant_id
```

### Tenant isolation (Layer 5 — Postgres RLS for new tables)

**Source:** `db/migrations/0009_rls_policies.up.sql` lines 98–105.

**Apply to:** `role_tag` (and any future new tenant-scoped tables added in Phase 2). RLS policy must be created in the same migration that creates the table:

```sql
ALTER TABLE <new_table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON <new_table>;
CREATE POLICY tenant_isolation ON <new_table>
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

### Audit-on-mutation (Schedule audit row)

**Source:** `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` lines 11–41.

**Apply to:** every Phase 2 mutation page event chain. The pattern in YAML (chained after the primary mutation, per `admin_test_audit.yaml` lines 24–34):

```yaml
events:
  onClick:
    - { id: do_update, type: Request, params: { requestId: update_soldier } }
    - { id: do_audit, type: Request, params: { requestId: audit_write_update } }
    - { id: refresh, type: Request, params: { requestId: list_soldiers } }
```

And the `audit_write_update` request block (one per mutation surface):

```yaml
- id: audit_write_update
  type: AuditWrite
  connectionId: shifts_db
  properties:
    to_state: soldier_updated
    actor_kind: user
    payload_json:
      soldier_id: { _state: form.id }
      changes: { _state: form }
```

### Plugin module-header convention (ESM + dynamic-knex)

**Source:** `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` lines 1–9.

**Apply to:** every file under `app/plugins/shifty-roster/src/connections/requests/`. The dynamic `import('knex')` pattern lets unit tests exercise guard clauses without `knex` installed.

### Plugin manifest + exports

**Source:** `app/plugins/shifty-audit-writer/package.json` (full file, 13 lines).

**Apply to:** `app/plugins/shifty-roster/package.json`. Use `"type": "module"`, `"exports"` map, and `"dependencies"` with `"knex": "*"` (peer-style — knex comes from `@lowdefy/connection-knex`).

### Unit-test harness

**Source:** `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` (full file, 42 lines).

**Apply to:** every `tests/unit/*.spec.ts` (or `.test.mjs` — match Phase 1 extension choice) file. Use `node:test` + `assert/strict`, NOT vitest or jest.

### Playwright API request style

**Source:** `tests/e2e/org-unit-crud.spec.ts` lines 95–110 (POST `/api/request/<page>/<request>` with cookie header + JSON body wrapped in `{ payload: {...} }`).

**Apply to:** every Phase 2 e2e spec. The `Cookie: adminSession.cookies` pattern reuses `signInAs()` from `_fixtures/seed-tenants.ts`.

### Lowdefy connection reference

**Source:** `app/connections/shifts_db.yaml` (already exists; not modified).

**Apply to:** every KnexRaw block — always `connectionId: shifts_db`. Never define a second connection in Phase 2.

---

## No Analog Found

The following Phase 2 files have no close in-repo match. The planner should consult RESEARCH.md or UI-SPEC.md for the canonical pattern.

| File | Role | Reason | Recommended substitute |
|---|---|---|---|
| `app/blocks/color_swatches.yaml` | shared block | No `app/blocks/` directory exists yet — first shared-block file in the repo | UI-SPEC §"Reusable Components — 4. 24-swatch color picker" (lines 626–663) contains the complete recipe |
| `app/blocks/color_dot_cell.yaml` | shared cell-renderer | First shared-block file | UI-SPEC §"Reusable Components — 9. Soldier color-dot cell renderer" (lines 725–739) contains the complete recipe |
| `app/plugins/shifty-roster/src/helpers/palette.js` | pure data export | No data-only module exists in the repo | Pattern provided inline above (PALETTE array as ESM named export); UI-SPEC §"Color B" table is the source of truth for hex values |
| `app/plugins/shifty-roster/src/dispatch/resend.js` | outbound HTTP helper | No outbound-HTTP helper exists in the repo (NextAuth's EmailProvider hides Resend inside the next-auth runtime) | Idiom from `app/plugins/shifty-auth/src/auth/providers.js` lines 28–45 (`createRequire(process.cwd())`); Resend SDK usage from `.planning/research/STACK.md` (resend@6.12.3 best-practices section); retry/backoff from RESEARCH §D-10 step 3 |

---

## Metadata

**Analog search scope:**
- `db/migrations/*.sql` (9 files)
- `app/pages/**/*.yaml` (9 files)
- `app/plugins/**` (both Phase-1 plugins, full source trees)
- `app/lowdefy.yaml` + `app/connections/shifts_db.yaml`
- `tests/e2e/*.spec.ts` (13 files; deep-read for the 3 most relevant: org-unit-crud, cross-tenant-leak, audit-writer)
- `tools/check-queries.mjs`, `tools/fixtures/kibbutz.sql`, `tools/test/invite-code.test.mjs`

**Files scanned:** ~50 total reads (most were partial-range reads after Grep-based location).

**Pattern extraction date:** 2026-05-13

**Key takeaways for planner:**
1. **`manage_invites.yaml` + `manage_org_units.yaml` together cover ~80% of the YAML patterns Phase 2 needs** — clone shape, adjust payload + parameters + table names.
2. **`shifty-audit-writer/` is the canonical custom-request plugin template** — `shifty-roster` should mirror its directory layout (`src/types.js`, `src/connections.js`, `src/connections/requests/*.js`, `package.json`, `tests/*.test.mjs`).
3. **`AuditWrite.js`'s guard-clauses + dynamic-knex + try/finally idiom is the load-bearing JS pattern** — every new plugin request follows it exactly.
4. **`org-unit-crud.spec.ts` is the Playwright HTTP-API test template** — 6 tests per surface (admin happy-path A/B/C + member-blocked D/E/F).
5. **`cross-tenant-leak.spec.ts` already covers Phase 2 pages automatically** because its `collectPageIds()` walker is non-discriminating — verify Phase 2 pages are picked up before writing a new tenant-isolation spec.
6. **PRD §10 has a documentation drift on `roster_import_log`** — the LIVE schema (0007 line 13–22) uses `imported_by` and `source`, NOT `actor_id` + `rows_total`. Plans must reference the live schema.
7. **The bootstrap `employees` page (lowdefy.yaml lines 131–183) must be removed BEFORE migration 0008 runs** — order this in the plan sequencing.

## PATTERN MAPPING COMPLETE
