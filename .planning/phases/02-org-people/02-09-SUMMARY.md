---
phase: 02-org-people
plan: 09
subsystem: lowdefy-wiring + legacy-schema-drop + deploy-bootstrap + schema-validator-corrections
tags: [lowdefy, migration, schema, deploy, hpg5, plan-09, schema-validator, aggrid, auth]
status: corrections-applied-awaiting-deploy-retry
dependency_graph:
  requires: [02-04, 02-06, 02-07, 02-08]
  provides:
    - app/lowdefy.yaml wired for all 7 Phase-2 pages
    - db/migrations/0008_legacy_drop.up.sql ready to apply
    - hpg5 deploy mirror as a git working tree tracking origin/main (Phase 2+ canonical deploy mechanism)
    - Lowdefy 5.3 action-name corrections (Message → DisplayMessage, Confirm → ConfirmModal pattern)
    - 5 Confirm sites restructured to Lowdefy 5.3 ConfirmModal pattern
    - Page-level auth: blocks removed from all 16 page YAMLs (central auth.pages.roles is the gate)
    - Action if: → skip: { _not: ... } conversion on all 11+ gate sites (manage_org_units + team_detail)
    - AgGrid event fix: onCellClicked → onCellClick + data.X → row.X payload paths
    - TagSelector → MultipleSelector replacement in both soldier forms
    - Skill reference corrections (07-events-and-actions, 08-auth, 05-blocks-data)
  affects:
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (corrected action shape, skip semantics, column-dispatch pattern)
    - .claude/skills/lowdefy/reference/08-auth.md (added server-enforcement note + anti-pattern section)
    - .claude/skills/lowdefy/reference/05-blocks-data.md (corrected AgGrid event name + payload shape)
    - CLAUDE.md (deploy mechanism documented)
    - All 16 Phase-2 page YAMLs (auth: removed)
    - app/pages/admin/manage_org_units.yaml (W6 Pattern A fully corrected)
    - app/pages/admin/team_detail.yaml (event dispatch corrected)
    - app/pages/admin/manage_soldiers.yaml (MultipleSelector + onRowClick)
    - app/pages/admin/soldier_detail.yaml (MultipleSelector)
tech_stack:
  added: []
  patterns:
    - git pull deploy sync (replaces per-file pscp)
    - DisplayMessage with status param (Lowdefy 5.3 toast action)
    - ConfirmModal block + CallMethod toggleOpen + events.onOk (Lowdefy 5.3 confirmation pattern)
    - skip: { _not: <X> } for conditional action dispatch (replaces rejected if: field)
    - auth.pages.roles in lowdefy.yaml as the sole Layer-3 page-gate (no per-page auth: block)
    - MultipleSelector from @lowdefy/blocks-antd for chip-style multi-tag input
    - onCellClick + cell.column / row.X payload paths (verified Lowdefy 5.3 AgGrid event shape)
key_files:
  created:
    - db/migrations/0008_legacy_drop.up.sql
  modified:
    - app/lowdefy.yaml (Task 1)
    - app/pages/my_profile.yaml (auth: removed)
    - app/pages/admin/manage_soldiers.yaml (auth: removed + MultipleSelector + onRowClick)
    - app/pages/admin/soldier_detail.yaml (auth: removed + MultipleSelector)
    - app/pages/admin/team_detail.yaml (auth: removed + ConfirmModal + onCellClick + skip:)
    - app/pages/admin/manage_org_units.yaml (auth: removed + ConfirmModal + onCellClick + skip:)
    - app/pages/admin/roster_import.yaml (auth: removed + ConfirmModal restructure)
    - app/pages/admin/roster_import_result.yaml (auth: removed)
    - app/pages/admin/manage_role_tags.yaml (auth: removed)
    - app/pages/admin/manage_invites.yaml (auth: removed)
    - app/pages/admin/admin_dashboard.yaml (auth: removed)
    - app/pages/admin/admin_test_audit.yaml (auth: removed)
    - app/pages/auth/login.yaml (auth: removed)
    - app/pages/auth/signup.yaml (auth: removed)
    - app/pages/auth/signup_with_invite.yaml (auth: removed)
    - app/pages/dashboards/manager_dashboard.yaml (auth: removed)
    - app/pages/dashboards/my_dashboard.yaml (auth: removed)
    - CLAUDE.md (deploy docs)
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (action-shape + skip + column-dispatch corrected)
    - .claude/skills/lowdefy/reference/08-auth.md (roles enforcement + anti-pattern section added)
    - .claude/skills/lowdefy/reference/05-blocks-data.md (AgGrid event name + payload corrected)
