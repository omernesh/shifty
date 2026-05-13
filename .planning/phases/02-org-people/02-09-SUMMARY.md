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
    - Lowdefy 5.3 action-name corrections (Message → DisplayMessage, Confirm → ConfirmModal pattern)
  affects:
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (corrected)
    - CLAUDE.md (deploy mechanism documented)
    - 4 Phase-2 pages cleaned up for Lowdefy 5.3 compatibility (DisplayMessage)
    - 5 Phase-2 pages still BLOCKED on `Confirm` action (architectural decision needed — see Deferred Items)
tech_stack:
  added: []
  patterns:
    - git pull deploy sync (replaces per-file pscp)
    - DisplayMessage with status param (Lowdefy 5.3 toast action)
    - ConfirmModal block + CallMethod toggleOpen + events.onOk (Lowdefy 5.3 confirmation pattern, NOT yet adopted)
key_files:
  created:
    - db/migrations/0008_legacy_drop.up.sql
  modified:
    - app/lowdefy.yaml (Task 1)
    - app/pages/my_profile.yaml (Rule-1 fixes)
    - app/pages/admin/manage_soldiers.yaml (Rule-1 fix)
    - app/pages/admin/soldier_detail.yaml (Rule-1 fixes)
    - app/pages/admin/team_detail.yaml (Rule-1 fixes)
    - CLAUDE.md (deploy docs)
    - .claude/skills/lowdefy/reference/07-events-and-actions.md (action-name corrections)
decisions:
  - Adopted git pull as Phase 2+ deploy sync on hpg5 (per user approval — Option B over per-file pscp)
  - Identified Lowdefy 5.3 API drift: Message → DisplayMessage rename and Confirm-action removal are both real (verified empirically against the running 5.3.0 builder)
  - Skill file 07-events-and-actions.md updated to current 5.3 reality with explicit verification timestamps
metrics:
  duration: ~50 min (interactive — multiple build retries + investigations)
  completed_date: 2026-05-14
  tasks_completed: 2 of 3 (Task 3 blocked at the Lowdefy build cliff — Confirm action needs architectural restructure)
  commits: 5 (3b70dfb, 7986b06, 87c1ab8, dac3e31, d56c129)
---

# Phase 2 Plan 09: Lowdefy wiring + legacy schema drop — Summary (CP-B blocked)

## One-liner

Wired the 7 new Phase-2 pages into `app/lowdefy.yaml` and authored migration `0008_legacy_drop.up.sql` to drop the Phase-0 bootstrap tables; deploy-bootstrapped `C:\shifts-manager\` on hpg5 as a `git pull`–driven mirror per user-approved Option B; uncovered THREE Lowdefy-5.3 API drifts (one fixed in place, one partially fixed, one BLOCKING) and a Phase-1 legacy commit that referenced `Message` and `Confirm` actions which no longer exist in 5.3.

## Status: BLOCKED at Task 3 step 2 (Docker build)

The deploy-bootstrap completed cleanly (Steps 1–4 of the bootstrap recipe green); the migration file is authored and idempotent; the lowdefy.yaml wiring passes its automated verification. But the Docker build on hpg5 fails because **5 Phase-2 pages use `type: Confirm` as an inline action**, and that action does NOT exist in Lowdefy 5.3 (`[ConfigError] Action type "Confirm" was used but is not defined.`). Migrating to the canonical 5.3 pattern (`ConfirmModal` block + `CallMethod toggleOpen` + `events.onOk`) is a real architectural restructure across 4 Phase-2 plans and crosses the Rule-4 threshold for explicit user approval.

## What landed (commits)

| Task | Commit  | Purpose                                                                  |
|------|---------|--------------------------------------------------------------------------|
| 1    | 3b70dfb | wire Phase-2 pages + remove /employees bootstrap                         |
| 2    | 7986b06 | author 0008_legacy_drop.up.sql                                           |
| —    | 87c1ab8 | Rule-1 auto-fix: `_ref:` paths to `color_swatches.yaml` resolve from app/ |
| —    | dac3e31 | Rule-1 auto-fix: rename `Message` action → `DisplayMessage` (5.3 API)    |
| —    | d56c129 | docs: wire git-pull deploy on hpg5 + correct skill action-name table     |

All five commits are pushed to `origin/main` at `https://github.com/omernesh/shifty.git`.

## Deploy-bootstrap (one-time, completed)

