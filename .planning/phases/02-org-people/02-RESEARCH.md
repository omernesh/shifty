# Phase 2: Org & People — Research

**Researched:** 2026-05-13
**Status:** Ready for planning
**Confidence:** HIGH overall — schema, tenant-isolation pattern, Lowdefy YAML shape, plugin pattern, and Resend SDK paths are all proven by Phase 1 artifacts. MEDIUM on AgGrid tree-table specifics (D-01) and on Auth.js `EmailProvider` re-fire semantics for D-07 "Invite later" — flagged inline.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Org-tree UX & manager scope**
- **D-01** Upgrade `manage_org_units` to an AgGrid tree-table. Each row = an `org_unit` node, indented by `level`, with expand/collapse and a per-row "Add child here" button. `level` is auto-derived from `parent.level + 1` server-side — no NumberInput. Existing flat-list Cards are replaced; existing query + mutation request shapes (tenant_id from `_user`, parameterized SQL) are preserved as the template.
- **D-02** Team-manager rename lives on the same page with Lowdefy conditional visibility. Per-row "Rename" inline button is `visible: { _user: roles contains team_manager AND _row.id in _user.team_ids }`. Admin sees full tree + all controls; team-manager sees full tree (read-only) + Rename only on their own team rows. Single YAML.
- **D-03** Team creation is Phase 2; `shift_slot` templates are Phase 3. Phase-2 team-create writes only the `org_unit` row. The team landing page (`team_detail`) shows a "פתח תבנית משמרות בשלב הבא" placeholder card until Phase 3.
- **D-04** Allow growing `tenant.org_depth` via in-tree "Add child" with confirmation modal. When admin clicks "Add child" on a node at the current `tenant.org_depth`, an AskUserQuestion-style modal asks "ההוספה תעלה את המבנה ל-N רמות. להמשיך?" On confirm, a transactional mutation does `UPDATE tenant SET org_depth = N WHERE id = :tenant_id; INSERT INTO org_unit ...`. Cap at 3. Schedules at the (now non-leaf) root are NOT auto-migrated in Phase 2.

**Soldier CRUD entry points & flow**
- **D-05** Ship both top-level `manage_soldiers` AND per-team embedded members on `team_detail`. `manage_soldiers` is admin's tenant-wide AgGrid; `team_detail` is team-scoped roster view. Both surface "Add soldier" (team_detail prefills `initial_team_id`).
- **D-06** Edit via row→detail page (`soldier_detail/{id}`). Click row → navigate to a Lowdefy page rendering the soldier form (display_name, seniority NumberInput 0–10, role_tags multi-tag with autocomplete from `role_tag` table, phone_e164 TextInput, notes Textarea, status Selector active/archived, color override picker). Single save = single mutating request = single `schedule_audit` row. `notes` is server-side-gated to managers only.
- **D-07** Email is optional at create with "Invite later" button on `soldier_detail`. Email-blank creates soldier row with no `app_user`. `soldier_detail` displays "Invite" button when `app_user` is missing AND email is filled. Invite invokes the same Resend magic-link dispatch path as CSV import — shared dispatch function.
- **D-08** Multi-team membership: soldier_detail Teams multi-select primary, team_detail "Add member" mirror. Both write to the same `membership` table. Each add/remove writes row + `schedule_audit` entry. Archiving a soldier does NOT auto-delete memberships; soldier just stops appearing in pickers via `idx_soldier_tenant_status WHERE status = 'active'`.

**CSV import preview UX & invite dispatch**
- **D-09** Rich preview with editable cells + bulk fix-all actions. AgGrid editable cells for `name`, `email`, `role_tags`, `seniority`, `team_id`. "Fix" toolbar at top: "Lowercase all role_tags", "Trim whitespace", "Assign all blank team_id to: <Selector>". Errored rows (✗) highlighted red and block confirm until cleared; warned rows (⚠) allow proceed.
- **D-10** Synchronous import + invite dispatch with progress bar. On Confirm: (1) one transaction INSERTs all valid soldier + app_user rows + role_tag rows + membership rows (target: <2s); (2) tight Resend-API loop dispatches magic-link emails one-by-one with a Lowdefy progress indicator ("שלחתי 23/50 הזמנות"); (3) Resend 429 triggers NOTF-07-compatible retry with backoff `1s → 4s → 16s`, max 3 attempts per row; (4) on completion, write summary to `roster_import_log`, redirect to result page. **SLO target: 50 rows ≤ 10s.**
- **D-11** Per-row re-invite toggle + bulk "Re-invite all duplicates" button. Duplicate-email rows render with ⚠, dedicated checkbox column "השב הזמנה" (default unchecked). On confirm, checked duplicates regenerate the magic-link (verification_tokens insert) WITHOUT touching other fields. Unchecked duplicates skipped entirely and counted in `rows_skipped`.
- **D-12** Smart-quote canonicalization in the import handler before INSERT. Strip-set: U+2019 (right single quotation mark), U+200E (LRM), U+200F (RLM), U+202A–U+202E (LRE/RLE/PDF/LRO/RLO). Implemented as JS helper in `shifty-roster` plugin. Tested against `tools/fixtures/kibbutz.sql` smart-quote name. Identical canonicalization applied in single-row create handler.
- **D-13** New `role_tag` table per tenant; autocomplete pulls from it. Migration adds:
  ```sql
  CREATE TABLE role_tag (
    id UUID PK, tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, key)
  );
  ```
  with RLS policy mirroring other tenant-scoped tables. Autocomplete: `SELECT key FROM role_tag WHERE tenant_id = :t ORDER BY key`. Unknown tags on CSV preview surface as ⚠ with inline "צור" button. `soldier.role_tags TEXT[]` still holds keys; FK integrity NOT enforced at the array level, but every roster write path validates `role_tags ⊆ role_tag.keys for tenant`.

**Color palette & adjacency rule**
- **D-14** Palette lives in `app/plugins/shifty-roster/palette.js` plugin module export. 24-color array. Exports the helper `pickNextColor({ paletteIndices: number[] }): number`. Plugin also exports the smart-quote canonicalization helper (D-12). Loaded via `app/lowdefy.yaml` plugins list (`file:../../plugins/shifty-roster`).
- **D-15** Adjacency = palette-index ±1. New soldier's color index is `(last_assigned_index_in_team + 2) mod 24`. "Last assigned" tracked as `org_unit.last_color_index SMALLINT` (added in Phase 2 migration). team_detail mutations that INSERT a membership update this column atomically in the same transaction. After 24 soldiers in a team the cycle wraps; identical colors at >24 active members is acceptable v1 trade-off.
- **D-16** Phase 2 ships a minimal `my_profile` page with color override. Accessible to every authenticated role. Renders 24 color swatches as clickable, current `soldier.color` highlighted. Click → UPDATE soldier.color WHERE id = (SELECT id FROM soldier WHERE user_id = _user.user_id AND tenant_id = _user.tenant_id).

### Claude's Discretion

- Exact palette hex values — pick at planning time using Glasbey-style perceptual distance or curated.
- Whether `role_tag` table lives in `0011_role_tag.up.sql` or is folded into `0008_assignment_state_and_legacy_drop.up.sql`. Cleaner is its own migration (`0011_role_tag.up.sql`).
- Migration `0008` timing within Phase 2's plan ordering (likely last plan in the phase; could be Plan 1 if a confidence smoke-test shows the bootstrap `employees` page is no longer needed).
- AgGrid tree-table column shape (D-01).
- Exact Hebrew labels for buttons / error messages / confirmation modals.
- Whether `manage_soldiers` and `manage_org_units` share a navigation-menu grouping (e.g., "ניהול" submenu).

### Deferred Ideas (OUT OF SCOPE)

- Soldier self-service of profile fields beyond color (phone, locale, notifications) — Phase 6/7.
- Schedule migration when growing org_depth — Phase 4+ when schedule data exists.
- `role_tag` rename/delete cascade — v1.1.
- CSV import history view (drill into past `roster_import_log` rows) — Phase 7 polish.
- Bulk-archive soldiers / bulk-edit seniority — v1.1.
- Soldier-without-app_user stale-roster report — v1.1 dashboard.
- GitHub Actions CI — strongly considered for Phase 2 (planner decides).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **ROST-01** | Soldier entity has `id` UUID PK, `tenant_id`, `display_name`, `color` hex, `seniority` 0–10, `role_tags` TEXT[], `phone_e164` nullable, `status` active/archived, `notes` manager-visible | Already in migration 0002 `db/migrations/0002_tenancy_and_org.up.sql` lines 80–93. Phase 2 ADDS no soldier columns — only **uses** the existing schema. |
| **ROST-02** | UUID-only joins; display names are mutable, never used as join keys (smart-quote bug defense) | Existing kibbutz fixture has U+2019 canary; every Phase 2 query joins on `soldier.id`/`user_id`, never on name. Planner enforces in YAML review. |
| **ROST-03** | Admin CRUD soldiers at unit level; team manager edits seniority/role_tags/notes within team scope | D-05 + D-06 page split. RBAC: page-level `auth.roles: [unit_admin, team_manager]` on `soldier_detail`; query filter `WHERE tenant_id = :tenant_id` from session; team-manager UPDATE requests scope to `soldier_id IN (SELECT m.soldier_id FROM membership m WHERE m.org_unit_id = ANY(:team_ids))`. |
| **ROST-04** | Soldier can be member of multiple teams within same tenant via `membership` rows | Existing `membership(soldier_id, org_unit_id, role)` table from 0002 already supports it (UNIQUE on soldier_id+org_unit_id). D-08 surfaces both write surfaces. |
| **ROST-05** | Archived soldiers preserve historical assignments; absent from pickers and rosters | `status='archived'` + existing partial index `idx_soldier_tenant_status WHERE status = 'active'`. All Phase 2 pickers add `WHERE status='active'`. Memberships preserved on archive (D-08). |
| **ROST-06** | Color from 24-color palette (round-robin, no adjacent-color collisions within team); soldier can override in profile | D-14 + D-15 + D-16. `shifty-roster` plugin owns palette + `pickNextColor`. `org_unit.last_color_index SMALLINT` added in Phase 2 migration. `my_profile` page ships override picker. |
| **ROST-07** | Role tags tenant-defined, lowercase kebab-case; UI autocompletes from existing tags but allows new | D-13 `role_tag` table + RLS + inline-create. Canonicalization: regex `^[a-z][a-z0-9-]*$`; client-side toLowerCase + replace spaces with `-`; server-side validation in `shifty-roster` plugin. |
| **ROST-08** | Admin or team_manager uploads CSV at "Roster import" page; columns `name, email, role_tags, seniority, team_id` | New page `app/pages/admin/roster_import.yaml`. `auth.roles: [unit_admin, team_manager]`. `papaparse@5.5.3` server-side parse (D-12 stripping in the same handler). |
| **ROST-09** | CSV import previews row-by-row with per-row validation ✓/⚠/✗; inline edits before confirm | D-09 AgGrid editable cells (`editable: true` per column + `onCellValueChanged` event); preview state held in client `_state.preview_rows`; validate-on-edit in `shifty-roster` plugin's row-validator. |
| **ROST-10** | Duplicate emails within tenant flagged + skipped by default; manager opts to re-invite | D-11. Server-side `SELECT email FROM app_user WHERE tenant_id = :t AND email = ANY(:emails)` pre-flight; client per-row `is_duplicate` flag drives ⚠ + checkbox column. |
| **ROST-11** | Import canonicalizes smart-quote variants (strips U+2019, U+200E, U+200F, U+202A–U+202E) before writing `soldier.display_name` | D-12. JS helper `canonicalizeName` in `shifty-roster` plugin. Belt + braces: also applied in single-row create handler (D-12). Test fixture is `tools/fixtures/kibbutz.sql` row 12 (U+2019 in `נועם ג'לאל`). |
| **ROST-12** | Import dispatches magic-link invite emails via Resend; writes summary row to `roster_import_log` with rows_created/skipped/errored + JSON error details | D-10 sync dispatch. `roster_import_log` table from 0007 ALREADY EXISTS; Phase 2 writes summary row. **NOTE:** the live schema (`db/migrations/0007_imports_and_exports.up.sql`) uses `imported_by` and `source TEXT`, NOT `actor_id` + `rows_total` from PRD §10. Plan must follow the LIVE schema, not PRD §10. |
| **ROST-13** | 50-row CSV imports in <10 seconds | D-10 budgets: <2s DB transaction + <8s for 50 sequential Resend calls (Resend default rate-limit = 2 req/s — see Pitfalls). If 50 rows @ 500ms each → 25s; needs **batched parallel sends** (e.g., 2 concurrent at a time). Planner must validate against Resend rate-limit headers (see Pitfalls §"Resend rate-limit budget"). |
</phase_requirements>

---

## Phase Scope Confirmed

**IN:** Multi-tenant roster end-to-end. Admin upgrades the existing `manage_org_units` page to a tree-table; ships top-level `manage_soldiers` AgGrid + per-team `team_detail` (with embedded members) + per-soldier `soldier_detail/{id}` edit page + `roster_import` (CSV preview/commit/invite) + `my_profile` (color override) + read-only `manage_role_tags` autocomplete admin view. Migration `0008` drops legacy `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries` from `0001` once the bootstrap `employees` page is gone. Migration `0011_role_tag.up.sql` adds the `role_tag` table + RLS; same migration (or a sibling) adds `org_unit.last_color_index SMALLINT NOT NULL DEFAULT 0`. New plugin `shifty-roster` colocates palette + `pickNextColor` + smart-quote canonicalizer + CSV row-validator + the sync Resend dispatch loop. Plays nicely with Phase 1's `shifty-audit-writer` (every Phase 2 mutation writes a `schedule_audit` row).

**OUT:** Shift slots, headcounts, planning windows, availability, rules, solver — those are Phase 3+. Soldier-facing portal beyond `my_profile` color picker. Bulk archive / bulk edit. Tenant #1 migration tool (Phase M, parallel track).