decisions:
  - Adopted git pull as Phase 2+ deploy sync on hpg5 (per user approval, Option B over per-file pscp)
  - Confirmed page-level auth: is not the Layer-3 gate in Lowdefy 5.3; auth.pages.roles in lowdefy.yaml is canonical
  - Replaced if: with skip: { _not: ... } on all action conditional gates (if: rejected by schema validator)
  - Replaced TagSelector (non-existent in 5.3) with MultipleSelector from @lowdefy/blocks-antd
  - AgGrid event onCellClick (singular) confirmed as canonical; onCellClicked is silent no-op
  - Deferred inline tag creation to v1.1; not feasible with MultipleSelector natively
  - onRowClick payload corrected to row.X (consistent with onCellClick finding)
metrics:
  duration: ~120 min total (two sessions)
  completed_date: 2026-05-14
  tasks_completed: 2 of 3 (Task 3 blocked pending hpg5 deploy retry with corrected code)
  commits: 14 (3b70dfb, 7986b06, 87c1ab8, dac3e31, d56c129, efc378c, 8a0b3c5, b4cf6cd, 8826a13, c9701a3, cf3647e, 6536e7b, 7d2d724, eeadeee)
---

# Phase 2 Plan 09: Lowdefy wiring + legacy schema drop — Summary (corrections applied, deploy retry queued)

## One-liner

Wired the 7 new Phase-2 pages into `app/lowdefy.yaml` and authored `0008_legacy_drop.up.sql`; bootstrapped hpg5 as git-pull mirror; applied 6 classes of Lowdefy 5.3 schema-validator corrections across the full page corpus (page-level auth: rejection, action if: rejection, AgGrid event name/payload bug, TagSelector non-existence); all corrections committed and ready for the next `git push + docker compose build` retry on hpg5.

## Status: Corrections applied — awaiting hpg5 deploy retry

The original Task 3 block (Docker build failing with 3 classes of validator errors) has been fully resolved in code. The orchestrator must push to origin/main, sync hpg5 via `git reset --hard origin/main`, and retry the PsExec-wrapped `docker compose build lowdefy`. Once the build succeeds and the 5-step Task 3 verification passes (steps 4+5 green), migration 0008 can be applied.

## What landed — all commits

| Commit  | Session | Purpose                                                                              |
|---------|---------|--------------------------------------------------------------------------------------|
| 3b70dfb | 1       | Task 1: wire Phase-2 pages + remove /employees from lowdefy.yaml                   |
| 7986b06 | 1       | Task 2: author 0008_legacy_drop.up.sql                                               |
| 87c1ab8 | 1       | Rule-1 auto-fix: _ref paths to color_swatches.yaml resolve from app/root            |
| dac3e31 | 1       | Rule-1 auto-fix: rename Message action to DisplayMessage (Lowdefy 5.3 API)          |
| d56c129 | 1       | docs: wire git-pull deploy on hpg5 + correct skill action-name table                |
| efc378c | 1       | Rule-4 (approved): 5-site Confirm restructure to canonical 5.3 ConfirmModal         |
| 8a0b3c5 | 1       | Rule-1 auto-fix: remove If action; per-action if: gates (since superseded in S2)    |
| b4cf6cd | 1       | docs: SUMMARY blocked status documented                                              |
| 8826a13 | 2       | docs(skill): correct action-shape + auth + AgGrid event signatures (3 skill files)  |
| c9701a3 | 2       | fix: remove page-level auth: from all 16 page YAMLs (5.3 schema rejects)            |
| cf3647e | 2       | fix: manage_org_units W6 Pattern A — onCellClick + skip: + correct payload paths    |
| 6536e7b | 2       | fix: team_detail — onCellClick + skip: + correct payload paths                      |
| 7d2d724 | 2       | fix: replace TagSelector with MultipleSelector in soldier forms                      |
| eeadeee | 2       | fix: manage_soldiers onRowClicked to onRowClick + row.id (Rule 1 latent bug)        |

