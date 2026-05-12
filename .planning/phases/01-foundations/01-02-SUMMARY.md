---
phase: 01-foundations
plan: 02
subsystem: database
tags: [postgresql, knex, lowdefy, pnpm, docker, migrations, golang-migrate, plugins]

# Dependency graph
requires:
  - phase: 01-01
    provides: "tenant/org/auth schema (0001-0002), docker-compose stack, pnpm workspace layout, migrate service"
provides:
  - "SQL migrations 0003-0007: all Phase 1 domain tables (shift_slot, planning_window, shift_instance, availability, assignment, rule, rule_override, swap_request, invite_code, invite_code_redemption, notification_pref, push_subscription, report_recipient, ical_subscription_token, schedule_audit, solver_run, notification_log, roster_import_log)"
  - "shifty-audit-writer Lowdefy plugin: AuditWrite request handler with actor-from-session invariant"
  - "Lowdefy Docker build proven to include local file: protocol plugins"
  - "Kibbutz fixture updated with planning_window INSERT unblocked"
affects:
  - 01-03
  - 01-04
  - 01-05
  - "phases 2-7 (all domain tables now provisioned)"

# Tech tracking
tech-stack:
  added:
    - "shifty-audit-writer: custom Lowdefy ESM plugin with dynamic knex import"
    - "pnpm file: protocol for local plugins without workspace.yaml in Docker"
  patterns:
    - "Lowdefy plugin file: protocol: version 'file:../../plugins/<name>' in lowdefy.yaml (relative from .lowdefy/server/)"
    - "Docker: exclude pnpm-workspace.yaml via .dockerignore to prevent inner pnpm install workspace-mode hang"
    - "Dynamic knex import in AuditWrite.js for unit-testability without live DB"
    - "Append-only tables (schedule_audit, solver_run, roster_import_log, invite_code_redemption): no updated_at column"

key-files:
  created:
    - db/migrations/0003_shifts_and_windows.up.sql
    - db/migrations/0004_availability_rules_swaps.up.sql
    - db/migrations/0005_auth_and_notifications.up.sql
    - db/migrations/0006_audit_and_solver_runs.up.sql
    - db/migrations/0007_imports_and_exports.up.sql
    - app/plugins/shifty-audit-writer/src/types.js
    - app/plugins/shifty-audit-writer/src/connections.js
    - app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js
    - app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs
    - app/.npmrc
  modified:
    - tools/fixtures/kibbutz.sql
    - app/lowdefy.yaml
    - app/package.json
    - app/Dockerfile
    - app/.dockerignore
    - app/plugins/shifty-audit-writer/package.json

key-decisions:
  - "Legacy availability table from 0001 renamed to availability_legacy in 0004 (D-06: keep smoke-test surface through Phase 1; drop in 0008 at Phase 2 boundary)"
  - "pnpm-workspace.yaml excluded from Docker context via .dockerignore; plugin referenced via file: protocol in both package.json and lowdefy.yaml to avoid 2.5h workspace-mode hang in Lowdefy's inner pnpm install"
  - "lowdefy.yaml plugin version 'file:../../plugins/shifty-audit-writer' — path is relative from .lowdefy/server/ where Lowdefy's addCustomPluginsAsDeps writes into package.json"
  - "Dynamic import of knex inside AuditWrite.js (not top-level) so unit tests pass without knex installed locally"
  - "invite_code has updated_at (redemption flow INCs uses counter via UPDATE); invite_code_redemption is append-only (no updated_at)"
  - "notification_log has updated_at + trigger (status transitions); only DELETE/TRUNCATE revoked in 0010, not UPDATE"

patterns-established:
  - "append-only table: omit updated_at; no set_updated_at trigger"
  - "Lowdefy local plugin: file:../../plugins/<name> in lowdefy.yaml; file:./plugins/<name> in package.json"
  - "Docker local plugin: exclude pnpm-workspace.yaml from context; COPY plugins/ before pnpm install"
  - "AuditWrite actor_user_id: always request.user?.user_id — never request.properties"

requirements-completed: [I18N-07, PERF-04, OPS-02]

# Metrics
duration: ~3h30m (including 2.5h debugging Docker workspace hang)
completed: 2026-05-12
---

# Phase 01 Plan 02: Schema Completion + Audit-Writer Plugin Summary

**Five SQL migrations (0003-0007) deploying all Phase 1 domain tables plus a Lowdefy ESM plugin (shifty-audit-writer) with actor-from-session AuditWrite handler — Docker build fixed by excluding pnpm-workspace.yaml from context**

## Performance