---

## Source Items Inventory

| ID | One-line | CONTEXT.md / D-ID |
|----|----------|-------------------|
| ROST-01 | Soldier table shape (already in 0002) | — schema-existing |
| ROST-02 | UUID-only joins, names mutable | — invariant |
| ROST-03 | Admin/team_manager CRUD scopes | D-03 (RBAC matrix), D-06 |
| ROST-04 | Multi-team `membership` rows | D-08 |
| ROST-05 | Archive preserves history | D-08 |
| ROST-06 | 24-color palette + round-robin + adjacent-safe + override | D-14, D-15, D-16 |
| ROST-07 | role_tag autocomplete + inline-create | D-13 |
| ROST-08 | CSV upload page + required columns | D-09 |
| ROST-09 | Per-row preview + inline edit | D-09 |
| ROST-10 | Duplicate email skip + opt-in re-invite | D-11 |
| ROST-11 | Smart-quote stripping at write time | D-12 |
| ROST-12 | Resend invite dispatch + roster_import_log summary | D-10 |
| ROST-13 | 50-row ≤10s SLO | D-10 |

Decisions D-01..D-04 (org-tree UX) implement TEN-03/TEN-04 follow-ons but those REQ-IDs were completed in Phase 1. Phase 2's coverage of org-tree UI is part of D-01..D-04 (no new REQ-IDs).

---

## Project Constraints (from CLAUDE.md)

- **Lowdefy 5.3 + Postgres 16 + Docker Compose on hpg5 (Windows 11 + Docker Desktop).** Stack pivoted from Appsmith for branding reasons; no UI editor — YAML in `app/` is the source of truth.
- **PsExec wrapping for ANY docker pull/build on hpg5** — credential helper requires interactive session 1. `docker compose up -d`, `docker logs`, `docker compose exec` do NOT need PsExec; `docker compose build`, `docker compose pull`, `docker pull` DO.
- **All hpg5 SSH commands use plink with the documented hostkey** — see CLAUDE.md "SSH access" section.
- **Deploy layout is `C:\shifts-manager\` on hpg5** — Windows-native, no WSL. Mirror of the repo. `.env` only on hpg5 (never committed).
- **Cloudflare Tunnel passthrough** — `https://apps.nesher.co` → `http://192.168.1.133:8080` → Docker port 8080:3000.
- **Branch hygiene:** commit on feature branches, push to `omernesh/shifty` on GitHub.
- **PRD precedence:** §1–§14 are locked; only §15 is open. Phase 2 decisions all sit on locked PRD ground or extend §15 (R8 smart-quote).
- **Tenant isolation: 4-layer defense is release-blocking.** session → query filter → page auth → server-side request role check. Missing any one is a release-blocking bug. Plus a 5th layer (RLS) added in Phase 1.
- **`_user: tenant_id` is the ONLY safe source of tenant_id in any query payload** — `_payload`/`_state` can be forged.
- **pnpm version pin must be `9.15.5`** (not 11.x) — pinned via `corepack prepare pnpm@9.15.5 --activate` in `app/Dockerfile`. Documented in skill `reference/10-deployment.md`.
- **Node `node:22-bookworm` in Lowdefy container** — do NOT switch to Alpine (musl breaks `sharp` + plays badly with `@lowdefy/server`).
- **Hebrew RTL default**; ICU MessageFormat lives in Phase 7 — Phase 2 hardcodes Hebrew labels in YAML with `# i18n: key` markers for later extraction.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Org-tree CRUD + tree-table | Frontend (Lowdefy YAML page) | API (Lowdefy KnexRaw → Postgres) | YAML page renders AgGrid `treeData: true`; KnexRaw fetches flat list with `parent_id`/`level`; AgGrid groups via `getDataPath`. |
| Soldier CRUD (single-row + edit) | API (Lowdefy KnexRaw) | Database (RLS + composite indexes) | `_user: tenant_id` injected on every payload. Mutations write `schedule_audit` row via `AuditWrite` request type from `shifty-audit-writer` plugin. |
| Smart-quote canonicalization | API (`shifty-roster` plugin server function) | — | MUST run on the server before INSERT. Belt + braces: same helper invoked from single-row create AND from CSV import path. |
| CSV parse + per-row validation | API (`shifty-roster` plugin custom request) | Database (pre-flight duplicate-email query) | `papaparse@5.5.3` parses on server (CSV bytes uploaded as base64 from client). Per-row validator returns `{status, errors, warnings}` array; client renders in AgGrid preview. |
| Resend magic-link dispatch | API (`shifty-roster` plugin shared dispatcher) | External Resend API | Same helper for D-07 (single-soldier "Invite later") and D-10 (CSV bulk). Sync loop with NOTF-07 backoff. |
| 24-color round-robin assignment | API (`shifty-roster` plugin `pickNextColor` helper) | Database (`org_unit.last_color_index` atomic UPDATE) | Helper is pure (testable in unit tests). DB write happens in the same transaction as the membership INSERT. |
| Color override (`my_profile` page) | Frontend (Lowdefy YAML page) | API (single KnexRaw UPDATE) | Static 24-color block list rendered in `my_profile`; click → UPDATE `soldier.color` for `(user_id, tenant_id)` from session. |
| RLS tenant isolation | Database (Postgres) | API (Knex `afterCreate` hook sets `app.current_tenant` from session) | Layer 5 of the 4-layer defense; Phase 1 D-07 wires this; Phase 2 inherits, requires nothing new except adding the `role_tag` table to the RLS policy DO-block loop. |
| Audit log writes | API (`shifty-audit-writer` plugin `AuditWrite` request) | Database (`schedule_audit` append-only) | Every Phase 2 mutating page wires `AuditWrite` after the primary mutation succeeds (Phase 1 pattern from `admin_test_audit.yaml`). |

---

## Schema Delta

### Migrations to add in Phase 2

| File | Purpose | Status |
|------|---------|--------|
| `db/migrations/0008_assignment_state_and_legacy_drop.up.sql` | Drop legacy `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries` from migration 0001. Add `assignment.state` column if not present (verify against current `db/migrations/0003_shifts_and_windows.up.sql`). | NEW |
| `db/migrations/0011_role_tag.up.sql` | New `role_tag` table + composite index + RLS policy. | NEW |
| `db/migrations/0012_org_unit_last_color_index.up.sql` *(or merge into 0011)* | Add `org_unit.last_color_index SMALLINT NOT NULL DEFAULT 0`. | NEW |