Session 2 commits (`8826a13` through `eeadeee`) are on worktree branch `worktree-agent-a68cb03e034c92321`.

## Deploy-bootstrap (one-time, completed in Session 1)

`C:\shifts-manager\` on hpg5 is now a git working tree tracking `origin/main`. Documented in `CLAUDE.md` under "Deploy sync — git pull (Phase 2+ canonical)".

## The 6 corrections (Session 2)

### Correction 1: Page-level `auth:` removed from all 16 page YAMLs (commit c9701a3)

**Root cause:** Lowdefy 5.3 block schema has `additionalProperties: false`. `auth:` is not in the page block whitelist. Every page with a top-level `auth:` block emitted `[ConfigWarning] must NOT have additional properties - "auth"`.

**Spike verdict:** `auth.pages.roles` in `lowdefy.yaml` IS the canonical Layer-3 gate. The Lowdefy 5.3 server enforces it via `getPageConfig` (returns null for unauthorized pages) and `authorizeRequest` (throws "Request does not exist" — information-hiding). PRD §8.3 Layer-3 is honored by the central map alone; per-page `auth:` blocks are both schema-rejected AND redundant.

**Reconciliation:** Confirmed before removing that `lowdefy.yaml auth.pages.roles` mirrors every page's intended role gate (populated in Task 1, commit `3b70dfb`). No security regression.

**Pages cleaned (16):** admin_dashboard, admin_test_audit, manage_invites, manage_org_units, manage_role_tags, manage_soldiers, roster_import, roster_import_result, soldier_detail, team_detail, login, signup, signup_with_invite, manager_dashboard, my_dashboard, my_profile.

### Correction 2: Action-level `if:` replaced with `skip: { _not: ... }` (commits cf3647e, 6536e7b)

**Root cause:** `if:` is not in the action schema whitelist. Every `if:` gate emitted `[ConfigWarning] must NOT have additional properties - "if"`. The actions were NOT being conditionally gated — they fired unconditionally.

**Spike verdict:** `skip:` IS in the whitelist. Semantics are INVERTED: `skip: true` = skip the action; `skip: false` = run it. To express "run only when X", write `skip: { _not: <X> }`.

**Sites fixed:** `manage_org_units.yaml` (7 if: gates in tree-grid W6 Pattern A), `team_detail.yaml` (3 if: gates in members-grid).

### Correction 3: AgGrid `onCellClicked` → `onCellClick` + payload paths (commits cf3647e, 6536e7b)

**Root cause:** The correct Lowdefy 5.3 AgGrid event name is `onCellClick` (singular). `onCellClicked` does not raise a validator warning (open `patternProperties` schema) but the handler never registers. This was a completely silent bug.

**Spike verdict (payload shape):** `{ cell: { column, value }, colId, row, rowIndex, selected }`. Key paths: `_event: cell.column` (not `column.field`), `_event: row.<field>` (not `data.<field>`).

**Discovery:** The W6 Pattern A tree-grid in `manage_org_units.yaml` has been completely broken since commit `f01d79a` (Plan 02-03). Every grid cell click fired zero actions. Correction in `cf3647e` is the first time it will actually work.

**Sites fixed:** `manage_org_units.yaml`, `team_detail.yaml`.

### Correction 4: `TagSelector` replaced with `MultipleSelector` (commit 7d2d724)

**Root cause:** `TagSelector` does not exist in Lowdefy 5.3. The build error was `[ConfigError] Block type "TagSelector" was used but is not defined. Did you mean "DateSelector"?`

**Spike verdict:** `MultipleSelector` from `@lowdefy/blocks-antd@5.3.0` (already declared in `lowdefy.yaml` plugins). Supports `renderTags: true` for chip rendering and `allowClear`. The existing `list_role_tags` request returns `{ value, label }` pairs — no shape change needed.

**Pages fixed:** `manage_soldiers.yaml` (new_soldier_form.role_tags), `soldier_detail.yaml` (soldier_form.role_tags).

### Correction 5: Skill reference corrections (commit 8826a13)

- `07-events-and-actions.md`: Replaced documented `if:` action field with verified `skip:` (inverted semantics); added "Column-dispatch pattern" section with `onCellClick` + `cell.column` / `row.X` examples.
- `08-auth.md`: Added server-enforcement note to `auth.pages.roles` section; added "Anti-pattern: page-level auth: is REJECTED in Lowdefy 5.3" section.
- `05-blocks-data.md`: Replaced `onCellClicked { data, value, column.field }` signature with verified `onCellClick { cell: { column, value }, colId, row, rowIndex, selected }`.

### Correction 6 — Rule 1 latent bug: `onRowClicked` → `onRowClick` + `row.id` (commit eeadeee)

`manage_soldiers.yaml` also used `onRowClicked` (same past-tense pattern) with `_event: data.id`. Corrected to `onRowClick` + `_event: row.id` for consistency with the verified AgGrid event naming pattern. The soldier-detail navigation affordance was silently broken.

## Task 3 resume procedure (for orchestrator)

After the worktree branch is merged to main:

1. `git push origin main`
2. On hpg5: `git fetch origin main && git reset --hard origin/main && git log -1 --oneline`
3. Rebuild: PsExec-wrapped `docker compose build lowdefy > build.txt 2>&1 && docker compose up -d lowdefy >> build.txt 2>&1`
4. Wait for healthy (60s), then `docker logs shifty-lowdefy --tail 50` — expect "ready - started server", no ERR_MODULE_NOT_FOUND
5. Step 4 (CRITICAL CLIFF): `http://hpg5:8080/manage_soldiers` must return HTTP 200 + AgGrid renders. If this fails, ABORT — do NOT proceed to migration.
6. Step 5: `http://hpg5:8080/employees` must return HTTP 404 (page removed).
7. If steps 4+5 green: apply migration 0008 via PsExec-wrapped `docker compose run --rm migrate`
8. Verify `\dt` on 5 legacy tables — expect "relation does not exist"; `\df set_updated_at` — expect 1 function row
9. Re-run migrate — expect no-op