- **Duration:** ~3h 30m (including 2.5h diagnosing Docker workspace-mode hang)
- **Started:** 2026-05-12 (session 1 start)
- **Completed:** 2026-05-12T19:13:00+03:00 (local time on hpg5)
- **Tasks:** 3 (Tasks 1 + 2 + 3 with TDD cycle)
- **Files modified:** 16

## Accomplishments
- Applied golang-migrate versions 0003-0007 on hpg5 — all 18 domain tables provisioned with tenant_id FKs, Hebrew collation, composite indexes, set_updated_at() triggers
- Delivered shifty-audit-writer plugin: AuditWrite request handler that guards actor_user_id from session; 3/3 unit tests pass; plugin registered in Lowdefy build
- Fixed Docker build to include local file: protocol plugins without workspace.yaml causing inner pnpm install to hang

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrations 0003-0005 + kibbutz fixture** - `ff6c600` (feat)
2. **Task 2: Migrations 0006-0007** - `8284dc3` (feat)
3. **Task 3 RED: failing AuditWrite unit tests** - `c404598` (test)
4. **Task 3 GREEN: AuditWrite implementation** - `52b3616` (feat)
5. **Task 3 COMPLETE: plugin registered + Docker build fixed** - `7845c1b` (feat)

## Files Created/Modified
- `db/migrations/0003_shifts_and_windows.up.sql` — shift_slot, planning_window, shift_instance tables; Hebrew collation on shift_slot.name; midnight-span allowed (SHFT-01)
- `db/migrations/0004_availability_rules_swaps.up.sql` — availability, assignment, rule, rule_override, swap_request; renames legacy availability to availability_legacy (D-06)
- `db/migrations/0005_auth_and_notifications.up.sql` — invite_code (Crockford base32 regex), invite_code_redemption, notification_pref, push_subscription, report_recipient (Hebrew collation), ical_subscription_token
- `db/migrations/0006_audit_and_solver_runs.up.sql` — schedule_audit (append-only, no updated_at), solver_run (append-only), notification_log (has updated_at)
- `db/migrations/0007_imports_and_exports.up.sql` — roster_import_log (append-only, Phase 2 consumer)
- `app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js` — request handler; dynamic knex import; guards actor_user_id from session
- `app/plugins/shifty-audit-writer/src/types.js` — plugin type registry: `{ requests: ['AuditWrite'] }`
- `app/plugins/shifty-audit-writer/src/connections.js` — aggregator export
- `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` — 3 unit tests via node:test
- `app/plugins/shifty-audit-writer/package.json` — added knex dependency
- `app/.npmrc` — shamefully-hoist=true for node module resolution compatibility
- `app/.dockerignore` — added pnpm-workspace.yaml to exclusions
- `app/Dockerfile` — added COPY plugins/ before pnpm install; updated comments
- `app/lowdefy.yaml` — added shifty-audit-writer at file:../../plugins/shifty-audit-writer
- `app/package.json` — added shifty-audit-writer: file:./plugins/shifty-audit-writer
- `tools/fixtures/kibbutz.sql` — uncommented planning_window INSERT block (Blocker 4 fix)

## Decisions Made

1. **Legacy availability table rename (D-06)**: Migration 0004 adds `ALTER TABLE IF EXISTS availability RENAME TO availability_legacy` to preserve the smoke-test page through Phase 1. Migration 0008 (Phase 2) will drop it.

2. **pnpm-workspace.yaml excluded from Docker**: When pnpm-workspace.yaml exists at /build/ inside Docker, Lowdefy's inner pnpm install (cwd .lowdefy/server/) enters workspace mode, causing packages to land in the pnpm virtual store rather than node_modules/. This broke yargs resolution and caused a 2.5h hang. Exclusion via .dockerignore + file: protocol resolves it permanently.

3. **lowdefy.yaml version 'file:../../plugins/shifty-audit-writer'**: Lowdefy's addCustomPluginsAsDeps.js writes this into .lowdefy/server/package.json before running pnpm install. The path must be relative to .lowdefy/server/ (two levels up to reach /build/plugins/). The workspace:* variant requires pnpm-workspace.yaml which we now exclude.

4. **Dynamic knex import**: Top-level `import knex from 'knex'` prevents unit tests from loading the module when knex is not installed locally. Moving the import inside the function body (after guard clauses) allows tests 2 and 3 to pass without knex.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Legacy availability table name conflict in migration 0004**
- **Found during:** Task 1 (Migration 0004 first apply attempt)
- **Issue:** The new domain `availability` table in 0004 clashed with the legacy `availability` table created by 0001_init.up.sql. `CREATE TABLE availability` failed with "already exists".
- **Fix:** Added `ALTER TABLE IF EXISTS availability RENAME TO availability_legacy;` at the top of 0004. Per D-06, the legacy table must survive through Phase 1. Migration 0008 (Phase 2 boundary) will drop it.
- **Files modified:** db/migrations/0004_availability_rules_swaps.up.sql
- **Verification:** Migration applied successfully; both tables visible in `\dt`; smoke page still returns HTTP 200
- **Committed in:** ff6c600 (Task 1 commit)

