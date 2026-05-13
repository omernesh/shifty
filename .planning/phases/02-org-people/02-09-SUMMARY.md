---
phase: 02-org-people
plan: 09
subsystem: lowdefy-wiring + legacy-schema-drop + deploy-bootstrap
tags: [lowdefy, migration, schema, deploy, hpg5, plan-09]
status: blocked-at-task-3
dependency_graph:
  requires: [02-04, 02-06, 02-07, 02-08]
  provides:
    - app/lowdefy.yaml wired for all 7 Phase-2 pages
    - db/migrations/0008_legacy_drop.up.sql ready to apply
    - hpg5 deploy mirror as a git working tree tracking origin/main (Phase 2+ canonical deploy mechanism)
    - Lowdefy 5.3 action-name corrections (Message → DisplayMessage, Confirm → ConfirmModal pattern, If-action → per-action `if:`)
    - 5 Confirm sites restructured to Lowdefy 5.3 ConfirmModal pattern
    - team_detail.yaml If-action restructured to per-action `if:` gates
  affects:
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (corrected)
    - CLAUDE.md (deploy mechanism documented)
    - 4 Phase-2 pages cleaned up for Lowdefy 5.3 compatibility (DisplayMessage)
    - 4 Phase-2 pages restructured for ConfirmModal pattern
    - 1 Phase-2 page restructured to remove If-action
    - Phase 2 page corpus (9 pages) still BLOCKED on 3 deeper Lowdefy 5.3 schema-validator findings (architectural — see Deferred Items)
tech_stack:
  added: []
  patterns:
    - git pull deploy sync (replaces per-file pscp)
    - DisplayMessage with status param (Lowdefy 5.3 toast action)
    - ConfirmModal block + CallMethod toggleOpen + events.onOk (Lowdefy 5.3 confirmation pattern, NOW ADOPTED across 5 sites)
    - per-action `if:` field for conditional dispatch (replaces removed `If` action) — but see Rule-4 finding #1 below: 5.3 schema REJECTS `if:` on actions
key_files:
  created:
    - db/migrations/0008_legacy_drop.up.sql
  modified:
    - app/lowdefy.yaml (Task 1)
    - app/pages/my_profile.yaml (Rule-1 fixes)
    - app/pages/admin/manage_soldiers.yaml (Rule-1 fix)
    - app/pages/admin/soldier_detail.yaml (Rule-1 fixes + ConfirmModal restructure)
    - app/pages/admin/team_detail.yaml (Rule-1 fixes + ConfirmModal restructure + If-action removal)
    - app/pages/admin/manage_org_units.yaml (ConfirmModal restructure — 2 sites)
    - app/pages/admin/roster_import.yaml (ConfirmModal restructure)
    - CLAUDE.md (deploy docs)
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (action-name corrections)
decisions:
  - Adopted git pull as Phase 2+ deploy sync on hpg5 (per user approval — Option B over per-file pscp)
  - Identified Lowdefy 5.3 API drift: Message → DisplayMessage rename, Confirm-action removal, and If-action removal are all real (verified empirically against the running 5.3.0 builder)
  - Skill file 07-events-and-actions.md updated to current 5.3 reality with explicit verification timestamps
  - 5 Confirm sites restructured to canonical 5.3 ConfirmModal-block + CallMethod-action pattern (Option A per user, 2026-05-14)
metrics:
  duration: ~80 min (interactive — multiple build retries + escalating discoveries)
  completed_date: 2026-05-14
  tasks_completed: 2 of 3 (Task 3 BLOCKED at the Lowdefy build cliff — 3 deeper Lowdefy 5.3 schema-validator findings discovered after the Confirm restructure unblocked the prior cliff)
  commits: 7 (3b70dfb, 7986b06, 87c1ab8, dac3e31, d56c129, efc378c, 8a0b3c5)
---

# Phase 2 Plan 09: Lowdefy wiring + legacy schema drop — Summary (CP-B blocked, deeper architectural finding)