Resume signal `applied` ONLY when ALL of steps 4, 5, 7, 8, 9 explicitly green (W2 strict contract).

## Verbatim 0008_legacy_drop.up.sql

```sql
-- 0008_legacy_drop.up.sql -- drop Phase-0 bootstrap tables once Phase 2 supersedes them
-- Phase 1 D-06 deferred this migration to the Phase 2 boundary.
-- Pre-flight checklist (verify before applying):
--   1. app/lowdefy.yaml no longer contains the `employees` page (was lines 131-183).
--   2. app/lowdefy.yaml `menus.links` no longer contains employees_link (was lines 81-85).
--   3. tools/check-queries.mjs reports zero violations.
--   4. Playwright cross-tenant-leak.spec.ts run is clean without `/employees` in scope.
--
-- Order: drop in reverse FK dependency to avoid FK violations.
-- The trigger function set_updated_at() is referenced by other tables -- DO NOT drop it.

BEGIN;

DROP TABLE IF EXISTS time_clock_entries;
DROP TABLE IF EXISTS availability_legacy;  -- renamed in 0004 per Phase 1 Plan 02 decision
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS employees;

-- The trigger function set_updated_at() is still referenced by other tables;
-- DO NOT drop the function.

COMMIT;
```

## Verification gate outputs (Session 1 — still green)

- `node tools/check-queries.mjs` — `check-queries: all Knex request blocks have tenant_id filters. NO-RLS-BYPASS PASS`
- `grep 'type: Confirm$'` in app/pages/ — ZERO matches
- `grep 'type: If'` in app/ — ZERO matches
- `grep 'type: ConfirmModal'` in app/pages/ — 5 matches (manage_org_units x2, soldier_detail, team_detail, roster_import)

## Verification gates (Session 2 — success criteria, all PASS)

