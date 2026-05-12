# Phase 2: Org & People - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

**What this phase delivers:** Admins and team-managers can populate a Shifty tenant's roster end-to-end. The Phase-1 admin-only `manage_org_units` page is upgraded to a tree-table covering 1–3 level orgs with role-gated team-manager scope. Two new soldier-management surfaces ship: a top-level `manage_soldiers` AgGrid and a per-team `team_detail` page with embedded members. A `soldier_detail/{id}` page handles edit (seniority, role_tags, phone, notes, status) with row→detail flow and a per-soldier Teams multi-select for multi-team membership. A new CSV roster import path renders a row-by-row preview with editable cells and bulk fix-all actions, dispatches Resend magic-link invites synchronously with a progress bar (50-row ≤10s SLO), writes a summary to `roster_import_log`, and canonicalizes smart-quote variants at write time. A new tenant-scoped `role_tag` table backs autocomplete for tags. A minimal `my_profile` page lets every authenticated user pick their calendar color from the 24-color preset palette (round-robin assigned at create time, adjacency-avoidant within a team). Migration `0008` lands here to drop the legacy `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries` tables once the new `soldier` write path is live.

**Explicit out-of-scope for this phase** (these belong in later phases):
- Shift slots, headcounts, templates, planning windows (Phase 3 — SHFT-01–07)
- Availability declaration UX and constraint lock (Phase 3 — AVAL-01–08)
- Rules toggles + per-soldier overrides (Phase 3 — RULE-01–07)
- Solver, draft/publish lifecycle (Phase 4)
- Swaps, manager manual override, time clock (Phase 5)
- Notification dispatcher (Phase 6) — Phase 2 uses Resend SDK directly for invites; full dispatcher arrives in Phase 6
- Reports, daily/weekly digest (Phase 6)
- Dashboards, exports, full English locale parity, soldier profile polish (Phase 7)
- Tenant #1 migration tool — Phase M (parallel track, can start once Phase 2's import path stabilises)

</domain>

<decisions>
## Implementation Decisions

### Org-tree UX & manager scope

- **D-01: Upgrade `manage_org_units` to an AgGrid tree-table.** Each row is an `org_unit` node, indented by `level`, with expand/collapse and a per-row "Add child here" button. `level` is auto-derived from `parent.level + 1` server-side — no NumberInput. Rename and Delete actions remain (leaf-only delete guard from Phase 1 stays). The existing flat-list Cards are replaced; the existing query and mutation request shapes (tenant_id from `_user`, parameterized SQL) are preserved as the template — see `app/pages/admin/manage_org_units.yaml`.
- **D-02: Team-manager rename lives on the same page with Lowdefy conditional visibility.** Per-row "Rename" inline button is `visible: { _user: roles contains team_manager AND _row.id in _user.team_ids }`. Admin sees full tree + all controls; team-manager sees full tree (read-only) + Rename only on their own team rows. Single YAML, one set of queries, no separate `manage_my_teams` page.
- **D-03: Team creation is Phase 2; shift_slot templates are Phase 3.** Phase-2 team-create writes only the `org_unit` row. The team landing page (`team_detail`) shows a "פתח תבנית משמרות בשלב הבא" placeholder card until Phase 3 ships `shift_slot` CRUD. Phase boundaries stay clean: Phase 2 = people, Phase 3 = scheduling inputs.
- **D-04: Allow growing `tenant.org_depth` via in-tree "Add child" with confirmation modal.** When admin clicks "Add child" on a node at the current `tenant.org_depth`, an AskUserQuestion-style modal asks "ההוספה תעלה את המבנה ל-N רמות. להמשיך?" On confirm, a transactional mutation does `UPDATE tenant SET org_depth = N WHERE id = :tenant_id; INSERT INTO org_unit ...`. Cap at 3. Schedules at the (now non-leaf) root are NOT auto-migrated in Phase 2 — admin moves them manually if needed (Phase 2 has no schedule data yet; this becomes a Phase 3+ concern documented in DEFERRED below).

### Soldier CRUD entry points & flow