## One-liner

Wired the 7 new Phase-2 pages into `app/lowdefy.yaml` and authored migration `0008_legacy_drop.up.sql`; deploy-bootstrapped hpg5 as a `git pull`–driven mirror; restructured 5 `Confirm`-action sites to the Lowdefy 5.3 ConfirmModal pattern and removed the only `If`-action site; uncovered THREE deeper Lowdefy-5.3 schema-validator findings that block the Docker build at a more fundamental level than the prior cliff — page-level `auth.roles` is rejected, action-level `if:` is rejected, and the `TagSelector` block does not exist in 5.3.

## Status: BLOCKED at Task 3 step 2 (Docker build) — deeper than the previous cliff

The 5-site Confirm restructure and the team_detail.yaml If-action removal both landed cleanly (`efc378c` + `8a0b3c5`); the Docker rebuild on hpg5 progressed further but failed on a NEW class of error. After two auto-fix attempts in this build cycle (limit per Rule 3 fix-attempt cap), the remaining findings span the entire Phase 2 page corpus and cross the Rule-4 threshold for explicit user approval. The migration file is staged on hpg5 but is **NOT applied** — the order-of-operations contract (UI surface live first, schema drop second) is correctly held back.

## What landed (commits)

| Task | Commit  | Purpose                                                                       |
|------|---------|-------------------------------------------------------------------------------|
| 1    | 3b70dfb | wire Phase-2 pages + remove /employees bootstrap                              |
| 2    | 7986b06 | author 0008_legacy_drop.up.sql                                                |
| —    | 87c1ab8 | Rule-1 auto-fix: `_ref:` paths to `color_swatches.yaml` resolve from app/     |
| —    | dac3e31 | Rule-1 auto-fix: rename `Message` action → `DisplayMessage` (5.3 API)         |
| —    | d56c129 | docs: wire git-pull deploy on hpg5 + correct skill action-name table          |
| —    | efc378c | Rule-4 (approved): 5-site Confirm restructure to canonical 5.3 ConfirmModal   |
| —    | 8a0b3c5 | Rule-1 auto-fix: remove legacy `If` action; use per-action `if:` gates        |

All seven commits are pushed to `origin/main` at `https://github.com/omernesh/shifty.git`.

## Deploy-bootstrap (one-time, completed)