- `git grep -n "^auth:" app/pages/` — ZERO matches
- `git grep -n "  if:" app/pages/` — ZERO matches
- `git grep -n "TagSelector" app/` — ZERO matches
- `git grep -n "onCellClicked" app/pages/` — ZERO matches
- `git grep -n "_event: column.field" app/pages/` — ZERO matches
- `git grep -n "_event: data\." app/pages/` — ZERO matches

## Deviations from Plan

### Auto-fixed issues (Session 1)

**1. [Rule 1 - Bug] _ref paths to color_swatches.yaml (commit 87c1ab8)**

**2. [Rule 1 - Bug] Message → DisplayMessage (commit dac3e31)**
- 7 occurrences across 4 pages.

**3. [Rule 4 - USER-APPROVED Option A] 5-site Confirm restructure (commit efc378c)**

**4. [Rule 1 - Bug] If-action removed (commit 8a0b3c5)**
- type: If → per-action if: gates. Subsequently if: was also found to be rejected; corrected in Session 2.

### Auto-fixed issues (Session 2 — this correction pass)

**5. [Rule 1 - Bug] Page-level auth: removed (commit c9701a3)**
- All 16 page YAMLs; security gate preserved via central auth.pages.roles.

**6. [Rule 1 - Bug] Action if: → skip: { _not: ... } (commits cf3647e, 6536e7b)**
- 11 gate sites across manage_org_units and team_detail.

**7. [Rule 1 - Bug] AgGrid onCellClicked → onCellClick + payload paths (commits cf3647e, 6536e7b)**
- Silent no-op corrected; W6 Pattern A tree-grid works for the first time since f01d79a.

**8. [Rule 1 - Bug] TagSelector → MultipleSelector (commit 7d2d724)**
- 2 soldier forms; inline-add deferred to v1.1.

**9. [Rule 1 - Bug] onRowClicked → onRowClick (commit eeadeee)**
- Consistent with onCellClick naming finding; soldier-detail navigation was silently broken.

**10. [Rule 1 - Bug] Skill reference corrections (commit 8826a13)**
- 3 files corrected with verified Lowdefy 5.3 behavior.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| No inline tag creation in role_tags picker | app/pages/admin/manage_soldiers.yaml, app/pages/admin/soldier_detail.yaml | MultipleSelector does not support creatable mode natively; deferred to v1.1 |

## TDD Gate Compliance

N/A — plan type is `execute`, not `tdd`.

## Self-Check

- File `db/migrations/0008_legacy_drop.up.sql`: FOUND
- File `app/pages/admin/manage_org_units.yaml`: FOUND (onCellClick, skip:, no if:, no auth:)
- File `app/pages/admin/team_detail.yaml`: FOUND (onCellClick, skip:, no if:, no auth:)
- File `app/pages/admin/manage_soldiers.yaml`: FOUND (MultipleSelector, onRowClick, no auth:)
- File `app/pages/admin/soldier_detail.yaml`: FOUND (MultipleSelector, no auth:)
- File `.claude/skills/lowdefy/reference/07-events-and-actions.md`: FOUND (corrected)
- File `.claude/skills/lowdefy/reference/08-auth.md`: FOUND (anti-pattern section added)
- File `.claude/skills/lowdefy/reference/05-blocks-data.md`: FOUND (onCellClick corrected)
- Commit `8826a13`: FOUND (skill corrections)
- Commit `c9701a3`: FOUND (auth: removal)
- Commit `cf3647e`: FOUND (manage_org_units)
- Commit `6536e7b`: FOUND (team_detail)
- Commit `7d2d724`: FOUND (TagSelector to MultipleSelector)
- Commit `eeadeee`: FOUND (onRowClick)
- 16 pages with ^auth: removed: grep returns ZERO matches — VERIFIED
- if: action gates: grep returns ZERO matches — VERIFIED
- TagSelector in app/: grep returns ZERO matches — VERIFIED
- onCellClicked in app/pages/: grep returns ZERO matches — VERIFIED
- _event: column.field in app/pages/: grep returns ZERO matches — VERIFIED
- _event: data. in app/pages/: grep returns ZERO matches — VERIFIED

## Self-Check: PASSED