- **D-05: Ship both top-level `manage_soldiers` AND per-team embedded members on `team_detail`.** `manage_soldiers` is admin's tenant-wide AgGrid; `team_detail` is the team-scoped roster view. Both surface "Add soldier" (different defaults — team_detail prefills `initial_team_id` from the page route param). Multi-team mental model: soldier is a tenant-level entity, membership is the join.
- **D-06: Edit via row→detail page (`soldier_detail/{id}`).** Click a row in any soldier AgGrid → navigate to a Lowdefy page rendering the soldier form (display_name, seniority NumberInput 0–10, role_tags multi-tag with autocomplete from `role_tag` table per D-13, phone_e164 TextInput, notes Textarea, status Selector active/archived, color override picker). Single save = single mutating request = single `schedule_audit` row. `notes` field is server-side-gated to managers only (Lowdefy request `auth.roles` + `visible: { _user: roles contains ... }` on the block).
- **D-07: Email is optional at create with "Invite later" button on `soldier_detail`.** Single-row "Add soldier" form's email is optional; when blank, soldier row is created with no `app_user` row. `soldier_detail` displays "Invite" button when `app_user` is missing AND email is filled. Click invokes the same Resend magic-link dispatch path as CSV import (per D-15) — single soldier, no preview, but uses the same shared dispatch function. Soldier without app_user has no login; visible in roster, excluded from `availability` defaults until invited (downstream concern flagged for Phase 3).
- **D-08: Multi-team membership: soldier_detail Teams multi-select primary, team_detail "Add member" mirror.** Both write to the same `membership` table; refresh on both pages keeps them in sync. Each add/remove writes a row + a `schedule_audit` entry capturing actor + previous/new state. Archiving a soldier (status = archived) does NOT auto-delete memberships — historical assignment integrity (ROST-05) takes precedence; soldier just stops appearing in pickers via the existing `idx_soldier_tenant_status WHERE status = 'active'` index.

### CSV import preview UX & invite dispatch