Per user approval (Option B), `C:\shifts-manager\` on hpg5 was bootstrapped as a git working tree tracking `origin/main`. Subsequent deploys use `git fetch + git reset --hard origin/main` (documented in `CLAUDE.md`). All 7 commits are on hpg5 at HEAD = `8a0b3c5`.

## Deviations from Plan

### Auto-fixed issues (this resume cycle)

**4. [Rule 4 — Architectural, USER-APPROVED Option A] Restructured 5 `Confirm` sites to Lowdefy 5.3 ConfirmModal pattern (commit `efc378c`)**
- **Found during:** Task 3 step 2 (Docker build, blocked at prior checkpoint)
- **Issue:** 5 occurrences of `type: Confirm` (inline action chains) across 4 pages. Lowdefy 5.3 has no `Confirm` action; the canonical pattern is the `ConfirmModal` block + `CallMethod toggleOpen` + `events.onOk`.
- **Fix:** All 5 sites restructured to the canonical pattern. Each destructive chain moved into the modal's `events.onOk` handler; the button onClick shrank to row-context capture (where needed) + a single `CallMethod` to `toggleOpen` the new modal block.
- **Files modified:**
  - `app/pages/admin/manage_org_units.yaml` (delete_confirm_modal + grow_depth_confirm_modal)
  - `app/pages/admin/soldier_detail.yaml` (archive_confirm_modal)
  - `app/pages/admin/team_detail.yaml` (remove_confirm_modal)
  - `app/pages/admin/roster_import.yaml` (commit_confirm_modal)
- **Verify-gate:** `grep 'type: Confirm$'` in `app/pages/` → zero matches (was 5)
- **Commit:** `efc378c`

**5. [Rule 1 — Bug] Removed legacy `If` action; replaced with per-action `if:` gates (commit `8a0b3c5`)**
- **Found during:** Task 3 step 2 (Docker build, retry after fix #4)
- **Issue:** `team_detail.yaml:366` used `type: If` inside `onCellClicked` to dispatch between the actions-column branch and the body-column (open-detail) branch. Lowdefy 5.3 rejects with `[ConfigError] Action type "If" was used but is not defined. Did you mean "Link"?`
- **Fix:** Replaced the `If`-action wrapper with three sibling actions, each carrying its own `if:` gate on `column.field`. **However — see Rule-4 finding #2 below: 5.3's schema validator ALSO rejects `if:` on actions. This fix is incomplete; the build now warns and may be silently dropping the gates.**
- **Files modified:** `app/pages/admin/team_detail.yaml`
- **Verify-gate:** `grep 'type: If'` in `app/` → zero matches (was 1)
- **Commit:** `8a0b3c5`

### Deferred items (NOT auto-fixed; Rule-4 architectural — user decision required)

After the Confirm restructure + If-action removal, the Docker build advanced to a new failure surface that reveals **three deeper Lowdefy-5.3 schema-validator findings** spanning the entire Phase 2 page corpus. None of these is a single-page mechanical fix — each requires an architectural decision because the affected APIs are foundational to Phase 2.

#### Rule-4 finding #1: Lowdefy 5.3 schema REJECTS page-level `auth:` field (9 pages affected)

```
[ConfigWarning] must NOT have additional properties - "auth"
```
- **Pages affected (9, all from Phase 2):** manage_soldiers, soldier_detail, team_detail, roster_import, roster_import_result, manage_role_tags, my_profile, my_dashboard, manager_dashboard.
- **What we wrote:** Every Phase 2 page has the Layer-3 tenant-isolation gate at the page top level:
  ```yaml
  id: my_page
  type: PageHeaderMenu
  auth:
    roles:
      - unit_admin
      - team_manager
  ```
- **What 5.3 expects:** Verified-empirically — the page schema does NOT have an `auth` property. The 5.3 validator emits `ConfigWarning`s for every page. At runtime, the gate may be silently absent (every authenticated user can reach every page), or the role allowlist may live at a different level (e.g., on the `lowdefy.yaml`'s `auth.pages.roles` block — which DOES exist and which Task 1 of this plan correctly populated). If the latter, the page-level `auth` block is just noise — but we cannot assume that until verified.
- **Architectural impact:** Layer 3 of the four-layer tenant-isolation defense (PRD §8.3) is foundational. If the page-level `auth.roles` blocks are not taking effect, the gate is currently provided ONLY by Task 1's `lowdefy.yaml auth.pages.roles` list. We need to verify whether `auth.pages.roles` in `lowdefy.yaml` is by itself sufficient to enforce role-based page access, AND we need to remove the orphaned page-level `auth:` blocks (or document why they're benign).
- **Why Rule-4:** the Layer-3 tenant-isolation gate is the spine of the cross-tenant-leak defense. Removing the page-level `auth:` block without first proving the `lowdefy.yaml auth.pages.roles` gate works correctly would create a release-blocking security exposure.

#### Rule-4 finding #2: Lowdefy 5.3 schema REJECTS action-level `if:` field (8+ actions affected across multiple pages)

```
[ConfigWarning] must NOT have additional properties - "if"
```
- **Pages confirmed affected:** team_detail.yaml (the 3 actions I just added in commit `8a0b3c5`).
- **Pages likely also affected (NOT yet rebuilt to surface them):** manage_org_units.yaml has 11+ `if:` gates in the tree-grid onCellClicked dispatch chain (plan 02-04). Every action with an `if:` field will hit this warning.
- **What we wrote:**
  ```yaml
  - id: open_detail
    type: Link
    if: { _not: { _eq: [{ _event: column.field }, actions] } }
    params: ...
  ```
- **What 5.3 expects:** Verified-empirically — the action schema does NOT have an `if` (or `skip`) property. The skill reference 07-events-and-actions.md SHOULD be wrong here — line 32 documents `if: <bool>` and `skip: <bool>` as optional action fields, but the running 5.3.0 builder rejects them as additional properties. The skill ref is documenting the API as it was supposed to be, not what 5.3 actually accepts.
- **What's the correct conditional dispatch pattern in 5.3?** Open question — needs investigation. Candidates:
  - `visible:` on the parent block (not always applicable for action chains).
  - JS plugin that returns early when the condition is false.
  - Multiple separate event handlers each fired only when the discriminator value is right (but Lowdefy events don't take selectors).
  - Use `try:` / `catch:` with a custom throwing action to short-circuit.
- **Architectural impact:** Plan 02-04's tree-grid uses 11+ `if:` gates as the foundation of its W6 "Pattern A" column-dispatch (the explicit pattern documented in `02-RESEARCH.md` section "Pattern A — column-typed action dispatch"). If `if:` doesn't work, every column-dispatch site in manage_org_units.yaml, team_detail.yaml, and any future grid-with-actions page needs a redesign.
- **Why Rule-4:** the column-dispatch pattern is documented in 02-RESEARCH.md and 02-PATTERNS.md as the canonical approach for the entire phase. Choosing a replacement pattern is an architectural decision that affects future plans.

#### Rule-4 finding #3: `TagSelector` block does not exist in Lowdefy 5.3 (2 pages affected)

```
[ConfigError] Block type "TagSelector" was used but is not defined. Did you mean "DateSelector"?
```
- **Pages affected:** `app/pages/admin/manage_soldiers.yaml:379` (plan 02-04) and `app/pages/admin/soldier_detail.yaml` (plan 02-06 — `soldier_form.role_tags` uses TagSelector).
- **What we wrote:** A `TagSelector` block to render the role-tag chip-style picker.
- **What 5.3 has:** Suggested "DateSelector" — clearly wrong. The actual 5.3 chip/tag input might be `Selector` with `mode: multiple` + custom rendering, or `MultipleSelector`, or there is no chip-style picker in core blocks and we need a plugin block.
- **Architectural impact:** Smaller blast radius than #1 + #2, but the role-tag picker is a UI-SPEC commitment (Card 2 in soldier_detail; toolbar in manage_role_tags) and Phase 2 closes with the role-tag UX shipped.
- **Why Rule-4:** if the resolution is "add a plugin block", that's a new in-house plugin (we already have shifty-roster + shifty-audit-writer) and adds maintenance surface. The user previously preferred avoiding new in-house plugins.

#### Other findings (NOT blocking; investigate after #1–#3 resolved)

- **`color_swatches.yaml`** uses `layout.contentGutter`, `layout.contentJustify`, `layout.contentWrap` which are deprecated in 5.3 in favour of `layout.gap`, `layout.justify`, `layout.wrap`. Build emits ConfigWarnings; current renders may still work due to alias support, but the warning will become an error in a future patch release.
- **MenuLink schema warning** (`must NOT have additional properties - "pageId"`) on `lowdefy.yaml` menu entries authored in Task 1. The 5.3 schema may want `pathname:` or `route:` instead. Will surface only once the build clears the three Rule-4 findings.
- **Request onError schema warning** — old try/catch alternative API; replaced by `events.<name>.catch:` per skill ref 07.
- **PageHeaderMenu auth schema warning** — same root cause as Rule-4 #1.

### Auto-fix attempt counter for this build cycle

Two auto-fix attempts were made BEFORE the deferred-items decision:

| Attempt | Commit  | Fixed                                | Result                                                |
|---------|---------|--------------------------------------|-------------------------------------------------------|
| 1       | efc378c | 5-site Confirm restructure           | Build advanced past the `Confirm` cliff (user-approved Rule-4 Option A) |
| 2       | 8a0b3c5 | `If`-action → per-action `if:` gates | Build advanced past the `If` cliff; new findings surfaced |
| —       | DEFERRED — auto-fix budget exhausted per Rule 3 (3-attempt limit per task) AND remaining findings cross Rule-4 threshold | — | HALT and report |

## Verbatim 0008_legacy_drop.up.sql

(Unchanged from prior SUMMARY draft — file staged on hpg5 at `C:\shifts-manager\db\migrations\0008_legacy_drop.up.sql`, NOT yet applied.)

```sql
-- 0008_legacy_drop.up.sql — drop Phase-0 bootstrap tables once Phase 2 supersedes them
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
DROP TABLE IF EXISTS availability_legacy;  -- renamed in 0004 per Phase 1 Plan 02 decision
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS employees;