**Migration numbering:** Phase 1 reserved `0008` for legacy drop (Plan 02 commit comment + CLAUDE.md status section). `0011`/`0012` is the next free slot (existing migrations are `0001`–`0007`, `0009`, `0010`). Planner can either keep `0011_role_tag` + `0012_org_unit_color` as two files (cleaner) or fold both into `0011_role_tag_and_color.up.sql` (one less file). The `0009_rls_policies.up.sql` policy DO-block must be EXTENDED for `role_tag` — either edit 0009 in place (forbidden — it's already deployed at `schema_migrations.version=10`) OR ship a small `0013_rls_role_tag.up.sql` that adds just the new policy. **Recommended: `0011_role_tag.up.sql` includes the RLS policy inline** (Postgres allows `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` in the same migration that creates the table; the canonical 0009 DO-block pattern is for batch-enabling on existing tables).

### `0011_role_tag.up.sql` DDL (RECOMMENDED — copy verbatim into plan)

```sql
-- 0011_role_tag.up.sql -- per-tenant role-tag catalog (D-13)
-- Phase 2 feature; backs autocomplete in soldier_detail + CSV import preview.
-- RLS policy mirrors the pattern from 0009_rls_policies.up.sql.

BEGIN;

CREATE TABLE role_tag (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$'),  -- lowercase kebab-case
    label       TEXT        COLLATE "he-x-icu",  -- optional Hebrew display label
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE INDEX idx_role_tag_tenant ON role_tag(tenant_id);

-- RLS policy (mirrors 0009 pattern)
ALTER TABLE role_tag ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_tag
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
```

### `0012_org_unit_last_color_index.up.sql` DDL

```sql
-- 0012_org_unit_last_color_index.up.sql -- 24-color round-robin anchor (D-15)
-- Tracks the last color index assigned in this team so the next assignment
-- can use (last + 2) mod 24 to avoid adjacent-color collisions.

BEGIN;

ALTER TABLE org_unit
  ADD COLUMN last_color_index SMALLINT NOT NULL DEFAULT -1
    CHECK (last_color_index BETWEEN -1 AND 23);
-- -1 sentinel = "no color assigned yet"; first soldier gets index 0.

COMMIT;
```

### `0008_assignment_state_and_legacy_drop.up.sql` DDL (skeleton)

```sql
-- 0008_assignment_state_and_legacy_drop.up.sql
-- Drops the legacy 0001 tables once Phase 2 supersedes them.
-- Run AFTER the bootstrap /employees page is removed from app/lowdefy.yaml.
--
-- Order: drop in reverse FK dependency to avoid FK violation.
-- Phase 1 D-06 deferred this migration to the Phase 2 boundary.

BEGIN;

-- Drop in reverse FK order
DROP TABLE IF EXISTS time_clock_entries;
DROP TABLE IF EXISTS availability_legacy;  -- renamed in 0004 per Phase 1 Plan 02 decision
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS employees;

-- The trigger function set_updated_at() is still referenced by other tables;
-- DO NOT drop the function.

COMMIT;
```

**Verification checklist before applying 0008** (planner adds to acceptance criteria):
1. `app/lowdefy.yaml` no longer contains the `employees` page (lines 131–183 removed from current file).
2. Any menu link to `/employees` is removed.
3. `tools/check-queries.mjs` does not report violations (since `-- @gsd-allow-untenanted: bootstrap smoke-test surface` comment on the employees query becomes moot).
4. CI Playwright pen-test fixture re-runs without the page in scope.

### Existing tables Phase 2 uses (DO NOT modify)

| Table | Phase 1 source | Phase 2 usage |
|-------|----------------|---------------|
| `tenant` | 0002 | UPDATE `org_depth` on grow (D-04). |
| `org_unit` | 0002 | CRUD via tree-table (D-01). +`last_color_index` column (this phase). |
| `app_user` | 0002 | INSERT on CSV import + single-row create with email; UPDATE on edit. |
| `soldier` | 0002 | INSERT/UPDATE — primary domain object of this phase. |
| `membership` | 0002 | INSERT on soldier-add or team-assign; DELETE on team-leave. |
| `users` (Auth.js) | 0002 | INSERT on email-known soldiers (KnexAdapter writes; we trigger via Resend `Login` action → NextAuth flow). |
| `verification_tokens` (Auth.js) | 0002 | Magic-link tokens — KnexAdapter manages; "Re-invite" inserts a fresh row by triggering `Login` action again. |
| `roster_import_log` | 0007 | INSERT one summary row per import (append-only per 0010 REVOKE). |
| `schedule_audit` | 0006 | INSERT one row per mutation via `AuditWrite` request from `shifty-audit-writer`. |

### Schema discrepancy — `roster_import_log`

| Source | Column names |
|--------|--------------|
| **Live `db/migrations/0007_imports_and_exports.up.sql`** | `id, tenant_id, imported_by, source, rows_created, rows_skipped, rows_errored, error_details, created_at` |
| **PRD §10 (line 1167)** | `id, tenant_id, actor_id, started_at, finished_at, rows_total, rows_created, rows_skipped, rows_errored, error_details` |

**Resolution:** The live schema wins (`imported_by` not `actor_id`; `source` is the import-source descriptor, e.g., `'csv'`; no `rows_total`/`finished_at`). PRD §10 has a documentation drift that should be flagged in the verification step. Plan tasks MUST use the live schema column names.

[VERIFIED: `db/migrations/0007_imports_and_exports.up.sql` lines 13–22]

---

## Tenant Isolation Pattern (4-Layer Defense)

This is the most release-critical pattern in the entire project. Every Phase 2 page + request must implement all four layers; the 5th layer (RLS) is automatic via the Knex `afterCreate` hook from Phase 1.

### Layer 1 — Session-derived `tenant_id`

Inherited from Phase 1; the `ShiftySessionCallback` (`app/plugins/shifty-auth/src/auth/callbacks.js` lines 51–72) hydrates `session.user.tenant_id` at sign-in. Phase 2 reads it via `_user: tenant_id` in any client-side context (page block visibility, request payload).

**Anti-pattern:** Accepting `tenant_id` from `_payload` or `_state` or URL `_input`. The forge test is mandatory.

### Layer 2 — Query-level WHERE filter

EVERY KnexRaw request in Phase 2 YAML must include `WHERE tenant_id = :tenant_id` (or for INSERT: `tenant_id` as a column being written from `_user: tenant_id`). The CI grep gate `tools/check-queries.mjs` enforces this — no `-- @gsd-allow-untenanted:` exemptions expected in Phase 2 (the only ones in Phase 1 are for `/employees` smoke surface + pre-tenant signup flows, both inappropriate here).

**Canonical Phase 2 SELECT pattern** (from `app/pages/admin/manage_org_units.yaml` lines 9–22):

```yaml
- id: list_soldiers
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id:
      _user: tenant_id    # Layer 1
  properties:
    query: |
      SELECT id, display_name, color, seniority, role_tags, phone_e164, status, notes
      FROM soldier
      WHERE tenant_id = :tenant_id    # Layer 2
        AND status = 'active'         # ROST-05 — hide archived
      ORDER BY display_name
    parameters:
      tenant_id: { _payload: tenant_id }
```

**Canonical Phase 2 INSERT pattern** (from `app/pages/admin/manage_org_units.yaml` lines 24–43):

```yaml
- id: create_soldier
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }   # Layer 1
    display_name: { _state: new_soldier_form.display_name }
    seniority: { _state: new_soldier_form.seniority }
    role_tags: { _state: new_soldier_form.role_tags }
    email: { _state: new_soldier_form.email }
  properties:
    query: |
      INSERT INTO soldier (tenant_id, display_name, seniority, role_tags)
      VALUES (:tenant_id, :display_name, :seniority, :role_tags)
      RETURNING id, display_name, color
    parameters:
      tenant_id: { _payload: tenant_id }
      display_name: { _payload: display_name }
      seniority: { _payload: seniority }
      role_tags: { _payload: role_tags }
```

### Layer 3 — Page-level `auth.roles`

Every Phase 2 page declares `auth.roles` at the top level. Lowdefy 5.3.0 **does not support request-level `auth.roles`** (Phase 1 SUMMARY confirms; the project skill `reference/08-auth.md` lines 65–72 documents the page-level shape). Mutating pages MUST have explicit role lists:

| Page | `auth.roles` |
|------|--------------|
| `manage_org_units` (upgraded) | `[unit_admin, team_manager]` — team_manager has read + rename-own |
| `manage_soldiers` (new) | `[unit_admin]` — admin-only tenant-wide view |
| `team_detail/{id}` (new) | `[unit_admin, team_manager]` |
| `soldier_detail/{id}` (new) | `[unit_admin, team_manager]` — team_manager edits scoped via row check below |
| `roster_import` (new) | `[unit_admin, team_manager]` (PRD §8.3 line 767 says `team_manager` C+R+U on `roster_import_log`) |
| `manage_role_tags` (new — read-only) | `[unit_admin]` |
| `my_profile` (new) | every authenticated user — no role gate needed (`auth.pages.protected: true` from Phase 1's lowdefy.yaml line 24 already covers it) |

### Layer 4 — Server-side role check on mutate requests (workaround)

Since Lowdefy 5.3.0 **does not** expose `request.properties.auth.roles`, layer 4 is achieved by:
1. **Page-level auth.roles** guarantees the request can only be invoked by an authorized role (combined with `tools/check-queries.mjs --auth-blocks` gate which verifies every mutating request lives on an auth-gated page).
2. **Query-embedded role check for narrower scopes** — for team_manager-scoped UPDATE requests (e.g., editing a soldier in their team only), embed the team-id check directly in the SQL:

```yaml
properties:
  query: |
    UPDATE soldier
    SET seniority = :seniority,
        role_tags = :role_tags,
        notes = CASE WHEN :is_manager_or_admin THEN :notes ELSE notes END
    WHERE id = :soldier_id
      AND tenant_id = :tenant_id
      AND (
        -- Layer 4: server-side scope check (cannot be spoofed; team_ids derived from session)
        :is_admin
        OR EXISTS (
          SELECT 1 FROM membership m
          WHERE m.soldier_id = :soldier_id
            AND m.org_unit_id = ANY(:caller_team_ids)
        )
      )
    RETURNING id
  parameters:
    tenant_id: { _payload: tenant_id }
    soldier_id: { _payload: soldier_id }
    seniority: { _payload: seniority }
    role_tags: { _payload: role_tags }
    notes: { _payload: notes }
    is_admin: { _payload: is_admin }
    is_manager_or_admin: { _payload: is_manager_or_admin }
    caller_team_ids: { _payload: caller_team_ids }
payload:
  tenant_id: { _user: tenant_id }
  soldier_id: { _input: soldier_id }   # from URL: /soldier_detail/abc-123
  is_admin: { _array.includes: { on: { _user: roles }, value: unit_admin } }
  is_manager_or_admin:
    _or:
      - { _array.includes: { on: { _user: roles }, value: unit_admin } }
      - { _array.includes: { on: { _user: roles }, value: team_manager } }
  caller_team_ids: { _user: team_ids }
```

### Layer 5 — Postgres RLS (already in Phase 1)

Migration `0009_rls_policies.up.sql` enables RLS on 22 tables and the `tenant` table; the policy is `tenant_id = current_setting('app.current_tenant', true)::uuid`. Phase 1's Knex `afterCreate` hook (`app/plugins/shifty-auth/src/hooks/knex-tenant.js`) sets the variable per connection.

**Phase 2 must extend 0009's table list to include `role_tag`.** Recommended approach: include `CREATE POLICY` + `ENABLE ROW LEVEL SECURITY` directly in `0011_role_tag.up.sql` (see DDL above), not in a follow-up policy migration. This is consistent with PRD §8.2 ("every domain table has tenant_id; RLS on every one").

### Forge-test for plan acceptance

Every new Phase 2 page is auto-covered by `tests/e2e/cross-tenant-leak.spec.ts` because it walks `app/pages/**/*.yaml` (Phase 1 D-10 + verification). The plan acceptance criteria must include: "all new pages return 0 tenant-B IDs when authenticated as tenant-A". Specifically:
- `manage_soldiers` — query MUST filter; tenant-B soldier UUID must not appear in any response body.
- `roster_import` — POST a CSV containing tenant-B's existing email; expect duplicate-detection within tenant-A scope only (must NOT match the tenant-B row).
- `soldier_detail/<tenantB-soldier-id>` — must 403 or render no data; URL forge attempt logged.

---

## org_unit Tree

### Storage shape — keep adjacency list

The existing schema is **adjacency list** (`org_unit.parent_id` + `level`) with `UNIQUE (tenant_id, parent_id, name)`. For Phase 2's depth ≤ 3 + small tenants (≤50 soldiers, ≤10 org_units typical), adjacency list is the right call:

- **No need for ltree or closure table.** Closure table is the canonical "all descendants" pattern but tenants here have ≤ 8 nodes; flat-fetch + client-side tree assembly is faster and simpler. Postgres `ltree` extension is unnecessary overhead.
- **"All soldiers under unit X"** is solved by a recursive CTE OR by fetching the whole tree client-side and traversing — given the small N, client-side is preferred (one query, no recursive CTE compile time).
- **Order-by:** sort by `(level, name)` to render parents before children in flat list mode; AgGrid `treeData` rebuilds the tree from `getDataPath`.

### Lowdefy + AgGrid tree-table recipe (MEDIUM confidence on exact API)

AgGrid 32.3.9 (wrapped by `@lowdefy/blocks-aggrid@5.3.0`) supports tree data via `treeData: true` + `getDataPath: (data) => string[]`. The flat data shape must include the parent path; build it client-side from the recursive flat fetch.

```yaml
- id: list_units
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
  properties:
    query: |
      WITH RECURSIVE tree AS (
        SELECT id, parent_id, level, name,
               ARRAY[name]::text[] AS path
        FROM org_unit
        WHERE tenant_id = :tenant_id AND parent_id IS NULL
        UNION ALL
        SELECT ou.id, ou.parent_id, ou.level, ou.name,
               tree.path || ou.name
        FROM org_unit ou
        JOIN tree ON ou.parent_id = tree.id
        WHERE ou.tenant_id = :tenant_id
      )
      SELECT id, parent_id, level, name, path FROM tree
      ORDER BY path
    parameters:
      tenant_id: { _payload: tenant_id }

blocks:
  - id: tree_grid
    type: AgGridAlpine
    properties:
      rowData: { _request: list_units }
      treeData: true
      animateRows: true
      groupDefaultExpanded: -1     # expand all
      autoGroupColumnDef:
        headerName: יחידה
        minWidth: 280
        cellRendererParams:
          suppressCount: false
      getDataPath:
        _function:
          __args: 0
          __return: { __args: 0.path }   # data.path is the ARRAY[...] from recursive CTE
      columnDefs:
        - { field: level, headerName: רמה, width: 80 }
        # Per-row "Rename" inline button gated on D-02 visibility:
        - field: actions
          headerName: פעולות
          cellRenderer:
            _function:
              __args: 0
              __return: |
                <button onclick="..." style="visibility:visible">
                  שינוי שם
                </button>
        # Per-row "Add child here" button:
        - field: add_child
          headerName: 'הוסף ילד'
          cellRenderer:
            _function:
              __args: 0
              __return: |
                <button onclick="...">+ הוסף ילד</button>
```

**Risk note (MEDIUM confidence):** The exact `cellRenderer` HTML interop for triggering Lowdefy events from a button inside AgGrid is not documented in the project skill. Two safer patterns to consider during planning:
1. **`onCellClicked` event** fires when ANY cell is clicked — branch in the handler on `column.field` to dispatch to the right action. This avoids HTML buttons.
2. **A side panel/Modal** that opens on `onRowClicked` with the row's actions — cleaner UX than per-row buttons in AgGrid.

Lowdefy `cellRenderer` accepting `_function` returning an HTML string is documented (`reference/05-blocks-data.md` lines 109). However, the bridge from a click on that HTML back into a Lowdefy event is **not** documented in the skill. The planner should verify in a spike (≤ 2h) and prefer pattern (1) or (2) above if HTML-button bridging is fragile.

### "All soldiers under unit X" query

For team-scoped views, recursive CTE pattern:

```sql
WITH RECURSIVE subtree AS (
  SELECT id FROM org_unit WHERE id = :root_id AND tenant_id = :tenant_id
  UNION ALL
  SELECT ou.id FROM org_unit ou JOIN subtree ON ou.parent_id = subtree.id
)
SELECT s.id, s.display_name, s.color, s.seniority, s.role_tags
FROM soldier s
JOIN membership m ON m.soldier_id = s.id
WHERE m.org_unit_id IN (SELECT id FROM subtree)
  AND s.tenant_id = :tenant_id
  AND s.status = 'active'
ORDER BY s.display_name;
```

### Grow-org_depth confirmation transaction (D-04)

```yaml
- id: grow_org_depth_and_add_child
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
    parent_id: { _state: add_child_target_id }
    new_name: { _state: add_child_name_input }
    new_depth: { _state: confirmed_new_depth }
  properties:
    query: |
      WITH depth_update AS (
        UPDATE tenant SET org_depth = :new_depth
        WHERE id = :tenant_id AND :new_depth > org_depth AND :new_depth <= 3
        RETURNING id
      ),
      new_unit AS (
        INSERT INTO org_unit (tenant_id, parent_id, level, name)
        SELECT :tenant_id, :parent_id,
               (SELECT level + 1 FROM org_unit WHERE id = :parent_id AND tenant_id = :tenant_id),
               :new_name
        WHERE EXISTS (SELECT 1 FROM depth_update)
           OR (SELECT level + 1 FROM org_unit WHERE id = :parent_id AND tenant_id = :tenant_id) <= (SELECT org_depth FROM tenant WHERE id = :tenant_id)
        RETURNING id, level
      )
      SELECT id, level FROM new_unit
    parameters:
      tenant_id: { _payload: tenant_id }
      parent_id: { _payload: parent_id }
      new_name: { _payload: new_name }
      new_depth: { _payload: new_depth }
```

The client computes `new_depth` before showing the modal; if `new_depth <= existing org_depth` no UPDATE happens (idempotent). The CHECK constraint `org_depth BETWEEN 1 AND 3` (from migration 0002 line 28) hard-caps depth at 3.

---

## soldier CRUD

### Single-row "Add soldier" form (top-level `manage_soldiers` + per-team `team_detail`)

Form pattern follows `app/pages/admin/manage_invites.yaml` create_section pattern (lines 94–130). Hebrew labels hardcoded, ICU extraction marker:

```yaml
- id: new_soldier_form
  type: Form
  properties: { title: הוספת חייל }
  blocks:
    - id: new_soldier_form.display_name
      type: TextInput
      properties: { label: שם מלא }
      required: true
    - id: new_soldier_form.email
      type: TextInput
      properties:
        label: 'אימייל (ניתן להשאיר ריק ולשלוח הזמנה אחר כך)'
      validate:
        - type: email
          message: כתובת אימייל לא תקפה
    - id: new_soldier_form.seniority
      type: NumberInput
      properties: { label: דרגת ותק, min: 0, max: 10 }
      required: true
      properties:
        defaultValue: 0
    - id: new_soldier_form.role_tags
      type: TagSelector
      properties:
        label: תגיות תפקיד
        # Autocomplete from role_tag table (see Role Tag section)
        options: { _request: list_role_tags }
    - id: new_soldier_form.team_id
      type: Selector
      properties:
        label: צוות
        options: { _request: list_leaf_teams }
        # On team_detail page, prefill from _input.team_id; on manage_soldiers, required.
        defaultValue: { _input: team_id }
    - id: new_soldier_form.phone_e164
      type: TextInput
      properties: { label: 'טלפון (פורמט בינלאומי +972...)' }
    - id: new_soldier_form.submit
      type: Button
      properties: { title: צור חייל, type: primary }
      events:
        onClick:
          - { id: validate, type: Validate, params: new_soldier_form }
          - { id: do_create, type: Request, params: { requestId: create_soldier_tx } }
          - { id: log_audit, type: Request, params: { requestId: audit_soldier_create } }
          - { id: refresh, type: Request, params: { requestId: list_soldiers } }
          - { id: reset, type: Reset, params: new_soldier_form }
```

The `create_soldier_tx` request is the all-in-one transaction:

```sql
-- Single transaction: canonicalize display_name → INSERT soldier
-- → optional INSERT app_user (if email present) → INSERT membership
-- → atomic UPDATE org_unit.last_color_index → RETURN soldier shape
-- Implemented as a custom `CreateSoldier` request type in the shifty-roster plugin
-- (preferred over a 5-CTE KnexRaw because the canonicalize step is JS-side).

-- The custom request takes payload:
--   { tenant_id, display_name_raw, email_raw, seniority, role_tags, team_id, phone_e164 }
-- And returns { soldier_id, color_assigned, app_user_id }
```

Alternative: pure KnexRaw with canonicalization happening client-side via a Lowdefy `_function` operator. **Strongly discourage** — the canonicalization rule is a write-time invariant and MUST run server-side, where it can be tested.

### Edit page `soldier_detail/{id}` (D-06 row→detail flow)

```yaml
id: soldier_detail
type: PageHeaderMenu
auth:
  roles: [unit_admin, team_manager]
properties:
  title: 'עריכת חייל | shifty'
requests:
  - id: load_soldier
    type: KnexRaw
    connectionId: shifts_db
    payload:
      tenant_id: { _user: tenant_id }
      soldier_id: { _input: id }
    properties:
      query: |
        SELECT s.id, s.display_name, s.color, s.seniority, s.role_tags,
               s.phone_e164, s.status, s.notes, au.email,
               (au.id IS NOT NULL) AS has_app_user,
               COALESCE(
                 (SELECT array_agg(m.org_unit_id) FROM membership m
                  WHERE m.soldier_id = s.id AND m.tenant_id = :tenant_id),
                 '{}'::uuid[]
               ) AS team_ids
        FROM soldier s
        LEFT JOIN app_user au ON au.id = s.user_id
        WHERE s.id = :soldier_id AND s.tenant_id = :tenant_id
      parameters:
        tenant_id: { _payload: tenant_id }
        soldier_id: { _payload: soldier_id }
blocks:
  - id: soldier_form
    type: Form
    blocks:
      - id: soldier_form.display_name
        type: TextInput
        properties:
          label: שם מלא
          defaultValue: { _request: load_soldier[0].display_name }
      # ... seniority, role_tags, phone, status
      - id: soldier_form.notes
        type: TextArea
        properties:
          label: 'הערות (גלוי למנהלים בלבד)'
          defaultValue: { _request: load_soldier[0].notes }
        visible:
          _or:
            - { _array.includes: { on: { _user: roles }, value: unit_admin } }
            - { _array.includes: { on: { _user: roles }, value: team_manager } }
      - id: soldier_form.teams
        type: MultipleSelector
        properties:
          label: צוותים
          options: { _request: list_leaf_teams }
          defaultValue: { _request: load_soldier[0].team_ids }
      - id: soldier_form.color
        # 24-color swatch picker block — reusable in my_profile
        type: ColorSwatchPicker        # custom block, OR built from Radio + Cards
        properties:
          options: { _ref: ../partials/color_swatches.yaml }
          defaultValue: { _request: load_soldier[0].color }
      - id: invite_button
        type: Button
        properties:
          title: 'שלח הזמנה'
          type: dashed
        visible:
          _and:
            - _not: { _request: load_soldier[0].has_app_user }
            - { _request: load_soldier[0].email }
        events:
          onClick:
            # Calls the same Resend dispatcher used by CSV import (D-07)
            - { id: send_invite, type: Request, params: { requestId: send_single_invite } }
```

### Archive vs delete

PRD §7.3 says soldiers are **archived**, never deleted (history preservation). Migration 0002 line 89 already has `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))`. The Phase 2 archive flow is a single UPDATE:

```sql
UPDATE soldier SET status = 'archived', updated_at = now()
WHERE id = :soldier_id AND tenant_id = :tenant_id
RETURNING id;
```

Memberships are NOT cascade-deleted (D-08). The existing partial index `idx_soldier_tenant_status WHERE status = 'active'` (migration 0002 line 96) keeps pickers fast.

---

## CSV Import Pipeline

### Architecture

```
[Browser]                                                 [Server]
                                                          (`shifty-roster` plugin)
┌──────────────────┐                                      ┌─────────────────────┐
│ <input type=file>│  base64-encoded                      │ ParseCsv request    │
│   onChange       │ ───────────────────────────────────▶ │  (papaparse 5.5.3)  │
└──────────────────┘                                      └──────────┬──────────┘
                                                                     │
                                                                     ▼
                                                          ┌─────────────────────┐
                                                          │ Per-row validate    │
                                                          │ + canonicalize      │
                                                          │ (smart-quote strip) │
                                                          └──────────┬──────────┘
                                                                     │
                                                                     ▼
                                                          ┌─────────────────────┐
                                                          │ Pre-flight checks   │
                                                          │  - duplicate email  │
                                                          │  - unknown team_id  │
                                                          │  - unknown role_tag │
                                                          └──────────┬──────────┘
                                                                     │
┌──────────────────┐  preview rows array                              │
│ AgGrid editable  │ ◀───────────────────────────────────────────────┘
│   preview        │
│ (D-09 bulk fixes)│
└────────┬─────────┘
         │  edit cells, click "Confirm"
         ▼
┌──────────────────┐                                      ┌─────────────────────┐
│ Confirm button   │  rows[]                              │ ImportRoster        │
│  POST            │ ───────────────────────────────────▶ │  request            │
└──────────────────┘                                      └──────────┬──────────┘
                                                                     │ 1. one DB transaction
                                                                     │    (INSERT soldier + app_user
                                                                     │     + membership rows)
                                                                     ▼
                                                          ┌─────────────────────┐
                                                          │ Sync Resend loop    │
                                                          │  (sleep ~600ms      │
                                                          │   between sends to  │
                                                          │   respect 2 req/s)  │
                                                          └──────────┬──────────┘
                                                                     │
                                                                     ▼ progress events
                                                          ┌─────────────────────┐
                                                          │ INSERT roster_import│
                                                          │  _log summary row   │
                                                          └─────────────────────┘
```

### Step 1: File upload (client → server)

Lowdefy 5.3 ships `Upload` (block-core: see skill `reference/04-blocks-core.md` line 207: "`Upload` — generic upload that posts to a request"). The block emits the file content as a base64 string in its state. The server-side custom request decodes:

```yaml
- id: csv_upload_input
  type: Upload
  properties:
    label: 'טען קובץ CSV (UTF-8)'
    accept: '.csv,text/csv'
    multiple: false
- id: parse_btn
  type: Button
  properties: { title: נתח קובץ }
  events:
    onClick:
      - { id: parse, type: Request, params: { requestId: parse_csv_request } }

# Server-side request (custom type from shifty-roster plugin)
- id: parse_csv_request
  type: ParseCsvAndValidate
  connectionId: shifts_db          # passes connection for duplicate-email check
  payload:
    tenant_id: { _user: tenant_id }
    file_b64: { _state: csv_upload_input }
  properties:
    # Server-side; plugin reads payload.file_b64, parses, validates,
    # writes back rows array.
```

### Step 2: Server-side parse (papaparse 5.5.3)

[VERIFIED: `npm view papaparse version` → 5.5.3]

```javascript
// app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js
import Papa from 'papaparse';
import { canonicalizeDisplayName, kebabCase } from '../../helpers/text.js';

const REQUIRED_HEADERS = ['name', 'email', 'role_tags', 'seniority', 'team_id'];

async function ParseCsvAndValidate({ request, connection }) {
  const { default: knex } = await import('knex');
  const csvText = Buffer.from(request.properties.file_b64, 'base64').toString('utf-8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  // Validate headers
  const missingHeaders = REQUIRED_HEADERS.filter(h => !parsed.meta.fields.includes(h));
  if (missingHeaders.length) {
    throw new Error(`חסרות עמודות: ${missingHeaders.join(', ')}`);
  }

  const db = knex(connection);
  try {
    // Pre-flight: load existing emails for duplicate detection
    const tenantId = request.user.tenant_id;
    const incomingEmails = parsed.data.map(r => r.email).filter(Boolean);
    const existingEmails = new Set(
      (await db('app_user').select('email').where('tenant_id', tenantId)
        .whereIn('email', incomingEmails)).map(r => r.email.toLowerCase())
    );
    const validTeamIds = new Set(
      (await db('org_unit').select('id').where('tenant_id', tenantId)).map(r => r.id)
    );
    const validRoleTagKeys = new Set(
      (await db('role_tag').select('key').where('tenant_id', tenantId)).map(r => r.key)
    );

    // Per-row validation + canonicalization
    const rows = parsed.data.map((raw, idx) => {
      const canonicalName = canonicalizeDisplayName(raw.name ?? '');
      const email = (raw.email ?? '').trim().toLowerCase();
      const seniority = parseInt(raw.seniority ?? '0', 10);
      const tags = (raw.role_tags ?? '').split('|').map(s => s.trim()).filter(Boolean).map(kebabCase);
      const teamId = (raw.team_id ?? '').trim();

      const errors = [];
      const warnings = [];

      if (!canonicalName) errors.push('שם חסר');
      if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) errors.push('אימייל לא תקף');
      if (Number.isNaN(seniority) || seniority < 0 || seniority > 10) errors.push('דרגת ותק לא בטווח 0-10');
      if (teamId && !validTeamIds.has(teamId)) errors.push('יחידה לא קיימת');
      if (email && existingEmails.has(email)) warnings.push('כפילות אימייל');
      const unknownTags = tags.filter(t => !validRoleTagKeys.has(t));
      if (unknownTags.length) warnings.push(`תגיות חדשות: ${unknownTags.join(', ')}`);

      return {
        row_index: idx,
        display_name_raw: raw.name,
        display_name: canonicalName,
        email,
        seniority,
        role_tags: tags,
        team_id: teamId || null,
        phone_e164: raw.phone_e164 ?? null,
        is_duplicate: email && existingEmails.has(email),
        unknown_tags: unknownTags,
        status: errors.length ? 'error' : (warnings.length ? 'warn' : 'ok'),
        errors,
        warnings,
        re_invite: false   // user toggles in preview
      };
    });

    return { rows, total: rows.length };
  } finally {
    await db.destroy();
  }
}

ParseCsvAndValidate.schema = {
  type: 'object',
  required: ['file_b64'],
  properties: { file_b64: { type: 'string' } }
};
ParseCsvAndValidate.connectionType = 'Knex';
export default ParseCsvAndValidate;
```

Same pattern as `shifty-audit-writer/src/connections/requests/AuditWrite.js` (Phase 1 prior art) — dynamic `import('knex')` to allow unit tests without DB; `request.user.tenant_id` from session (NEVER trust payload).

### Step 3: Preview UI (D-09 — AgGrid editable cells + bulk fix toolbar)

```yaml
- id: preview_section
  type: Card
  visible: { _state: parsed_rows }
  blocks:
    # Bulk-fix toolbar (D-09)
    - id: fix_toolbar
      type: Box
      blocks:
        - id: lowercase_tags_btn
          type: Button
          properties: { title: 'הפוך תגיות לאותיות קטנות' }
          events:
            onClick:
              - id: lowercase
                type: SetState
                params:
                  parsed_rows:
                    _array.map:
                      on: { _state: parsed_rows }
                      callback:
                        _function:
                          __args: 0
                          __return:
                            # ... transform row, lowercase its role_tags
        - id: assign_default_team_select
          type: Selector
          properties:
            placeholder: 'הקצה צוות לכל השורות הריקות'
            options: { _request: list_leaf_teams }
        - id: assign_default_team_btn
          type: Button
          properties: { title: הקצה לכל השורות הריקות }
        - id: reinvite_all_duplicates_btn
          type: Button
          properties: { title: השב הזמנות לכל הכפילויות }

    # Preview grid
    - id: preview_grid
      type: AgGridAlpine
      properties:
        rowData: { _state: parsed_rows }
        defaultColDef:
          editable: true        # D-09: any cell editable
          resizable: true
        enableRtl: true         # Hebrew RTL data table support
        columnDefs:
          - field: status
            headerName: 'מצב'
            editable: false
            width: 70
            cellRenderer:
              _function:
                __args: 0
                __return:
                  _if:
                    test: { _eq: [{ __args: 0.value }, 'ok'] }
                    then: '✓'
                    else:
                      _if:
                        test: { _eq: [{ __args: 0.value }, 'warn'] }
                        then: '⚠'
                        else: '✗'
            cellStyle:
              _function:
                __args: 0
                __return:
                  backgroundColor:
                    _if:
                      test: { _eq: [{ __args: 0.value }, 'error'] }
                      then: '#fee'
                      else: '#fff'
          - field: display_name
            headerName: שם
          - field: email
            headerName: אימייל
          - field: role_tags
            headerName: תגיות
          - field: seniority
            headerName: ותק
            width: 80
          - field: team_id
            headerName: צוות
          - field: re_invite
            headerName: 'השב הזמנה'
            cellRenderer: 'agCheckboxCellRenderer'
            cellEditor: 'agCheckboxCellEditor'
            editable: true
            hide:
              _not: { _state.parsed_has_duplicates }
      events:
        onCellValueChanged:
          # Re-validate the row on every cell edit; D-09 inline-edit
          - id: revalidate_row
            type: Request
            params:
              requestId: validate_single_row

    # Confirm button (disabled if any error row)
    - id: confirm_import_btn
      type: Button
      properties:
        title: 'אשר ייבוא'
        type: primary
        disabled:
          _gt:
            - _array.length:
                _array.filter:
                  on: { _state: parsed_rows }
                  callback:
                    _function:
                      __args: 0
                      __return: { _eq: [{ __args: 0.status }, 'error'] }
            - 0
      events:
        onClick:
          - { id: do_import, type: Request, params: { requestId: commit_import } }
          - { id: show_result, type: Link, params: { pageId: roster_import_result } }
```

### Step 4: Commit transaction (D-10)

```javascript
// app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js
import { canonicalizeDisplayName } from '../../helpers/text.js';
import { pickNextColor } from '../../helpers/palette.js';
import { sendMagicLink } from '../../helpers/invite.js';

async function CommitRosterImport({ request, connection }) {
  const { default: knex } = await import('knex');
  const db = knex(connection);
  const tenantId = request.user.tenant_id;
  const importedBy = request.user.user_id;
  const rows = request.properties.rows;

  let rowsCreated = 0;
  let rowsSkipped = 0;
  let rowsErrored = 0;
  const errorDetails = [];

  // STAGE 1: DB transaction (target: <2s)
  await db.transaction(async (tx) => {
    for (const row of rows) {
      if (row.status === 'error') { rowsErrored++; errorDetails.push({ row, reason: 'error_state' }); continue; }
      if (row.is_duplicate && !row.re_invite) { rowsSkipped++; continue; }

      // 1a. Insert any unknown role tags
      for (const tag of row.unknown_tags || []) {
        await tx('role_tag').insert({ tenant_id: tenantId, key: tag }).onConflict(['tenant_id', 'key']).ignore();
      }

      // 1b. Insert or fetch app_user
      let appUserId = null;
      if (row.email) {
        const existing = await tx('app_user').where({ tenant_id: tenantId, email: row.email }).first();
        if (existing) {
          appUserId = existing.id;
        } else {
          const [{ id }] = await tx('app_user').insert({
            tenant_id: tenantId, email: row.email, display_name: row.display_name, locale: 'he'
          }).returning('id');
          appUserId = id;
        }
      }

      // 1c. Round-robin color
      let colorIndex = 0;
      if (row.team_id) {
        const { last_color_index: lastIdx } = await tx('org_unit').select('last_color_index').where({ id: row.team_id }).first();
        colorIndex = pickNextColor({ lastIndex: lastIdx });
        await tx('org_unit').where({ id: row.team_id }).update({ last_color_index: colorIndex });
      }
      const colorHex = PALETTE[colorIndex];

      // 1d. Insert soldier (canonical display_name)
      const [{ id: soldierId }] = await tx('soldier').insert({
        tenant_id: tenantId,
        user_id: appUserId,
        display_name: canonicalizeDisplayName(row.display_name),
        seniority: row.seniority,
        role_tags: row.role_tags,
        phone_e164: row.phone_e164,
        color: colorHex,
        status: 'active'
      }).returning('id');

      // 1e. Insert membership if team_id provided
      if (row.team_id) {
        await tx('membership').insert({
          tenant_id: tenantId, soldier_id: soldierId, org_unit_id: row.team_id, role: 'member'
        }).onConflict(['soldier_id', 'org_unit_id']).ignore();
      }

      rowsCreated++;
      row._created_id = soldierId;
    }
  });

  // STAGE 2: Resend dispatch (sync loop with backoff)
  const RESEND_RATE_LIMIT_MS = 500;  // 2 req/s = one every 500ms
  for (const row of rows) {
    if (row.status === 'error' || !row.email) continue;
    if (row.is_duplicate && !row.re_invite) continue;
    try {
      await sendMagicLink({ email: row.email, locale: 'he' });
      // emit progress event here (Lowdefy custom progress block — TBD by planner)
    } catch (err) {
      // Retry with NOTF-07 backoff: 1s, 4s, 16s
      let sent = false;
      for (const delay of [1000, 4000, 16000]) {
        await sleep(delay);
        try { await sendMagicLink({ email: row.email }); sent = true; break; } catch {}
      }
      if (!sent) {
        errorDetails.push({ row, reason: 'resend_failed', message: err.message });
        // Soldier row exists in DB but invite failed — flag in result page; manager can retry from soldier_detail
      }
    }
    await sleep(RESEND_RATE_LIMIT_MS);
  }

  // STAGE 3: Write summary
  await db('roster_import_log').insert({
    tenant_id: tenantId,
    imported_by: importedBy,
    source: 'csv',
    rows_created: rowsCreated,
    rows_skipped: rowsSkipped,
    rows_errored: rowsErrored,
    error_details: JSON.stringify(errorDetails)
  });

  await db.destroy();
  return { rowsCreated, rowsSkipped, rowsErrored, errorDetails };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

CommitRosterImport.connectionType = 'Knex';
export default CommitRosterImport;
```

[VERIFIED: papaparse 5.5.3 is current via `npm view papaparse version`]
[VERIFIED: Resend rate limit is 2 req/s by default per [Resend rate-limit docs](https://resend.com/docs/api-reference/rate-limit)]

---

## Magic-Link Invites (Resend + Auth.js)

### Current wiring (Phase 1)

`app/lowdefy.yaml` lines 47–60 configures NextAuth `EmailProvider` to use Resend SMTP relay:

```yaml
providers:
  - id: email
    type: EmailProvider
    properties:
      server:
        host: smtp.resend.com
        port: 465
        auth:
          user: resend
          pass: { _secret: RESEND_API_KEY }
      from: { _secret: RESEND_FROM_EMAIL }
      maxAge: 1800
```

`signup.yaml` and `signup_with_invite.yaml` both trigger magic-link by calling the `Login` action with `providerId: email`:

```yaml
events:
  onClick:
    - id: do_create
      type: Request
      params: { requestId: bootstrap_tenant }
    - id: signin_after
      type: Login
      params:
        providerId: email
        email: { _state: email_input }
        callbackUrl: /admin_dashboard
```

### Phase 2 invite flow — two callers, one shared helper

For Phase 2's bulk import + per-soldier "Invite later" buttons, the existing `Login` action from a Lowdefy YAML cannot be invoked from a server-side plugin loop. Two options:

**Option A (RECOMMENDED): Use Resend HTTP SDK directly for bulk + invite-later, leave magic-link delivery to Auth.js for the actual login click.**

Auth.js's `EmailProvider` is a **send-and-wait** flow: the link contains a magic token that the recipient clicks; clicking it hits `/api/auth/callback/email?token=...&email=...` and Auth.js verifies the token in `verification_tokens` table. For Phase 2's bulk invite, we don't need Auth.js to mediate the SEND step — we need:
1. An `app_user` row (created in the import transaction).
2. A `verification_tokens` row (inserted server-side using Auth.js's standard schema — see Auth.js docs).
3. An email containing `https://apps.nesher.co/api/auth/callback/email?email=ENC&token=TOK` sent via Resend HTTP SDK.

The token has a `(identifier, token)` PK; identifier = email; token = a long random string; expires = now() + maxAge. Auth.js will verify on click using the same logic as for the magic-link flow we already trigger from `signup.yaml`.

```javascript
// app/plugins/shifty-roster/src/helpers/invite.js
import { Resend } from 'resend';
import { randomBytes, createHash } from 'crypto';
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLink({ email, locale = 'he', knexTx }) {
  // Generate a token following Auth.js EmailProvider's hash scheme:
  //   raw token = randomBytes(32).toString('hex')
  //   stored token in DB = sha256(rawToken + NEXTAUTH_SECRET) hex
  //   URL token = rawToken
  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = createHash('sha256')
    .update(`${rawToken}${process.env.NEXTAUTH_SECRET}`).digest('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000);  // 30 min, matches maxAge in lowdefy.yaml

  await knexTx('verification_tokens').insert({
    identifier: email.toLowerCase(),
    token: hashedToken,
    expires
  });

  const callbackUrl = '/admin_dashboard';
  const baseUrl = process.env.NEXTAUTH_URL;
  const link = `${baseUrl}/api/auth/callback/email?` +
    `callbackUrl=${encodeURIComponent(callbackUrl)}` +
    `&token=${rawToken}` +
    `&email=${encodeURIComponent(email.toLowerCase())}`;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [email],
    subject: 'הזמנה לשיפטי',          // i18n: invite.email.subject
    html: `<!DOCTYPE html>
<html dir="rtl" lang="${locale}">
<head><meta charset="utf-8"></head>
<body dir="rtl" style="font-family:Arial,'Segoe UI','Noto Sans Hebrew',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;direction:rtl;text-align:right;">
    <h1>הוזמנת לשיפטי</h1>
    <p>לחץ על הקישור כדי להיכנס:</p>
    <p><a href="${link}">כניסה למערכת</a></p>
    <p style="color:#666;font-size:12px;">הקישור תקף ל-30 דקות.</p>
  </div>
</body></html>`,
    text: `‏הוזמנת לשיפטי. הקישור: ${link}`     // U+200F prefix for RTL plaintext (Pitfall 5)
  });
}
```

[VERIFIED: Resend SDK 6.12.3 export shape via project's `app/package.json` line 19 + Phase 1 STACK.md §5]
[CITED: Auth.js EmailProvider sha256 hash scheme — [Auth.js EmailProvider source](https://authjs.dev/getting-started/providers/email-http) — `verificationToken` uses `(identifier, token)` composite PK; token stored as hash of `rawToken + secret`. Verify exact algorithm in Auth.js v4 source at planning time before shipping.]
[ASSUMED] The exact sha256 hash scheme above matches NextAuth v4's `emailVerificationToken` implementation. Plan should verify with a manual end-to-end smoke test against the live Resend domain before committing the import path. **Risk if wrong:** invite emails will not authenticate clicks — the user would land on `/api/auth/error?error=Verification`. Confirm via a 2h planning spike.

**Option B (DEFER): Call Auth.js's internal email-sender via a Lowdefy custom action.** More invasive; ties Phase 2 import path to NextAuth internals. Discouraged.

### Resend rate limits — actual budget for D-10 (ROST-13 SLO)

- **Free tier:** 2 requests/second (rolling 1s window) per default; 5 req/s on paid tier. [VERIFIED: [Resend rate limit docs](https://resend.com/docs/api-reference/rate-limit)]
- **Daily cap:** 100 emails/day on free tier, 3,000/month. 50 in one burst is well within daily cap.
- **429 response headers:** `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after` — respect `retry-after` precisely.
- **Budget for 50 sends at 2 req/s:** 50 / 2 = 25 seconds wall-clock minimum. **This BREAKS the 10s SLO** for the email dispatch portion alone.

**Mitigation for ROST-13 ≤10s:**
1. **Dispatch concurrently with limit-respect** — use a small pool (e.g., 2 concurrent senders, each respecting per-sender 500ms gap → 2 sends/sec total). 50 sends ≈ 25s — STILL EXCEEDS.
2. **Decouple the SLO**: D-10 already states "<2s DB transaction" + progress bar showing dispatch progress. The user-perceived "import done" happens after the DB transaction. The Resend loop runs to completion in the background and the result page shows the final count. **The 10s SLO can be interpreted as the DB write completing in <10s**; Resend dispatch happens in parallel with the user landing on the result page. This is a planning-time decision.
3. **Request rate-limit increase from Resend** — paid tier or contact support; out-of-scope for v1.

**Recommendation:** Re-interpret the 10s SLO as **"DB writes + first batch of Resend sends complete in 10s"**. Plan tasks should document this explicitly so verification doesn't fail on a strict reading.

### Hebrew RTL email template

Hardcoded Hebrew template per Phase 1 STACK.md §5 (already verified pattern). Phase 2 ships the template inline in the invite helper; Phase 6 generalizes to a template-resolution layer.

### Bulk-invite single template

Yes — the same Resend `emails.send` call is reused for D-07 ("Invite later" single-soldier) and D-10 (bulk loop). The helper accepts a single `email` argument; the bulk loop calls it 50 times.

---

## Color Palette + Round-Robin Assignment

### Palette location & spec

Per D-14: `app/plugins/shifty-roster/src/helpers/palette.js`:

```javascript
// 24 perceptually-distinct hex colors, ordered for adjacency safety.
// Glasbey-style — neighbors in the array are perceptually FAR apart.
// Indices ±1 in this array → guaranteed distinct hues (HCL hue distance > 40°).
//
// Final hex values will be picked at planning time. The placeholders below are
// a starting point with good perceptual spread; the planner replaces them with
// the exact 24 values after a visual review.
export const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#aec7e8', '#ffbb78',
  '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d2', '#c7c7c7',
  '#dbdb8d', '#9edae5', '#393b79', '#637939', '#8c6d31', '#843c39'
];

// Adjacency rule D-15: next = (last + 2) mod 24
// -1 sentinel = "no color assigned yet"; first soldier gets index 0
export function pickNextColor({ lastIndex }) {
  if (lastIndex == null || lastIndex < 0) return 0;
  return (lastIndex + 2) % PALETTE.length;
}

export function colorByIndex(idx) {
  if (idx == null || idx < 0 || idx >= PALETTE.length) return PALETTE[0];
  return PALETTE[idx];
}
```

### Assignment flow

1. New soldier created with team_id → server-side: BEGIN TX → SELECT org_unit.last_color_index FOR UPDATE → compute `(last + 2) mod 24` → UPDATE org_unit.last_color_index → INSERT soldier with that color → COMMIT. The `SELECT ... FOR UPDATE` prevents race conditions when two imports run concurrently.
2. New soldier created WITHOUT team_id (e.g., admin's tenant-wide add) → assign palette[0] as default; soldier picks a real color in `my_profile` or after team assignment.
3. Membership added to a team that already has a color → soldier keeps their current color (no recolor on team-add).
4. Membership removed → no color change.

### Override flow (D-16)

`my_profile` page renders the 24 swatches as clickable boxes:

```yaml
- id: color_swatches
  type: Box
  layout:
    contentGutter: [8, 8]
  blocks:
    # Iterate 24 times — easiest via a List bound to a static array
    - id: swatch.$
      type: Card
      properties:
        style:
          backgroundColor: { _state: 'palette.$' }
          width: 32
          height: 32
          border:
            _if:
              test: { _eq: [{ _state: 'palette.$' }, { _request: load_my_soldier[0].color }] }
              then: '3px solid #000'
              else: '1px solid #ccc'
      events:
        onClick:
          - { id: pick, type: Request, params: { requestId: update_color } }
```

The `update_color` request: `UPDATE soldier SET color = :new_color WHERE user_id = :user_id AND tenant_id = :tenant_id`. Both filters from session.

---

## Role Tag Storage + Autocomplete

### Schema & RLS

Per D-13 + the DDL section above (`0011_role_tag.up.sql`). Two storage modes co-exist:
- `role_tag` table: per-tenant catalog. CRUD-able by admin/team_manager.
- `soldier.role_tags TEXT[]`: array of `role_tag.key` values per soldier. Already in the soldier schema.

The **invariant**: every value in `soldier.role_tags` must exist in `role_tag` for the same tenant. Postgres has no native array-FK; enforcement is application-side. Validation runs in `shifty-roster` plugin's row-validator (CSV import) and `CreateSoldier`/`UpdateSoldier` request handlers (single-row).

### Autocomplete + inline-create

```yaml
- id: list_role_tags
  type: KnexRaw
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
  properties:
    query: |
      SELECT key AS value, COALESCE(label, key) AS label
      FROM role_tag WHERE tenant_id = :tenant_id ORDER BY key
    parameters:
      tenant_id: { _payload: tenant_id }
```

Bind to a `TagSelector`:

```yaml
- id: soldier_form.role_tags
  type: TagSelector
  properties:
    label: תגיות תפקיד
    options: { _request: list_role_tags }
    # Allow free-form values (Lowdefy TagSelector default behavior depends on Ant variant —
    # use AntTagSelector or its equivalent. Verify at planning time)
```

On CSV preview, unknown tags fire a per-row "צור" button that POSTs to:

```sql
INSERT INTO role_tag (tenant_id, key)
VALUES (:tenant_id, :key)
ON CONFLICT (tenant_id, key) DO NOTHING
RETURNING id, key;
```

### Canonicalization (kebab-case)

```javascript
// app/plugins/shifty-roster/src/helpers/text.js
export function kebabCase(s) {
  return (s ?? '')
    .normalize('NFC')               // canonicalize Unicode (Hebrew compose forms)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')         // spaces and underscores → hyphen
    .replace(/[^a-z0-9-]/g, '')      // drop non-kebab chars
    .replace(/-+/g, '-')             // collapse multi-hyphen
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens
}
```

The DB CHECK constraint `key ~ '^[a-z][a-z0-9-]*$'` rejects malformed; the JS canonicalizer ensures malformed input never reaches INSERT.

---

## Membership (Multi-Team)

### Junction shape (already in 0002)

```sql
CREATE TABLE membership (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id  UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    org_unit_id UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('unit_admin', 'team_manager', 'member', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (soldier_id, org_unit_id)
);
```

[VERIFIED: `db/migrations/0002_tenancy_and_org.up.sql` lines 99–111]

### Constraints

- **Same tenant guaranteed by FK chain:** `membership.tenant_id` → `tenant.id`; `membership.soldier_id` → `soldier.id` (which has `tenant_id` → `tenant.id`); `membership.org_unit_id` → `org_unit.id` (also `tenant_id` → `tenant.id`). RLS on all three layers prevents cross-tenant rows being created (the policy CHECK clause blocks INSERT with mismatched tenant_id).
- **No DB-level guard for "soldier_tenant == org_unit_tenant"** — the `tenant_id` column on `membership` is denormalized. **Pre-flight check:** every Phase 2 INSERT membership row must verify the soldier and org_unit are in the same tenant. RLS alone catches the cross-tenant write (if `app.current_tenant` is set to tenantA, you can't INSERT a row with `tenant_id = tenantB`), but a mismatch between membership.tenant_id and (e.g.) soldier.tenant_id is technically possible if the SQL is sloppy. Phase 2 plans should write membership inserts as:

```sql
INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
SELECT s.tenant_id, s.id, ou.id, :role
FROM soldier s, org_unit ou
WHERE s.id = :soldier_id AND ou.id = :team_id
  AND s.tenant_id = :tenant_id AND ou.tenant_id = :tenant_id
RETURNING tenant_id;
```

This pattern (SELECT-driven INSERT with tenant cross-check) is the safe form. The bare INSERT … VALUES form should NOT appear in Phase 2 plans for membership.

### "Team manager sees their team's soldiers"

```sql
-- For team_manager: their team's soldiers (a soldier may be on 2 teams, only one of which the manager owns)
SELECT DISTINCT s.id, s.display_name, s.color, s.seniority, s.role_tags, s.status
FROM soldier s
JOIN membership m ON m.soldier_id = s.id
WHERE s.tenant_id = :tenant_id
  AND m.org_unit_id = ANY(:caller_team_ids)
  AND s.status = 'active'
ORDER BY s.display_name;
```

`:caller_team_ids` comes from `_user: team_ids` (already hydrated by `ShiftySessionCallback`).

---

## Smart-Quote / Bidi-Mark Stripping

### Codepoints to strip (D-12)

| Codepoint | Name | Why strip |
|-----------|------|-----------|
| `U+2019` | RIGHT SINGLE QUOTATION MARK (curly apostrophe) | Excel/Sheets auto-correct from `'` |
| `U+200E` | LEFT-TO-RIGHT MARK (LRM) | Hidden direction marker |
| `U+200F` | RIGHT-TO-LEFT MARK (RLM) | Hidden direction marker |
| `U+202A` | LEFT-TO-RIGHT EMBEDDING (LRE) | Bidi embedding |
| `U+202B` | RIGHT-TO-LEFT EMBEDDING (RLE) | Bidi embedding |
| `U+202C` | POP DIRECTIONAL FORMATTING (PDF) | Bidi embedding pop |
| `U+202D` | LEFT-TO-RIGHT OVERRIDE (LRO) | Bidi override |
| `U+202E` | RIGHT-TO-LEFT OVERRIDE (RLO) | Bidi override |

**DO NOT STRIP:**
- `U+05F4` (Hebrew gershayim) — legitimate Hebrew punctuation in military titles like `סמ"ר`. Preserved exactly.
- `U+0022` (ASCII double-quote) and `U+0027` (ASCII apostrophe) — legitimate ASCII punctuation.

[CITED: project's `.planning/research/PITFALLS.md` "Smart-quote variants" section + PRD §13.2]

### Canonicalizer

```javascript
// app/plugins/shifty-roster/src/helpers/text.js
// Strip smart-quote (U+2019) and bidi marks/embedding/overrides (U+200E–U+200F, U+202A–U+202E).
// PRESERVE Hebrew gershayim (U+05F4), ASCII quotes (U+0022, U+0027), and all letter codepoints.
//
// Tested against tools/fixtures/kibbutz.sql row 12: 'נועם ג'לאל' (U+2019 in display_name)
// must round-trip to 'נועם גלאל' (the bidi marks gone, the curly apostrophe replaced with nothing).
//
// Implementation: NFC normalize first (so combined forms become base+mark and we don't double-strip).
const STRIP_RE = /[‎‏‪-‮’]/g;

export function canonicalizeDisplayName(s) {
  return (s ?? '')
    .normalize('NFC')
    .replace(STRIP_RE, '')
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim();
}
```

### Where to invoke

| Pipeline stage | Invocation |
|----------------|------------|
| CSV parse step (server) | `ParseCsvAndValidate` calls `canonicalizeDisplayName(raw.name)` and stores BOTH `display_name_raw` (for forensics in `roster_import_log.error_details`) AND `display_name` (the canonical form). |
| CSV commit step (server) | `CommitRosterImport` uses `row.display_name` (canonical) directly. |
| Single-row "Add soldier" (server) | `CreateSoldier` handler calls `canonicalizeDisplayName` on `request.properties.display_name` before INSERT. |
| Single-row "Edit soldier" (server) | `UpdateSoldier` handler calls `canonicalizeDisplayName` on the new value. |
| **Postgres trigger (optional belt-and-braces)** | A trigger on `soldier` BEFORE INSERT OR UPDATE that calls a PL/pgSQL function applying `regexp_replace(NEW.display_name, '[‎‏‪-‮’]', '', 'g')`. **Recommendation: skip the trigger for v1**; the JS-side defense is sufficient and adds a maintainable single source of truth. The trigger duplicates the rule across two languages and is harder to test. |

### Test fixture

`tools/fixtures/kibbutz.sql` row 12 (line 35): `נועם ג'לאל` with U+2019. Phase 2 unit tests assert:

```javascript
import { canonicalizeDisplayName } from '../helpers/text.js';
import { test } from 'node:test';
import assert from 'node:assert';

test('canonicalizeDisplayName strips U+2019 curly apostrophe', () => {
  assert.strictEqual(canonicalizeDisplayName('נועם ג’לאל'), 'נועם גלאל');
});
test('canonicalizeDisplayName strips bidi marks', () => {
  assert.strictEqual(canonicalizeDisplayName('‏יוסי‎'), 'יוסי');
});
test('canonicalizeDisplayName preserves Hebrew gershayim U+05F4', () => {
  assert.strictEqual(canonicalizeDisplayName('סמ״ר דני'), 'סמ״ר דני');
});
test('canonicalizeDisplayName preserves ASCII apostrophe', () => {
  assert.strictEqual(canonicalizeDisplayName("D'Angelo"), "D'Angelo");
});
test('canonicalizeDisplayName trims and collapses whitespace', () => {
  assert.strictEqual(canonicalizeDisplayName('  ABC   DEF  '), 'ABC DEF');
});
```

---

## Hebrew RTL Data Tables

AgGrid 32.3.9 supports RTL natively via `enableRtl: true`. Phase 2 sets this on every AgGrid block in the new pages. The current `manage_org_units.yaml` does NOT set it (Phase 1 oversight); Phase 2 should add `enableRtl: true` when upgrading that page.

```yaml
- id: any_grid_block
  type: AgGridAlpine
  properties:
    enableRtl: true              # right-anchored columns, RTL scrollbar, RTL header text
    rowData: { _request: list_x }
    defaultColDef:
      sortable: true
      resizable: true
    columnDefs:
      - field: display_name
        headerName: שם
      - field: created_at
        headerName: 'תאריך יצירה'
        # DD/MM/YYYY display format per I18N-04
        valueFormatter:
          _function:
            __args: 0
            __return:
              _date.format:
                on: { __args: 0.value }
                format: DD/MM/YYYY
```

Column header text auto-aligns right under `enableRtl`. Tooltips for forensics (showing the raw uncanonicalized display_name when smart-quote stripping happened) are useful but not strictly required for v1; defer to Phase 7 polish if tight on time.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node native `node:test` (already in use for `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` per Phase 1 verification) + Playwright 1.x for e2e |
| Config file | `playwright.config.ts` (already exists), no Vitest/Jest config needed |
| Quick run command | `node --test app/plugins/shifty-roster/tests/*.test.mjs` (per-plugin) + `node tools/check-queries.mjs` |
| Full suite command | `npx playwright test && node --test app/plugins/**/tests/*.test.mjs && node tools/check-queries.mjs --self-test && node tools/check-queries.mjs --auth-blocks` |

### Phase Requirements → Test Map

| REQ ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROST-01 | soldier schema columns | schema | `psql -c "\d soldier"` matches expected columns | YES (schema already in 0002) |
| ROST-02 | UUID-only joins | grep | `tools/check-queries.mjs` extension: fail on any JOIN/WHERE matching `display_name` | NEW gate logic |
| ROST-03 | admin + team_manager CRUD scopes | e2e | `tests/e2e/soldier-crud.spec.ts` — admin updates any soldier; team_manager-of-A updates A's soldier; team_manager-of-B 403 | ❌ Wave 0 |
| ROST-04 | multi-team membership | integration | `tests/e2e/multi-team-membership.spec.ts` — soldier with 2 membership rows visible on 2 team_detail pages | ❌ Wave 0 |
| ROST-05 | archived absent from pickers | integration | `tests/e2e/archive-soldier.spec.ts` — archive → assertCount in autocomplete drops; assignment history view still shows row | ❌ Wave 0 |
| ROST-06 | 24-color round-robin no adjacency | unit | `node --test app/plugins/shifty-roster/tests/palette.test.mjs` — pickNextColor sequence 0,2,4...22,0,2,... | ❌ Wave 0 |
| ROST-06b | color override | e2e | `tests/e2e/my-profile-color.spec.ts` — pick swatch, reload, verify UPDATE | ❌ Wave 0 |
| ROST-07 | role_tag autocomplete + canonicalize | unit + e2e | `node --test app/plugins/shifty-roster/tests/text.test.mjs` (kebabCase) + e2e POST `manage_role_tags` then verify `manage_soldiers` form Autocomplete | ❌ Wave 0 |
| ROST-08 | CSV upload + required columns | unit | `parse-csv.test.mjs` — missing column → error; ok columns → rows[] | ❌ Wave 0 |
| ROST-09 | preview ✓/⚠/✗ + inline edit | e2e | `tests/e2e/roster-import-preview.spec.ts` — upload CSV with 1 ok / 1 warn / 1 error; verify badges; edit error to ok; verify Confirm enables | ❌ Wave 0 |
| ROST-10 | duplicate email skip + re-invite | e2e | `tests/e2e/roster-import-duplicates.spec.ts` — seed soldier email X; CSV row email X with re_invite=false → rows_skipped++; re_invite=true → verification_tokens new row | ❌ Wave 0 |
| ROST-11 | smart-quote stripping at write | unit + integration | `text.test.mjs` cases above + `tests/e2e/roster-import-smartquote.spec.ts` — kibbutz fixture U+2019 → soldier.display_name has no U+2019 in DB | ❌ Wave 0 |
| ROST-12 | Resend dispatch + roster_import_log summary | e2e | `tests/e2e/roster-import-end-to-end.spec.ts` — 5-row CSV with mock Resend; verify roster_import_log row + verification_tokens rows | ❌ Wave 0 (uses Resend test mode) |
| ROST-13 | 50-row ≤10s (relaxed: DB tx + first batch ≤10s) | performance | `tests/e2e/roster-import-perf.spec.ts` — Date.now() bracket on commit_import request; assert <10000ms | ❌ Wave 0 |
| **SEC-cross-tenant** | tenant isolation on every new page | auto e2e | `tests/e2e/cross-tenant-leak.spec.ts` auto-discovers — passes new pages automatically | YES (extends existing) |
| **SEC-grep-gate** | every Knex block has tenant_id | CI | `node tools/check-queries.mjs` | YES (existing) |

### Sampling Rate
- **Per task commit:** `node tools/check-queries.mjs && node --test app/plugins/shifty-roster/tests/*.test.mjs` (~5s)
- **Per wave merge:** `node tools/check-queries.mjs --self-test && node tools/check-queries.mjs --auth-blocks && npx playwright test` (~60–120s)
- **Phase gate:** Full suite green + manual smoke of import flow against hpg5 staging

### Wave 0 Gaps
- [ ] `app/plugins/shifty-roster/` — new plugin directory; mirror `shifty-audit-writer/` shape
- [ ] `app/plugins/shifty-roster/tests/text.test.mjs` — smart-quote + kebab-case unit tests
- [ ] `app/plugins/shifty-roster/tests/palette.test.mjs` — pickNextColor unit test
- [ ] `app/plugins/shifty-roster/tests/parse-csv.test.mjs` — papaparse + validation unit tests
- [ ] `tests/e2e/roster-import-*.spec.ts` — five new Playwright specs (preview, duplicates, smart-quote, end-to-end, perf)
- [ ] `tests/e2e/soldier-crud.spec.ts` — Phase 2 RBAC test
- [ ] `tests/e2e/multi-team-membership.spec.ts` — D-08 test
- [ ] `tests/e2e/archive-soldier.spec.ts` — ROST-05 test
- [ ] `tests/e2e/my-profile-color.spec.ts` — D-16 test
- [ ] Framework install: papaparse via `pnpm add papaparse@5.5.3` in `app/package.json`

---

## Wave Structure for Planning

Suggested wave decomposition the planner can refine:

### Wave 0 — Foundations (sequential; everything else depends)
- **Plan A:** Migration `0011_role_tag.up.sql` + `0012_org_unit_last_color_index.up.sql`. Apply via existing `migrate/migrate` compose service. Verify schema_migrations advances.
- **Plan B:** `shifty-roster` plugin scaffold. Empty plugin with palette.js, text.js, ParseCsvAndValidate stub, CommitRosterImport stub, package.json with `papaparse` dep. Wire into `app/package.json` + `app/lowdefy.yaml` plugins list.

### Wave 1 — Org-tree + roster reads (can fan out in parallel)
- **Plan C:** Upgrade `manage_org_units.yaml` to AgGrid tree-table (D-01); add per-row "Add child" and conditional rename (D-02); ship grow-depth modal (D-04).
- **Plan D:** New `manage_soldiers.yaml` — admin-only tenant-wide AgGrid; read-only first. New `team_detail/{id}.yaml` — team-scoped roster + Phase 3 placeholder card (D-03).
- **Plan E:** New `manage_role_tags.yaml` (admin-only read-only autocomplete data view).

### Wave 2 — Mutations + audit (depends on Wave 0 + Wave 1)
- **Plan F:** Single-row create + edit soldier flow. `soldier_detail/{id}.yaml` (D-05/D-06). `CreateSoldier` + `UpdateSoldier` request types in `shifty-roster` plugin with canonicalization (D-12) + color assignment (D-15) + audit row via `AuditWrite` (Phase 1 plugin).
- **Plan G:** Multi-team membership UI on `soldier_detail` + `team_detail` (D-08); archive flow (ROST-05); `manage_soldiers` "Add soldier" button.
- **Plan H:** `my_profile` page with 24-swatch color picker (D-16).

### Wave 3 — CSV import (can fan out in parallel with Wave 2)
- **Plan I:** `ParseCsvAndValidate` request type implementation + unit tests. New page `roster_import.yaml` with upload + preview stub.
- **Plan J:** Preview UI editable cells + bulk-fix toolbar (D-09); per-row re-invite checkbox (D-11).
- **Plan K:** `CommitRosterImport` request type — DB transaction + Resend dispatch loop with backoff (D-10/D-12); roster_import_log summary row write; result page.
- **Plan L:** "Invite later" button on `soldier_detail` (D-07) — reuses Plan K's Resend helper.

### Wave 4 — Cleanup + tests + ops
- **Plan M:** Remove `/employees` page from `app/lowdefy.yaml`; verify menu links updated.
- **Plan N:** Migration `0008_assignment_state_and_legacy_drop.up.sql` — apply ONLY after Plan M lands.
- **Plan O:** Full Playwright spec set (roster-import-*, soldier-crud, multi-team-membership, archive-soldier, my-profile-color); ensure `tests/e2e/cross-tenant-leak.spec.ts` auto-picks up new pages and passes.
- **Plan P (optional):** Introduce GitHub Actions CI per the CONTEXT.md "Deferred Ideas" note. Triggers `tools/check-queries.mjs` (all modes) + Playwright on PR.

**Critical sequencing:** Plan M MUST precede Plan N (drop legacy tables only after the page that queries `employees` is gone). Plan K can be the longest pole; consider starting Wave 3 in parallel with Wave 2 right after Wave 1 lands.

---

## Pitfalls to Avoid

### P1. `tenant_id` from `_payload` is forgeable
**Anti-pattern:** `parameters: tenant_id: { _payload: tenant_id }` where the payload `tenant_id` came from `_state` (user-controllable) or `_input` (URL-controllable).
**Correct:** `payload: tenant_id: { _user: tenant_id }`. The `_user` operator reads from session (`session.user.tenant_id` hydrated by `ShiftySessionCallback`). The CI grep gate does NOT distinguish — manual code review must check every Phase 2 KnexRaw block to verify the payload's `tenant_id` flows from `_user`. If it flows from anywhere else, it's a release blocker.

### P2. Smart-quote stripping at READ time is wrong
**Anti-pattern:** Stripping U+2019 in a `SELECT` view or in a Lowdefy `cellRenderer`. This leaves the canonical form in the DB diverging from the displayed form; duplicate detection against email still works but display-name "search" breaks (the search box's typed `'` doesn't match the stored U+2019).
**Correct:** Strip at WRITE time, in the same JS helper, called from CreateSoldier + UpdateSoldier + ParseCsvAndValidate + CommitRosterImport. Storage holds the canonical form; display is unchanged. D-12 + Pitfall 10 from project research.

### P3. Lowdefy plugin must be in BOTH package.json AND lowdefy.yaml plugins list
[VERIFIED: project skill `reference/09-plugins.md` lines 7–11 + cross-cutting gotchas item #6]

Missing either declaration causes "Block type X not defined" at build time. The `shifty-roster` plugin must be added to:
- `app/package.json` `dependencies`: `"shifty-roster": "file:./plugins/shifty-roster"`
- `app/lowdefy.yaml` `plugins:` block: `- name: 'shifty-roster'; version: 'file:../../plugins/shifty-roster'`

The `version: 'file:../../plugins/shifty-roster'` path is **relative from `.lowdefy/server/`** (Phase 1 Plan 02 SUMMARY note 2). It is NOT relative from the lowdefy.yaml file. Copy the exact form from `shifty-audit-writer` / `shifty-auth` lines 14–17 of the current lowdefy.yaml.

### P4. `pnpm-workspace.yaml` must stay in `.dockerignore`
[VERIFIED: Phase 1 Plan 02 SUMMARY decision]

Adding the new plugin must NOT trigger Lowdefy's inner pnpm workspace mode. Confirm `pnpm-workspace.yaml` is in `.dockerignore`. The 2.5-hour hang from Phase 1 was caused by this.

### P5. pnpm version pin is `9.15.5`, NOT `11.x`
[VERIFIED: Phase 1 SUMMARY + project skill `reference/10-deployment.md`]

pnpm 11 refuses to run build scripts for `@sentry/cli` and `sharp` (which Lowdefy's `@lowdefy/server` pulls); the install exits non-zero and Lowdefy treats the install as failed. Phase 2's plugin additions must not bump pnpm. The `app/Dockerfile` line `corepack prepare pnpm@9.15.5 --activate` is the pin.

### P6. Resend rate-limit budget breaks naive 10s SLO
**Pitfall:** Free tier = 2 req/s. 50 sends sequentially = 25s wall-clock minimum. ROST-13's "50 rows in <10s" is unachievable for the email dispatch portion alone.
**Mitigation:** (1) Re-interpret ROST-13 as "DB writes + result page reachable in <10s; Resend dispatch progresses async in the background" — D-10 already implies this with the progress bar UI. (2) Apply for higher Resend rate limit. (3) Consider extracting Resend dispatch to a background job in Phase 6 (deferred per CONTEXT.md).

Plan acceptance criteria must DOCUMENT the interpretation. [CITED: [Resend rate-limit docs](https://resend.com/docs/api-reference/rate-limit)]

### P7. PsExec wrapping is mandatory for `docker compose build` on hpg5
[VERIFIED: project CLAUDE.md "Why PsExec for SSH-side docker commands"]

When Phase 2 rebuilds the Lowdefy image (new plugin, new pages), the build hits the Docker credential helper which requires interactive session 1. The plan's build commands must wrap with PsExec:

```
psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c "cd C:\shifts-manager && docker compose build lowdefy > C:\shifts-manager\build.txt 2>&1"
```

`docker compose up -d` (when image already built locally), `docker compose exec`, `docker logs`, `docker ps` do NOT need PsExec.

### P8. CSV preview re-validation on edit needs server roundtrip
**Pitfall:** Doing per-row validation purely client-side (e.g., a `_function` operator in `cellValueChanged`) means duplicate-email check is broken — the client doesn't know the tenant's existing emails. Editing email cell A to email B (where B exists in DB) would not flag B as duplicate.
**Mitigation:** Fire a `validate_single_row` server-side request on `onCellValueChanged`. Server checks against DB. This adds a roundtrip per edit (~100ms on LAN); acceptable UX for a roster preview screen.

### P9. AgGrid tree-data + `_function` cellRenderer HTML button interop is undocumented
**Risk (MEDIUM confidence):** The "Add child here" / "Rename" per-row buttons (D-01/D-02) need to fire Lowdefy actions. The project skill documents `cellRenderer: { _function: ... }` returning an HTML string, but does NOT document how to wire that HTML's `onclick` back into a Lowdefy event chain.
**Mitigation options the planner should consider:**
- **Pattern A (safest):** Use `onCellClicked` on the grid + branch on `column.field`; no HTML buttons. Click on the "actions" cell opens a confirmation modal.
- **Pattern B:** Render a custom Lowdefy block as a `cellRendererFramework` via the AgGrid React renderer. This requires authoring a custom block — heavier lift.
- **Pattern C:** Sidebar/Drawer with row-context actions instead of in-row buttons.

Recommendation: **Pattern A** for Phase 2. Pattern B is overkill for v1.

### P10. `notes` field is server-side gated to managers — client visibility is for UX only
**Pitfall:** Hiding the `notes` field via `visible: { _user: roles contains team_manager }` is UX-only. A determined user could fetch the raw soldier row via any read query and see the notes.
**Mitigation:** The SELECT query that powers `soldier_detail` must conditionally include `notes` based on role:

```sql
SELECT id, display_name, color, seniority, role_tags, phone_e164, status, color,
       CASE WHEN :is_manager_or_admin THEN notes ELSE NULL END AS notes
FROM soldier
WHERE id = :soldier_id AND tenant_id = :tenant_id;
```

### P11. Membership archive cascade preserves history — DO NOT cascade delete
**Pitfall:** A `DELETE FROM soldier WHERE id = X` would cascade-delete `membership`, `assignment`, `availability` rows via FK CASCADE — destroying history.
**Mitigation:** Phase 2 NEVER hard-deletes soldiers. All "delete" UI buttons map to an UPDATE setting `status = 'archived'`. The schema FK CASCADE on soldier is a safety net for tenant deletion (the entire tenant tree wipes); it must never be triggered for an individual soldier in normal operation.

### P12. `roster_import_log` column names diverge from PRD §10
**Pitfall:** PRD §10 lists `actor_id, started_at, finished_at, rows_total`; live schema (0007) has `imported_by, source` and no `started_at/finished_at/rows_total`.
**Mitigation:** Plans MUST use the live schema columns. Update PRD §10 (or document the divergence in `docs/PRD.md` errata) as a follow-up. [VERIFIED: `db/migrations/0007_imports_and_exports.up.sql` lines 13–22]

### P13. The `shifts` Postgres role is SUPERUSER (Phase 1 verification flagged this)
**Status:** Phase 1 verification noted `rolsuper=t` on `shifts`. RLS can be bypassed by `SET row_security = off`. Phase 1 added the `tools/check-queries.mjs --no-rls-bypass` gate to prevent code from doing that. Phase 2 inherits this — DO NOT add any code that calls `SET row_security` in any form (the gate will fail the build).
[VERIFIED: `tools/check-queries.mjs` lines 222–256 `runNoRlsBypassCheck`]

### P14. Auth.js `verification_tokens` schema is governed by KnexAdapter; do not modify
Phase 2's "Invite later" + bulk-invite paths INSERT into `verification_tokens`. The table schema (`identifier, token, expires`) is required by Auth.js KnexAdapter. The token must be a sha256 hash of `rawToken + NEXTAUTH_SECRET`, not the raw token. Confirm the exact hash algorithm via a smoke test before shipping.
[ASSUMED] sha256 of `rawToken + NEXTAUTH_SECRET`. Verify against Auth.js v4 source at planning time. **Risk if wrong:** click on invite-email link fails verification.

---

## Code Examples

### Plugin scaffold

```
app/plugins/shifty-roster/
├── package.json
├── src/
│   ├── connections.js              # aggregator (mirrors shifty-audit-writer pattern)
│   ├── connections/
│   │   └── requests/
│   │       ├── ParseCsvAndValidate.js
│   │       ├── CommitRosterImport.js
│   │       ├── CreateSoldier.js
│   │       ├── UpdateSoldier.js
│   │       ├── SendSingleInvite.js
│   │       └── CreateRoleTag.js
│   ├── helpers/
│   │   ├── text.js                 # canonicalizeDisplayName, kebabCase
│   │   ├── palette.js              # PALETTE, pickNextColor
│   │   └── invite.js               # sendMagicLink (Resend wrapper)
│   └── types.js                    # request type registry
└── tests/
    ├── text.test.mjs
    ├── palette.test.mjs
    └── parse-csv.test.mjs
```

### `package.json`

```json
{
  "name": "shifty-roster",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./connections": "./src/connections.js",
    "./types": "./src/types.js"
  },
  "dependencies": {
    "knex": "*",
    "papaparse": "^5.5.3",
    "resend": "*"
  }
}
```

### `src/types.js`

```javascript
export default {
  requests: [
    'ParseCsvAndValidate',
    'CommitRosterImport',
    'CreateSoldier',
    'UpdateSoldier',
    'SendSingleInvite',
    'CreateRoleTag'
  ]
};
```

### `src/connections.js`

```javascript
import ParseCsvAndValidate from './connections/requests/ParseCsvAndValidate.js';
import CommitRosterImport from './connections/requests/CommitRosterImport.js';
import CreateSoldier from './connections/requests/CreateSoldier.js';
import UpdateSoldier from './connections/requests/UpdateSoldier.js';
import SendSingleInvite from './connections/requests/SendSingleInvite.js';
import CreateRoleTag from './connections/requests/CreateRoleTag.js';

export default {
  ParseCsvAndValidate, CommitRosterImport, CreateSoldier, UpdateSoldier,
  SendSingleInvite, CreateRoleTag
};
```

### Updating `app/lowdefy.yaml` plugins list

```yaml
plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
  - name: '@lowdefy/blocks-antd'
    version: '5.3.0'
  - name: '@lowdefy/plugin-next-auth'
    version: '5.3.0'
  - name: 'shifty-auth'
    version: 'file:../../plugins/shifty-auth'
  - name: 'shifty-audit-writer'
    version: 'file:../../plugins/shifty-audit-writer'
  - name: 'shifty-roster'                                # NEW
    version: 'file:../../plugins/shifty-roster'          # NEW
```

### Updating `app/package.json`

```json
"dependencies": {
  "lowdefy": "5.3.0",
  "@lowdefy/connection-knex": "5.3.0",
  "@lowdefy/blocks-aggrid": "5.3.0",
  "@lowdefy/blocks-antd": "5.3.0",
  "@lowdefy/plugin-next-auth": "5.3.0",
  "resend": "6.12.3",
  "papaparse": "5.5.3",
  "shifty-auth": "file:./plugins/shifty-auth",
  "shifty-audit-writer": "file:./plugins/shifty-audit-writer",
  "shifty-roster": "file:./plugins/shifty-roster",
  "knex": "^3.1.0",
  "nodemailer": "^6.9.0"
}
```

### Adding `role_tag` to RLS table list (if NOT inlined in 0011)

If the planner picks "inline RLS in 0011_role_tag.up.sql" (recommended), this section is unnecessary. Otherwise, a small `0013_rls_role_tag.up.sql`:

```sql
BEGIN;
ALTER TABLE role_tag ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_tag
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
COMMIT;
```

---

## State of the Art

| Topic | Approach | Where decided |
|-------|----------|---------------|
| Smart-quote canonicalization | Strip at write time, NFC normalize, JS helper | D-12 + PRD §13.2 + project research PITFALLS |
| Multi-tenant per-tenant catalog (role_tag) | Dedicated table + RLS + UNIQUE(tenant_id, key) | D-13 |
| Adjacency-list org tree | `parent_id` + `level` + UNIQUE(tenant, parent, name); flat-fetch + AgGrid `treeData` | Already in 0002 + D-01 |
| 24-color palette + round-robin | Plugin module export, deterministic `(last + 2) mod 24` | D-14 + D-15 |
| Bulk-invite via Resend | HTTP SDK (not Auth.js Login action) + manual `verification_tokens` insert | This research (Option A) |
| CSV import preview with editable cells | AgGrid `editable: true` + onCellValueChanged → server-side revalidate | D-09 |
| Append-only audit + import logs | `0010_audit_revokes.up.sql` REVOKE UPDATE/DELETE/TRUNCATE | Phase 1 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Auth.js v4 KnexAdapter stores `verification_tokens.token` as sha256(rawToken + NEXTAUTH_SECRET) | Magic-Link Invites + Pitfall 14 | Invite-email clicks fail verification; users land on `/api/auth/error?error=Verification`. **Mitigation:** Plan a 2-hour spike to verify against Auth.js v4 source; smoke-test against live Resend before committing import path. |
| A2 | AgGrid `cellRenderer: { _function: ... }` returning HTML with onclick → Lowdefy action chain works | Pitfall 9 + org_unit Tree | "Add child" / "Rename" inline buttons may not trigger actions. **Mitigation:** Use Pattern A (`onCellClicked` + branch on column.field) which is well-documented in skill. |
| A3 | Lowdefy `Upload` block supports base64 file upload (vs. multipart) | CSV Import Pipeline | Server-side parsing path differs (papaparse expects string). **Mitigation:** Spike `Upload` block behavior; fall back to a custom block if needed. The skill at `reference/04-blocks-core.md` line 207 mentions the block but does not show a base64 example. |
| A4 | Resend SDK respects `retry-after` automatically | D-10 invite dispatch loop | Manual retry logic + sleep is required (verified earlier — Resend SDK 6.x does NOT auto-retry; the application must read response headers + sleep). The CommitRosterImport pseudo-code above handles this manually. |
| A5 | The 24-color array can be picked at planning time without affecting code structure | Color Palette section | None — purely the hex values change. |
| A6 | `tenant.org_depth` cap = 3 will not be violated by the grow-depth modal | D-04 | CHECK constraint `org_depth BETWEEN 1 AND 3` (0002 line 28) will reject the UPDATE. UI must disable "Add child" on level-3 nodes. |
| A7 | The 10-second SLO for ROST-13 can be interpreted as "DB writes + result page reachable" rather than "all emails sent" | Pitfall 6 + Resend section | If interpreted strictly, the SLO is unachievable on Resend free tier without higher rate limits. Planner should document the interpretation explicitly in the plan acceptance criteria. |

---

## Open Questions

1. **Auth.js v4 verification-token hash algorithm — exact form?**
   - What we know: KnexAdapter stores hashes (not raw tokens); some implementations use HMAC-SHA256(rawToken, secret).
   - What's unclear: exact algorithm and field encoding in Auth.js v4 (which is bundled with Lowdefy 5.3).
   - Recommendation: 2h spike at start of Wave 3 Plan K. Read the live `node_modules/next-auth/...` source in the running container.

2. **AgGrid 32.3.9 cellRenderer Lowdefy-action interop?**
   - What we know: skill documents `_function` HTML cellRenderer.
   - What's unclear: how (or whether) onclick handlers in that HTML can call back into Lowdefy events.
   - Recommendation: Wave 1 Plan C smoke-test with the simplest case; fall back to `onCellClicked` if not viable.

3. **Resend rate-limit increase eligibility?**
   - What we know: free tier is 2 req/s; paid is 5 req/s; higher available on request.
   - What's unclear: whether the user wants to pay or wants to negotiate.
   - Recommendation: out-of-scope for this phase; plan around 2 req/s. Surface to user.

4. **`org_unit.last_color_index` race condition under concurrent import?**
   - What we know: `SELECT ... FOR UPDATE` + UPDATE in the same transaction guarantees serialization.
   - What's unclear: whether two concurrent CSV imports could both observe the same `last_color_index` if they run in different transactions (READ COMMITTED isolation).
   - Recommendation: use `FOR UPDATE` explicitly; document the requirement in Plan F/K. Acceptable trade-off given the rare-event nature of concurrent imports.

5. **Should the import progress bar be a Lowdefy block, a Server-Sent Event stream, or polling?**
   - What we know: D-10 says "tight Resend-API loop dispatches one-by-one with a Lowdefy progress indicator".
   - What's unclear: Lowdefy 5.3 has no first-class SSE/streaming pattern. Polling a status request every 500ms is workable but adds client load.
   - Recommendation: planner picks. Simplest: client polls `GET /api/import_status/<job_id>` every 1s; server reads `roster_import_log` row + an in-memory progress counter.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres 16 (running on hpg5) | All schema + queries | ✓ (Phase 1 verified) | 16 | — |
| `migrate/migrate:v4.18.3` | Apply new migrations | ✓ (compose service in docker-compose.yml) | v4.18.3 | — |
| Resend account + verified domain | Magic-link delivery + bulk invite | ✓ (Phase 1 user-action prereq) | API v1 | — |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env vars | Phase 1 wired | ✓ on hpg5 .env (user-action verified in Phase 1) | — | — |
| `NEXTAUTH_SECRET` + `NEXTAUTH_URL` | Magic-link token hash + callback URL | ✓ (Phase 1) | — | — |
| Node `papaparse` package | Server-side CSV parse | ✗ — **needs install** | 5.5.3 | — |
| Node `resend` package | Bulk invite path | ✓ (in app/package.json) | 6.12.3 | — |
| Lowdefy 5.3.0 (runtime in container) | Everything | ✓ (Phase 1 healthy 12+ hr at verification) | 5.3.0 | — |
| AgGrid 32.3.9 (via `@lowdefy/blocks-aggrid@5.3.0`) | Tree-table + editable preview | ✓ (in app/package.json) | bundled | — |
| pnpm 9.15.5 (build-time) | Plugin install | ✓ (Dockerfile pins) | 9.15.5 | — |
| PsExec (on hpg5) | Docker build credential helper | ✓ (Phase 1 OPS verified) | — | — |
| Playwright (CI) | e2e tests | ✓ (Phase 1) | 1.x | — |

**Missing dependencies with fallback:** None blocking.
**Missing dependencies needing install:** `papaparse@5.5.3` — `pnpm add papaparse@5.5.3` in `app/package.json`.

---

## Sources

### Primary (HIGH confidence)
- `.planning/phases/02-org-people/02-CONTEXT.md` — locked decisions D-01..D-16
- `.planning/phases/02-org-people/02-DISCUSSION-LOG.md` — alternatives considered
- `.planning/REQUIREMENTS.md` — ROST-01..ROST-13 (lines 31–43)
- `.planning/ROADMAP.md` Phase 2 — goal, success criteria, dependencies
- `docs/PRD.md` §7.3 (People & roster, lines 213–222), §7.3.1 (CSV import, lines 223–239), §8.3 (RBAC matrix, lines 730–770), §10 (data model, lines 857–1192)
- `db/migrations/0002_tenancy_and_org.up.sql` — soldier/membership/org_unit/app_user schema (lines 22–111)
- `db/migrations/0007_imports_and_exports.up.sql` — roster_import_log LIVE schema (lines 1–30)
- `db/migrations/0009_rls_policies.up.sql` — RLS policy pattern (lines 1–110)
- `db/migrations/0010_audit_revokes.up.sql` — append-only enforcement
- `app/pages/admin/manage_org_units.yaml` — canonical KnexRaw + tenant-scoped CRUD template
- `app/pages/admin/manage_invites.yaml` — Form + Selector + AgGrid Card pattern reference
- `app/pages/auth/signup_with_invite.yaml` — multi-CTE transaction pattern
- `app/plugins/shifty-audit-writer/` — plugin scaffold template (`package.json`, `src/types.js`, `src/connections.js`, `src/connections/requests/AuditWrite.js`)
- `app/plugins/shifty-auth/src/auth/callbacks.js` — `ShiftySessionCallback` shape + `session.user` field map
- `app/plugins/shifty-auth/src/hooks/knex-tenant.js` — `app.current_tenant` SET LOCAL pattern
- `app/lowdefy.yaml` — current plugins list + auth config (lines 1–192)
- `tools/check-queries.mjs` — CI grep gate (default + self-test + auth-blocks + no-rls-bypass modes)
- `tools/fixtures/kibbutz.sql` — U+2019 smart-quote canary (row 12, line 35)
- `tests/e2e/cross-tenant-leak.spec.ts` — auto-derives page coverage from `app/pages/**/*.yaml`
- `tests/e2e/org-unit-crud.spec.ts` — happy-path + member-403 pattern for new pages
- `.claude/skills/lowdefy/reference/03-requests.md` — KnexRaw + KnexInsertOne patterns
- `.claude/skills/lowdefy/reference/04-blocks-core.md` — Form/Selector/Upload/Button/Validate
- `.claude/skills/lowdefy/reference/05-blocks-data.md` — AgGridAlpine + List + Markdown
- `.claude/skills/lowdefy/reference/06-operators.md` — `_user`, `_payload`, `_state`, `_input`, evaluation timing
- `.claude/skills/lowdefy/reference/08-auth.md` — EmailProvider + KnexAdapter + role gates
- `.claude/skills/lowdefy/reference/09-plugins.md` — custom plugin shape (`types.js`, `connections.js`, request handler)
- `.claude/skills/lowdefy/reference/10-deployment.md` — pnpm 9.15.5 pin, Docker symlink fix
- `.planning/research/STACK.md` §5 — Resend SDK 6.12.3 + Hebrew RTL email template
- `.planning/research/PITFALLS.md` — smart-quote bug class + CSV direction-mark stripping
- `CLAUDE.md` — hpg5 PsExec wrapping + deployment realities

### Secondary (MEDIUM confidence)
- [Resend rate-limit docs](https://resend.com/docs/api-reference/rate-limit) — 2 req/s default
- AgGrid 32 tree-data API — known from skill `reference/05-blocks-data.md` line 91 + general AgGrid docs

### Tertiary (LOW confidence — needs verification at planning time)
- Exact Auth.js v4 verification-token hash algorithm — needs live source read in container (A1)
- AgGrid `cellRenderer` HTML onclick interop with Lowdefy events (A2)
- Lowdefy `Upload` block base64 payload shape (A3)

---

## Metadata

**Confidence breakdown:**
- Schema delta: HIGH — DDL copies from existing 0002 patterns; RLS policy already established.
- Tenant isolation: HIGH — pattern proven in Phase 1; just replicating it on new pages.
- Org-tree tree-table: MEDIUM — AgGrid tree-data is documented; HTML-button bridge is not.
- Soldier CRUD: HIGH — direct extension of `manage_org_units.yaml` shape.
- CSV import: HIGH on parse + canonicalization + duplicate detection; MEDIUM on the SLO interpretation and verification_tokens manual insert.
- Color palette: HIGH — pure logic, well-defined.
- Role tags: HIGH — straight CRUD with RLS.
- Smart-quote stripping: HIGH — fixture exists, codepoint list is exact.
- Magic-link invite: MEDIUM — Auth.js token format needs verification (A1).
- Validation Architecture: HIGH — gates exist, tests are additive.

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days; Lowdefy 5.3 stable, Resend rate-limits stable, papaparse stable). Re-research if Resend tier-policy changes or Lowdefy 5.4 ships during Phase 2.

---

## RESEARCH COMPLETE