Per user approval (Option B), `C:\shifts-manager\` on hpg5 was bootstrapped as a git working tree tracking `origin/main`:

| Step | Command (summary)                                          | Result                              |
|------|-----------------------------------------------------------|-------------------------------------|
| 0    | Push 88 local commits to `origin/main`                     | `692b82d..7986b06  main -> main` ✓ |
| 1    | `Test-Path C:\shifts-manager\.git`                         | False (was not a git repo) → init  |
| 2    | Backup `.env`, `git init`, `git remote add origin`, `git fetch origin main` | `[new branch] main -> origin/main` ✓ |
| 3    | `git checkout -f -b main origin/main`                      | HEAD now at `7986b06` ✓             |
| 4    | Hash-compare `.env` vs backup → identical → delete backup | `.env` survived intact ✓            |
| 5    | Inventory: 6 admin pages + my_profile + 0008.up.sql + plugins/shifty-roster | All present ✓        |

`.gitignore` covers `.env`, `postgres-data/`, and `*.log` — none of those were touched by the checkout. The bootstrap is a one-time operation; subsequent deploys use just `git fetch + git reset --hard origin/main` (documented in `CLAUDE.md` under "Deploy sync — `git pull` (Phase 2+ canonical)").

## Deviations from Plan

### Rule-1 auto-fixes (3 distinct issues discovered during Task 3 Docker build)

**1. [Rule 1 — Bug] `_ref:` paths to `app/blocks/color_swatches.yaml` were broken (commit `87c1ab8`)**
- **Found during:** Task 3 step 2 (Docker build, first attempt)
- **Issue:** `app/pages/my_profile.yaml:116` used `_ref: ../blocks/color_swatches.yaml` and `app/pages/admin/soldier_detail.yaml:315` used `_ref: ../../blocks/color_swatches.yaml`. Lowdefy resolves `_ref:` paths from the **config root** (`app/`, where `lowdefy.yaml` lives), NOT from the referring file's directory — so both resolved to `/blocks/color_swatches.yaml` above the config root and the build failed with `[ConfigError] Referenced file does not exist`.
- **Fix:** Both now use the canonical `_ref: blocks/color_swatches.yaml` form.
- **Files modified:** `app/pages/my_profile.yaml`, `app/pages/admin/soldier_detail.yaml`
- **Commit:** `87c1ab8`

**2. [Rule 1 — Bug] `Message` action does not exist in Lowdefy 5.3 (commit `dac3e31`)**
- **Found during:** Task 3 step 2 (Docker build, second attempt — after fix #1)
- **Issue:** 7 occurrences of `type: Message` across 4 pages (plans 06, 07, 08 authored these). Lowdefy 5.3 renamed the action to `DisplayMessage` and the param key from `type:` to `status:`. The build rejected all 7 with `[ConfigError] Action type "Message" was used but is not defined.` The legacy `Message` name is still mentioned in some Lowdefy docs at the events-and-actions overview page, but the per-action API page documents `DisplayMessage` as the current type, and the running 5.3.0 builder is the ground truth.
- **Fix:** Renamed all 7 occurrences. `params.type` → `params.status`. Locations:
  - `app/pages/my_profile.yaml:138` (color_saved_toast)
  - `app/pages/admin/manage_soldiers.yaml:335` (success_toast)
  - `app/pages/admin/soldier_detail.yaml:228` (invite_toast)
  - `app/pages/admin/soldier_detail.yaml:350` (save_toast)
  - `app/pages/admin/soldier_detail.yaml:402` (archive_toast)
  - `app/pages/admin/team_detail.yaml:407` (remove_toast)
  - `app/pages/admin/team_detail.yaml:496` (add_success_toast)
- **Files modified:** all 4 above + `.claude/skills/lowdefy/reference/07-events-and-actions.md` (skill corrected to match 5.3 reality with explicit verification dates)
- **Commits:** `dac3e31`, `d56c129`

**3. [Rule 4 — Architectural] `Confirm` action does not exist in Lowdefy 5.3 — BLOCKING — deferred to checkpoint**
- **Found during:** Task 3 step 2 (Docker build, third attempt — after fix #2)
- **Issue:** 5 occurrences of `type: Confirm` (inline action chains) across 4 pages. Lowdefy 5.3 has no `Confirm` action; the canonical pattern is the `ConfirmModal` block + `CallMethod toggleOpen` + `events.onOk`. The build rejects with `[ConfigError] Action type "Confirm" was used but is not defined.`
- **Why this is architectural (Rule 4):** the legacy inline `Confirm` was **synchronous** (action chain pauses for OK/Cancel; subsequent actions run only on OK). The 5.3 `ConfirmModal` pattern is **asynchronous** — the destructive action chain must move to `events.onOk` on the modal block, and the click handler becomes a single `CallMethod` to open the modal. Restructuring this across 5 sites touches plans 04 (`manage_org_units` — 2 sites), 06 (`soldier_detail` — 1 site, `team_detail` — 1 site), and 08 (`roster_import` — 1 site).
- **Locations** (deferred to the next executor):
  - `app/pages/admin/manage_org_units.yaml:331` (confirm_delete — delete leaf org_unit)
  - `app/pages/admin/manage_org_units.yaml:400` (confirm_grow_depth — admin consent to grow org_depth)
  - `app/pages/admin/soldier_detail.yaml:386` (confirm_archive — archive soldier)
  - `app/pages/admin/team_detail.yaml:379` (confirm_remove — remove team member)
  - `app/pages/admin/roster_import.yaml:426` (confirm_modal — confirm batch import + send invites)
- **Decision needed:** continue with the canonical `ConfirmModal`-block restructure (correct), OR ship a thin shim plugin that re-introduces a `Confirm` action wrapping `ConfirmModal` (faster but adds a 6th in-house plugin to maintain).

### Deferred items (NOT auto-fixed; documented for the next executor)

- **`Confirm` action restructure across 5 sites** — see Deviation #3 above. Until resolved, the Lowdefy container on hpg5 cannot build, the new Phase-2 surface cannot go live, and migration 0008 cannot apply (the order-of-operations contract — UI ships first, schema drop second — is unbroken).
- **`ConfigWarning`s in the build log** (non-blocking, but worth a follow-up pass after the Confirm restructure):
  - `must NOT have additional properties - "pageId"` on `MenuLink` — possibly schema drift; if so the menu links still render but the schema should be looked up.
  - `must NOT have additional properties - "onError"` on `Request` blocks — likely an old try/catch alternative API; review per page.
  - `must NOT have additional properties - "auth"` on `PageHeaderMenu` — checking whether `auth.roles` should be at the page top level or under a different sibling.
- **Skill file `07-events-and-actions.md` — `Notification` action mention is now soft-stale**: the doc says use `DisplayMessage` or an `Alert` block instead. If Phase 2 or later needs banner-style notifications, validate the actual 5.3 API at that point.
- **Resend invite SDK call site (Plan 02-08's `CommitRosterImport.js`)** still uses Node `fetch` — not affected by this plan's blocker, but a future Plan-02-09-follow-up could verify the import-time invite send actually reaches Resend once the Lowdefy build is unblocked.

## Verbatim 0008_legacy_drop.up.sql

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

The migration is staged on hpg5 at `C:\shifts-manager\db\migrations\0008_legacy_drop.up.sql` but is **NOT yet applied** — applying it before the new Phase-2 surface is live would break the running `/employees` route until the next container restart. The W2-tightened resume-signal contract from the plan (all five verifications green) is honored: Step 2 (build) fails, so the apply step is correctly held back.

## Verification gate outputs (what passed)

- `node tools/check-queries.mjs` → `check-queries: all Knex request blocks have tenant_id filters. NO-RLS-BYPASS PASS`
- Task 1 verify command → exits 0 (forbidden tokens absent, required tokens present)
- Task 2 verify command → exits 0 (migration file shape valid)
- Deploy-bootstrap Steps 1–4 → all green (Phase-2 files present on hpg5)
- `git rev-parse HEAD` on hpg5 → `dac3e31` (latest pushed main as of build-time; now `d56c129` after the docs commit)
- `.env` hash equality between pre-bootstrap backup and post-checkout state → True

## Verification cliff (what blocks Task 3)

```
> [builder 8/9] RUN npx lowdefy build:
73.47 [21:33:33] ✘ [ConfigError] Action type "Confirm" was used but is not defined.
73.48 [21:33:33] ELIFECYCLE  Command failed with exit code 1.
```

This is the SINGLE remaining build error after the two Rule-1 auto-fixes. The build had been failing with 7 errors before fix #1 + fix #2 (2 ref-path errors, 7 Message errors); each fix reduced the count to the next blocking class. The third class (Confirm) requires architectural restructure (Rule 4).

## TDD Gate Compliance

N/A — plan type is `execute`, not `tdd`.

## Self-Check

- File `db/migrations/0008_legacy_drop.up.sql`: FOUND
- File `app/pages/my_profile.yaml`: FOUND
- File `app/pages/admin/manage_soldiers.yaml`: FOUND
- File `app/pages/admin/soldier_detail.yaml`: FOUND
- File `app/pages/admin/team_detail.yaml`: FOUND
- File `CLAUDE.md`: FOUND (modified with deploy-sync section)
- File `.claude/skills/lowdefy/reference/07-events-and-actions.md`: FOUND (corrected)
- Commit `3b70dfb`: FOUND (Task 1)
- Commit `7986b06`: FOUND (Task 2)
- Commit `87c1ab8`: FOUND (Rule-1 fix #1 — ref paths)
- Commit `dac3e31`: FOUND (Rule-1 fix #2 — DisplayMessage)
- Commit `d56c129`: FOUND (docs + skill correction)
- hpg5 deploy mirror `C:\shifts-manager\.git`: EXISTS (verified via `Test-Path` after init)
- `origin/main` push: `692b82d..7986b06`, `7986b06..87c1ab8`, `87c1ab8..dac3e31`, `dac3e31..d56c129` — all confirmed by push output

## Self-Check: PASSED