-- The trigger function set_updated_at() is still referenced by other tables;
-- DO NOT drop the function.

COMMIT;
```

## Verification gate outputs (what passed this resume cycle)

- `node tools/check-queries.mjs` → `check-queries: all Knex request blocks have tenant_id filters. NO-RLS-BYPASS PASS`
- `grep 'type: Confirm$'` in app/pages/ → **zero matches** (5 → 0 after Confirm restructure)
- `grep 'type: If'` in app/ → **zero matches** (1 → 0 after If-action removal)
- `grep 'type: ConfirmModal'` in app/pages/ → **5 matches** (in manage_org_units ×2, soldier_detail, team_detail, roster_import)
- `grep 'data-action='` in app/ → zero matches (W6 grep gate still green)
- `git rev-parse HEAD` on hpg5 → `8a0b3c5` (latest pushed main as of build-time)

## Verification cliff (what blocks Task 3)

```
> [builder 8/9] RUN npx lowdefy build:
74.46 [ConfigWarning] must NOT have additional properties - "auth"        — repeated for 9 pages
74.46 [ConfigWarning] must NOT have additional properties - "if"          — repeated for 3 actions
74.46 [ConfigError]   Block type "TagSelector" was used but is not defined. Did you mean "DateSelector"?
74.47 ELIFECYCLE  Command failed with exit code 1.
```

These three findings (page `auth:` rejected, action `if:` rejected, `TagSelector` undefined) span the entire Phase 2 page corpus and require user decision before further auto-fix attempts.

## TDD Gate Compliance

N/A — plan type is `execute`, not `tdd`.

## Self-Check

- File `db/migrations/0008_legacy_drop.up.sql`: FOUND
- File `app/pages/my_profile.yaml`: FOUND
- File `app/pages/admin/manage_soldiers.yaml`: FOUND
- File `app/pages/admin/soldier_detail.yaml`: FOUND (ConfirmModal block at line 396)
- File `app/pages/admin/team_detail.yaml`: FOUND (ConfirmModal block at line 504)
- File `app/pages/admin/manage_org_units.yaml`: FOUND (ConfirmModal blocks at lines 503 + 535)
- File `app/pages/admin/roster_import.yaml`: FOUND (ConfirmModal block at line 464)
- File `CLAUDE.md`: FOUND (modified with deploy-sync section)
- File `.claude/skills/lowdefy/reference/07-events-and-actions.md`: FOUND (corrected)
- Commit `3b70dfb`: FOUND (Task 1)
- Commit `7986b06`: FOUND (Task 2)
- Commit `87c1ab8`: FOUND (Rule-1 fix #1 — ref paths)
- Commit `dac3e31`: FOUND (Rule-1 fix #2 — DisplayMessage)
- Commit `d56c129`: FOUND (docs + skill correction)
- Commit `efc378c`: FOUND (Rule-4 #4 — 5-site Confirm restructure)
- Commit `8a0b3c5`: FOUND (Rule-1 fix #5 — If-action removal)
- hpg5 deploy mirror at HEAD `8a0b3c5`: VERIFIED via `git log -1 --oneline`
- `origin/main` push: `dac3e31..efc378c..8a0b3c5` — all confirmed by push output

## Self-Check: PASSED