- **D-09: Rich preview with editable cells + bulk fix-all actions.** AgGrid editable cells for `name`, `email`, `role_tags`, `seniority`, `team_id`. A "Fix" toolbar at the top: "Lowercase all role_tags", "Trim whitespace", "Assign all blank team_id to: <Selector>". Errored rows (✗) highlighted red and block confirm until cleared; warned rows (⚠) — e.g., unknown role_tag — allow proceed. Confirm button is disabled while any ✗ row remains.
- **D-10: Synchronous import + invite dispatch with progress bar.** On Confirm: (1) one transaction INSERTs all valid soldier + app_user rows + role_tag rows + membership rows (target: <2s); (2) tight Resend-API loop dispatches magic-link emails one-by-one with a Lowdefy progress indicator ("שלחתי 23/50 הזמנות"); (3) Resend rate-limit (429) triggers NOTF-07-compatible retry with backoff `1s → 4s → 16s`, max 3 attempts per row; (4) on completion, write summary to `roster_import_log` (rows_created/skipped/errored + JSON details), redirect to result page. SLO target: 50 rows ≤ 10s. Reasoning: Resend's free tier of 100/day allows synchronous batches up to ~50 in one shot; async queue would pull Phase 6's dispatcher forward unnecessarily.
- **D-11: Per-row re-invite toggle + bulk "Re-invite all duplicates" button.** Duplicate-email rows render with ⚠, a dedicated checkbox column "השב הזמנה" (re-invite), default unchecked. Bulk button at the top toggles all duplicate-row checkboxes. On confirm, checked duplicates regenerate the magic-link (verification_tokens insert) WITHOUT touching the existing `soldier` row's other fields. Unchecked duplicates are skipped entirely and counted in `rows_skipped`.
- **D-12: Smart-quote canonicalization happens in the import handler before INSERT.** Strip-set: `U+2019` (RIGHT SINGLE QUOTATION MARK), `U+200E` (LRM), `U+200F` (RLM), `U+202A–U+202E` (LRE/RLE/PDF/LRO/RLO). Implemented as a JS helper in the shifty-roster plugin (D-14). Tested against the existing `tools/fixtures/kibbutz.sql` smart-quote name — the import must convert `נועם ג'לאל` → `נועם ג'לאל` (U+2019 → no apostrophe). Identical canonicalization is applied in the single-row create handler so manual entry can't bypass the rule.
- **D-13: New `role_tag` table per tenant; autocomplete pulls from it.** Phase 2 migration adds:
  ```
  CREATE TABLE role_tag (
    id UUID PK, tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    key TEXT NOT NULL,  -- lowercase kebab, CHECK regex
    label TEXT,         -- optional Hebrew label
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, key)
  );
  ```
  with composite index on `(tenant_id)` and RLS policy mirroring other tenant-scoped tables. Autocomplete in soldier_detail / CSV import preview is `SELECT key FROM role_tag WHERE tenant_id = :t ORDER BY key`. Unknown tags on CSV preview surface as ⚠ with inline "צור" button that inserts a `role_tag` row and clears the warning. `soldier.role_tags TEXT[]` still holds keys; FK integrity NOT enforced at the array level (Postgres array-FKs aren't first-class), but every roster write path validates `role_tags ⊆ role_tag.keys for tenant`.

### Color palette & adjacency rule

- **D-14: Palette lives in a new `app/plugins/shifty-roster/palette.js` plugin module export.** 24-color array (Glasbey-style perceptually-distinct ordering — final colors picked at planning time; this CONTEXT doesn't fix the hex values). Exported alongside the helper `pickNextColor({ paletteIndices: number[] }): number` that implements adjacency rule (D-15). The plugin also exports the smart-quote canonicalization helper (D-12), keeping all soldier-write-time concerns in one module. Plugin loaded via `app/lowdefy.yaml` plugins list (`file:../../plugins/shifty-roster` per Phase 1 D-08's plugin pattern).
- **D-15: Adjacency = palette-index ±1.** New soldier's color index is `(last_assigned_index_in_team + 2) mod 24`. "Last assigned" is tracked as `org_unit.last_color_index SMALLINT` (added in Phase 2 migration to existing org_unit table); team_detail mutations that INSERT a membership update this column atomically in the same transaction. Skipping by 2 guarantees no two adjacent palette indices are consecutive in a team. After 24 soldiers in a team the cycle wraps and starts re-using indices — at >24 active members per team, identical colors will occur and that's an acceptable v1 trade-off (no team has ever come close).
- **D-16: Phase 2 ships a minimal `my_profile` page with color override.** Accessible to every authenticated role (`auth.pages.protected: true` covers it; no extra role gate). Renders the 24 color swatches as clickable, current `soldier.color` highlighted. Click → UPDATE soldier.color WHERE id = (SELECT id FROM soldier WHERE user_id = _user.user_id AND tenant_id = _user.tenant_id). Phase 7 reuses the same swatch picker block when building out the fuller profile page; Phase 2 ships the picker as a self-contained block to maximise reuse.

### Claude's Discretion

- Exact palette hex values — to be picked at planning time using a Glasbey-style perceptual distance algorithm (or curated). Phase 2 ships a sensible 24-color array; v1.1 can re-tune.
- Whether the new `role_tag` table lives in a new migration `0011_role_tag.up.sql` or is folded into the `0008_assignment_state_and_legacy_drop.up.sql` migration that drops legacy tables. Planning-time call. Cleaner is its own migration (`0011_role_tag.up.sql`) because legacy-drop and role-tag-add are orthogonal concerns.
- Migration `0008` timing within Phase 2's plan ordering: probably last plan in the phase — after the new `soldier` table is fully exercised by every Phase 2 page — but could be Plan 1 if a confidence smoke-test shows the bootstrap `employees` page is no longer needed by any Phase 1 acceptance criteria. Planning agent makes the call.
- AgGrid tree-table column shape (D-01): planning agent picks specific column defs and the "Add child here" button render — multiple AgGrid patterns work.
- Exact Hebrew labels for buttons / error messages / confirmation modals across all pages. Phase 2 establishes the Hebrew default; planning agent and executor finalize wording against PRD §11 (Hebrew style guide if present) — fall back to plain Hebrew otherwise.
- Whether `manage_soldiers` and `manage_org_units` share a navigation-menu grouping (e.g., "ניהול" submenu) — planning agent decides; existing `app/lowdefy.yaml` has a flat menu, may need restructuring.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & roadmap
- `docs/PRD.md` §7.1 — Tenant & org (org_depth rules, TEN-02 immutability with grow exception used by D-04)
- `docs/PRD.md` §7.3 — People & roster (soldier schema, role_tag semantics, color rule)
- `docs/PRD.md` §7.3.1 — Roster CSV import (required columns, `|`-separated role_tags, dedup rules, audit logging)
- `docs/PRD.md` §8.3 — RBAC matrix (admin CRUD on soldier, team_manager R+U within team, `role_tag` as a CRUD entity, `soldier_role_tags` tightening rule)
- `docs/PRD.md` §10 — Data model: `soldier`, `app_user`, `membership`, `roster_import_log` schemas
- `.planning/PROJECT.md` — Active requirements; Key Decisions (UUID PKs everywhere, smart-quote bug defense rooted in kibbutz fixture)
- `.planning/REQUIREMENTS.md` §People & Roster (ROST-01–13) — Phase 2's 13 mapped REQ-IDs
- `.planning/ROADMAP.md` §Phase 2 — Goal, success criteria, dependencies, sequencing notes

### Research outputs (Phase 2 implications)
- `.planning/research/SUMMARY.md` — §Implications for Roadmap → Phase 2; Pitfall #5 (CSV direction-mark stripping at write time); Pitfall #10 (display-name normalization, 24-color palette spec)
- `.planning/research/STACK.md` — Resend SDK 6.12.3, Lowdefy 5.3 plugin pattern; pnpm 9.15.5 pin; AgGrid 32.x tree-grid features
- `.planning/research/ARCHITECTURE.md` — §Pattern 1 (Tenant isolation 5-layer — every Phase 2 query MUST filter by tenant_id from `_user`); §Audit log pattern
- `.planning/research/PITFALLS.md` — P5 (CSV bidi-mark stripping), P10 (preserve prior-art color uniqueness)

### Prior phase context
- `.planning/phases/01-foundations/01-CONTEXT.md` — Phase 1 locked decisions (especially D-01 smoke-test surface, D-06 migration 0008 deferred to Phase 2 boundary, D-08 `shifty-audit-writer` plugin pattern, D-10 CI grep gate + Playwright pen-test must keep passing)
- `.planning/phases/01-foundations/01-VERIFICATION.md` — What Phase 1 actually delivered (verify reusable assets are real before relying on them)

### Lowdefy in-repo skill
- `.claude/skills/lowdefy/SKILL.md` — Router. Phase 2 needs:
  - `.claude/skills/lowdefy/reference/03-blocks.md` — AgGrid tree-table, Selector, Textarea, conditional `visible` blocks
  - `.claude/skills/lowdefy/reference/04-requests.md` — KnexRaw mutation pattern, `_user`/`_payload`/`_state` operator rules
  - `.claude/skills/lowdefy/reference/06-operators.md` — `_user: tenant_id` (server-side), `_user: roles` array
  - `.claude/skills/lowdefy/reference/09-plugins.md` — Custom plugin authoring shape for `shifty-roster` (extends Phase 1's `shifty-audit-writer` pattern)
  - `.claude/skills/lowdefy/reference/08-auth.md` — Re-sending magic links via NextAuth EmailProvider (for D-07 "Invite later" + D-11 re-invite)

### Existing code (bootstrap state Phase 2 builds on / replaces)
- `app/lowdefy.yaml` — Existing menus, auth.roles → page allowlist mapping; Phase 2 adds `manage_soldiers`, `soldier_detail`, `team_detail`, `my_profile`, `roster_import` page IDs to the appropriate role allowlists
- `app/pages/admin/manage_org_units.yaml` — Reference shape for tenant-scoped KnexRaw mutations with leaf-guard; Phase 2 upgrades this file (in place) to the tree-table per D-01
- `app/plugins/shifty-audit-writer/` — Phase 2 reuses this plugin to write audit rows for soldier create/update, membership add/remove, color override, role_tag add (matches Phase 1's audit pattern)
- `db/migrations/0002_tenancy_and_org.up.sql` — `soldier`, `app_user`, `membership` already created in Phase 1; Phase 2 adds columns (org_unit.last_color_index) and new tables (role_tag) via new migration files (0011+)
- `db/migrations/0007_imports_and_exports.up.sql` — `roster_import_log` table already exists; Phase 2 writes the summary rows
- `db/migrations/0009_rls_policies.up.sql` — RLS policy pattern; Phase 2's new `role_tag` table needs an analogous policy in a Phase 2 migration
- `db/migrations/0010_audit_revokes.up.sql` — `roster_import_log` is in the append-only REVOKEs list; do not add UPDATE/DELETE paths against it
- `tools/fixtures/kibbutz.sql` — The smart-quote canary; Phase 2 import path MUST canonicalize the U+2019 in `נועם ג'לאל` (D-12)
- `tools/check-queries.mjs` — CI grep gate; every new YAML query in Phase 2 MUST pass this (or have a documented `-- @gsd-allow-untenanted:` exemption — none expected in Phase 2)

### Deployment & ops
- `CLAUDE.md` — hpg5 deployment realities; PsExec wrapping for `docker compose build` (Phase 2 will rebuild the Lowdefy image many times during development)
- `docker-compose.yml` — Existing services; Phase 2 doesn't add new services (Resend is a third-party API, not a compose service)
- `app/Dockerfile` — Multi-stage symlink-preservation fix; Phase 2 inherits, doesn't modify

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`app/pages/admin/manage_org_units.yaml`** — Reference template for tenant-scoped KnexRaw CRUD with leaf-guard delete. Pattern: payload uses `_user: tenant_id` (server-side, can't be spoofed), parameterized SQL filters by `tenant_id`, page-level `auth.roles` gates access. Phase 2's new mutating pages copy this shape exactly. This file is upgraded in place per D-01.
- **`app/plugins/shifty-audit-writer/`** — Phase-1-built request plugin scaffold. Phase 2 uses it for every mutating soldier/membership/role_tag/color action. The pattern proved out in Phase 1's `admin_test_audit` page is the template.
- **`app/plugins/shifty-auth/`** — NextAuth + Resend EmailProvider + KnexAdapter integration. Phase 2's "Invite later" (D-07) and CSV invite dispatch (D-10) call into Resend via this plugin's exposed helpers OR via a sibling `app/plugins/shifty-roster/` module that imports the same Resend client. Planning agent picks.
- **AgGridAlpine block (`@lowdefy/blocks-aggrid` 5.3.0)** — Already in deps. v5.3.0 wraps ag-grid 32.3.9 which supports tree data (`treeData: true` with `getDataPath`) and editable cells with bulk actions — both needed for D-01 (tree-table) and D-09 (CSV preview editable cells).
- **`db/migrations/0002_tenancy_and_org.up.sql` line 80–96** — `soldier` table schema is locked; Phase 2 only ADDS columns/indexes/triggers if needed (likely none beyond `org_unit.last_color_index` per D-15). The `idx_soldier_tenant_status WHERE status = 'active'` partial index already powers "hide archived from pickers" (ROST-05) without YAML changes.
- **`db/migrations/0007_imports_and_exports.up.sql`** — `roster_import_log` table is ready; Phase 2 writes summary rows. `error_details JSONB` column accepts free-form per-row failure info. Append-only REVOKEs from 0010 mean Phase 2 must NEVER attempt UPDATE on this table (only INSERT).
- **`tools/fixtures/kibbutz.sql`** — Reference soldier-with-smart-quote test data. Phase 2 import unit tests run against this fixture to prove canonicalization.

### Established Patterns

- **`_user: tenant_id` everywhere** — Tenant id is never accepted from the client. Phase 2 uses this pattern in every page payload. The `tools/check-queries.mjs` CI gate enforces it.
- **Page `auth.roles` + request `properties.auth` (when supported)** — Phase 1 noted that `request-level auth.roles is not supported in Lowdefy 5.3.0`; page-level auth is the gate. Phase 2 inherits this; mutating page roles must be explicit. Pattern from `manage_org_units.yaml`.
- **Hebrew labels by default** — Bootstrap UI is Hebrew. ICU MessageFormat files (`app/locales/he.json` / `en.json`) don't exist yet — they ship in Phase 7. For Phase 2, hardcode Hebrew labels in YAML; Phase 7 will extract them. Document the keys to be extracted in a comment marker (e.g., `# i18n: manage_soldiers.add_button`).
- **Schedule_audit row on every mutation** — Phase 1 D-08 established the audit pattern. Phase 2 writes `schedule_audit` rows for soldier create/edit, membership add/remove, color change, role_tag add. Actor is `_user: user_id`; tenant from session; payload carries diff or new state.

### Integration Points

- **Resend SDK** — Already wired through `app/plugins/shifty-auth/` (Phase 1 D-02). Phase 2's CSV invite dispatch and "Invite later" call into the same client (or import the Resend client directly into `shifty-roster` plugin — planner picks). Rate-limit handling per D-10 with NOTF-07-compatible exponential backoff.
- **Knex `afterCreate` RLS hook** — Phase 1 D-07 wires `SET app.current_tenant = :tenant_id` per checkout. Phase 2 inherits; every new YAML query benefits automatically. The new `role_tag` table needs an RLS policy added in its migration (D-13).
- **Lowdefy menus** — Existing `app/lowdefy.yaml` has a flat menu. Phase 2 adds entries for `manage_soldiers`, `manage_role_tags` (admin only), `my_profile` (everyone). Visibility per current `_user: tenant_id` pattern.
- **Playwright pen-test fixture (`tests/e2e/cross-tenant-leak.spec.ts`)** — Auto-derives covered routes from `app/pages/**` per Phase 1 D-10. New Phase 2 pages (manage_soldiers, soldier_detail, team_detail, roster_import, manage_role_tags, my_profile) will be auto-covered; Phase 2 confirms 403 responses for cross-tenant probes on each.
- **CI grep gate (`tools/check-queries.mjs`)** — Phase 2's KnexRaw blocks must all include `WHERE tenant_id = :tenant_id` (or analogous on INSERT). No `@gsd-allow-untenanted` exemptions expected.

</code_context>

<specifics>
## Specific Ideas

- **The Phase 1 manage_org_units.yaml IS the template** — Don't re-invent the tenant-scoped CRUD shape. Tree-table upgrade is a presentation change (AgGrid tree-data + per-row "Add child" button) on top of the same payload + request structure that already passes Phase 1's CI grep gate and pen-test fixture.
- **`shifty-roster` is a new sibling plugin to `shifty-auth` and `shifty-audit-writer`** — Houses the palette + adjacency helper (D-14), the smart-quote canonicalizer (D-12), the CSV row-validator, and the import-dispatch loop. Co-locating these write-time-defenses in one plugin makes the import path easier to audit and unit-test (the plugin's tests directory mirrors `shifty-audit-writer/tests/`).
- **24-color palette: pick perceptually-distinct hexes once, freeze the array** — Glasbey-style or curated. The order of the array is the adjacency definition (D-15). Don't pick 24 random Material colors; the prior-art beloved feature is "every soldier has a recognizable color on the calendar grid" — adjacent hues defeat this.
- **Migration `0011_role_tag.up.sql` (or `0008b`, planner picks) is the second new migration in Phase 2**, alongside `0008_assignment_state_and_legacy_drop.up.sql`. Both follow the existing migration pattern (BEGIN/COMMIT, CREATE TABLE/INDEX, RLS policy in matching `0009`-style file). Migration `0008`'s `legacy_drop` body drops `employees`, `shifts`, `assignments`, `availability`, `time_clock_entries` from `0001` — gated on the Phase 2 plan that supersedes the bootstrap `employees` page in `app/lowdefy.yaml`.
- **The bootstrap `employees` page in `app/lowdefy.yaml` lines 131–183 must be REMOVED before migration 0008 drops the `employees` table** — Order matters. Planner sequences the legacy-drop plan after the new `manage_soldiers` page is shipped and the old `/employees` route is deleted from `lowdefy.yaml` + menu.
- **Mobile considerations for tree-table** — AgGrid Alpine theme handles RTL acceptably but tree expand/collapse on touch is finicky. For Phase 2, accept that the tree-table is desktop-first; mobile users still see the manage_soldiers AgGrid as a flat list. Phase 7 (PERF-02 + A11Y) addresses mobile polish.

</specifics>

<deferred>
## Deferred Ideas

- **Soldier-self-service of more profile fields beyond color** — Phase 2's `my_profile` page is minimal (color override only). Editing own phone_e164, locale (he/en), notification preferences belongs to Phase 6/7.
- **Schedule migration when growing org_depth (D-04)** — When admin grows a tenant from depth=1 to depth=2 mid-life with existing schedules at the root, those schedules need re-pointing to the new leaf. Phase 2 has no schedule data yet, so this is a Phase 4+ concern. Note in `docs/OPERATIONS.md` once Phase 4 lands.
- **`role_tag` rename/delete cascade** — D-13 adds the table but Phase 2's `manage_role_tags` page is read-only (autocomplete data source). Editing a tag (rename, delete-if-unused) is a v1.1 feature.
- **CSV import history view** — `roster_import_log` accumulates summary rows; a "Past imports" admin page that lets you click into a past import and see its `error_details JSONB` is Phase 7 polish.
- **Bulk-archive soldiers / bulk-edit seniority** — Beyond single-row archive on soldier_detail. v1.1.
- **Soldier-without-app_user state cleanup** — When `email` stays blank for months, do we have a "stale roster" report? v1.1 dashboard concern.
- **GitHub Actions CI** — Phase 1 deferred this until a phase needs it. Phase 2 IS the first phase with new mutating YAML pages that should run through `tools/check-queries.mjs` AND new Playwright auto-derived pen-tests pre-merge. Planning agent decides whether to introduce GHA in Phase 2 or accept manual pre-merge invocation for one more phase. Lean toward introducing GHA now — the auto-coverage of new pages is the trigger Phase 1 named.

</deferred>

---

*Phase: 2-Org & People*
*Context gathered: 2026-05-13*