**2. [Rule 3 - Blocking] schema_migrations dirty state after failed 0004 attempt**
- **Found during:** Task 1 (after first 0004 apply failed midway)
- **Issue:** golang-migrate left schema_migrations with version=4, dirty=t. Recovery attempts accidentally deleted all rows (WHERE clause omitted in initial DELETE). Multiple rows in schema_migrations caused migrate to behave unexpectedly (expects single row).
- **Fix:** `TRUNCATE schema_migrations; INSERT INTO schema_migrations VALUES (3, false);` — reset to clean state at version 3, then re-ran migrate up.
- **Files modified:** N/A (DB state fix only)
- **Verification:** `migrate up` applied 0004-0007 cleanly after reset
- **Committed in:** ff6c600 (included in same task commit)

**3. [Rule 3 - Blocking] Docker workspace-mode hang — 2.5h on "Installing dependencies."**
- **Found during:** Task 3 (Docker build with workspace:* plugin)
- **Issue:** pnpm-workspace.yaml at /build/ caused Lowdefy's inner pnpm install (.lowdefy/server/) to enter workspace mode. Packages landed in pnpm virtual store (/build/node_modules/.pnpm/) instead of direct symlinks. lowdefy/build.mjs tried to `import 'yargs'` and couldn't traverse to it. Build hung for 2.5h.
- **Fix:** Added pnpm-workspace.yaml to .dockerignore; changed package.json to file:./plugins/shifty-audit-writer; changed lowdefy.yaml to file:../../plugins/shifty-audit-writer (correct relative path from .lowdefy/server/).
- **Files modified:** app/.dockerignore, app/package.json, app/lowdefy.yaml, app/Dockerfile, app/.npmrc
- **Verification:** docker compose build exits 0; /employees returns HTTP 200; plugin visible in build output as "shifty-audit-writer 1.0.0"
- **Committed in:** 7845c1b (Task 3 complete commit)

**4. [Rule 1 - Bug] Top-level knex import blocked unit test loading**
- **Found during:** Task 3 RED phase (unit tests)
- **Issue:** `import knex from 'knex'` at module top caused node:test to fail loading AuditWrite.js with ERR_MODULE_NOT_FOUND because knex is not installed locally (only in Docker).
- **Fix:** Changed to dynamic `const { default: knex } = await import('knex')` inside the function body, AFTER the guard clauses. Guard-clause tests (tests 2 and 3) never reach the import.
- **Files modified:** app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js
- **Verification:** `node --test tests/audit-writer.test.mjs` — all 3 tests pass
- **Committed in:** 52b3616 (Task 3 GREEN commit)

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 blocking)
**Impact on plan:** All auto-fixes essential for schema correctness and build functionality. No scope creep.

## Issues Encountered

- **pnpm workspace:* vs file: in lowdefy.yaml**: The plan specified `version: 'workspace:*'` for the plugin in lowdefy.yaml. This is correct for development but only works when pnpm-workspace.yaml is present in the Docker image. Keeping the workspace file caused the hang; removing it required switching to file: protocol. The plan's "workspace:* reference resolves" success criterion is satisfied in spirit — the plugin loads in the build — but via file: protocol rather than workspace:*.

- **Lowdefy addCustomPluginsAsDeps path resolution**: The lowdefy.yaml version string is written verbatim into .lowdefy/server/package.json by Lowdefy's `addCustomPluginsAsDeps.js`. The path must be relative to `.lowdefy/server/`, not to the project root. This is undocumented in Lowdefy's official docs but visible in the source at `packages/cli/src/utils/addCustomPluginsAsDeps.js`.

## TDD Gate Compliance

Task 3 followed the RED/GREEN cycle:
- RED commit: `c404598` — 3 failing tests written first
- GREEN commit: `52b3616` — implementation passing all 3 tests
- No REFACTOR commit needed (code was already clean)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

All Phase 1 tables provisioned:
- **Plan 03** can apply RLS (migration 0009) and audit REVOKEs (migration 0010) to the now-existing tables
- **Plan 03** can add the admin_test_audit YAML page using the AuditWrite request type
- **Plan 04** Playwright spec can test audit-writer.spec.ts (live INSERT into schedule_audit)
- **Phase 2** can add migration 0008 (drop legacy tables) at the Phase 1/2 boundary

Blockers for Plan 03: none — all dependency tables exist; plugin registered.

---
*Phase: 01-foundations*
*Completed: 2026-05-12*
