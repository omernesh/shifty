---
phase: 03-availability-rules
plan: 02
subsystem: schema-and-plugin-skeleton
tags:
  - migration
  - postgres-rls
  - auth-callback
  - plugin-registry
  - phase3-prerequisites
  - wave-0
dependency_graph:
  requires:
    - db/migrations/0003_shifts_and_windows.up.sql (planning_window + shift_instance.planning_window_id)
    - db/migrations/0004_availability_rules_swaps.up.sql (availability table)
    - db/migrations/0009_rls_policies.up.sql (RLS on availability + org_unit)
    - db/migrations/0013_layer5_rls_app_role.up.sql (SET ROLE NONE pattern + shifty_app role)
    - app/plugins/shifty-plugin/src/auth/callbacks.js (existing ShiftySessionCallback shape)
    - app/plugins/shifty-plugin/src/types.js (9 Phase 02 handler names)
    - app/plugins/shifty-plugin/src/connections/Knex/Knex.js (9 Phase 02 handler imports)
  provides:
    - db/migrations/0014_phase3_denorms.up.sql + .down.sql (applied on hpg5)
    - availability.planning_window_id (UUID NOT NULL FK + idx_availability_window_soldier)
    - org_unit.template_picked_at (timestamptz NULL)
    - session.user.soldier_id (NULL allowed for non-soldier users)
    - app/plugins/shifty-plugin/src/helpers/availability-source.js (SOURCE_RANK + SOURCE_VALUES)
    - types.js requests[] extended to 21 entries (9 + 12)
    - Knex.js imports + spread map extended with 12 Phase 03 handler symbols
  affects:
    - Plans 03-03..03-06 add ONLY handler files in src/connections/Knex/requests/; types.js + Knex.js untouched
    - Plan 03-05 DeclareAvailability imports SOURCE_RANK for ON CONFLICT precedence
    - Plan 03-07 KnexRawTenant my_availability read query embeds CASE expression mirroring SOURCE_RANK
    - Phase 03 my_availability page binds _user: soldier_id (now populated by callback)
tech_stack:
  added: []
  patterns:
    - Three-step NOT-NULL-with-backfill migration (ADD COLUMN nullable → UPDATE → SET NOT NULL)
    - SET ROLE NONE pre-tenant lookup extended to a third query (soldier_id) in same block
    - Frozen-enum single-source-of-truth pattern for cross-file precedence ordering
    - File-ownership pre-allocation skeleton (imports declared before referenced files exist) to remove downstream plan contention
key_files:
  created:
    - db/migrations/0014_phase3_denorms.up.sql
    - db/migrations/0014_phase3_denorms.down.sql
    - app/plugins/shifty-plugin/src/helpers/availability-source.js
    - .planning/phases/03-availability-rules/03-02-SUMMARY.md
  modified:
    - app/plugins/shifty-plugin/src/auth/callbacks.js
    - app/plugins/shifty-plugin/src/types.js
    - app/plugins/shifty-plugin/src/connections/Knex/Knex.js
decisions:
  - Migration 0014 splits ADD COLUMN (nullable) → UPDATE (idempotent backfill via shift_instance JOIN) → SET NOT NULL into three statements wrapped in BEGIN/COMMIT. This is the standard PostgreSQL pattern for adding a NOT NULL column with backfill; the alternative (DEFAULT value + later DROP DEFAULT) would have populated rows with a sentinel UUID that doesn't actually reference a planning_window, which the FK would reject.
  - org_unit.template_picked_at is nullable with no backfill. NULL means "wizard has not run for this team" — every existing org_unit row legitimately has NULL because no template has been applied. The home-page CTA reads this NULL as the signal to prompt setup.
  - ShiftySessionCallback's new soldier_id lookup reuses the existing SET ROLE NONE block rather than opening a second knex connection or query batch. One extra round-trip per session resolve is acceptable; opening a second connection would double the auth-path latency budget.
  - Knex.js declares all 12 Phase 03 handler imports up front (skeleton wiring) even though the files don't exist yet. This resolves the file-ownership contention that would otherwise have Plans 03-03..03-06 each re-editing the same two files (types.js + Knex.js). Cost: the file does not parse cleanly via the Node ES module loader until Plan 03-07's rebuild — acceptable because no rebuild happens during the intervening plans.
  - SOURCE_RANK is exported as both a named export and a default export. Named exports support `import { SOURCE_RANK }` for explicit, grep-able dependency; the default export supports `import sr from '...'` for ergonomic use inside hot loops where the array key order matters. Both surfaces target the same frozen object — there is exactly one SOURCE_RANK at runtime.
metrics:
  duration_minutes: 8
  completed_at: "2026-05-16T17:16:38Z"
  tasks_completed: 4
  files_created: 4
  files_modified: 3
  commits: 3
  migrations_applied: 1
---

# Phase 03 Plan 02: Wave-0 Prerequisites — migration 0014 + session-callback extension + Knex.js handler skeleton — Summary

Lands the four cross-cutting prerequisites every Phase 03 product plan depends on but no product plan owns: migration 0014 (denorm columns + composite index), the `session.user.soldier_id` extension on `ShiftySessionCallback`, the canonical `SOURCE_RANK` enum, and the types.js + Knex.js handler-registry skeleton with placeholder imports for all 12 downstream handlers — applied on hpg5 with migration version advancing 13 → 14 (dirty=false).

## Tasks Executed (4/4)

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Author + apply migration 0014 (denorm columns + index) | `bd5c495` | `db/migrations/0014_phase3_denorms.up.sql`, `db/migrations/0014_phase3_denorms.down.sql` |
| 2 | Human-verify migration applied correctly on hpg5 | (auto-approved — see §Checkpoint) | (no files) |
| 3 | Extend ShiftySessionCallback to populate `session.user.soldier_id` | `8084e77` | `app/plugins/shifty-plugin/src/auth/callbacks.js` |
| 4 | SOURCE_RANK helper + types.js + Knex.js extended with 12 Phase 03 handler symbols | `c849a43` | `app/plugins/shifty-plugin/src/helpers/availability-source.js`, `app/plugins/shifty-plugin/src/types.js`, `app/plugins/shifty-plugin/src/connections/Knex/Knex.js` |

## Migration 0014 Apply Output (hpg5)

```
$ docker compose run --rm migrate
 Container shifts-postgres Running
 Container shifts-postgres Healthy
 Container shifts-manager-migrate-run-eea9570b3c37 Creating
 Container shifts-manager-migrate-run-eea9570b3c37 Created
14/u phase3_denorms (78.013696ms)
```

(PowerShell flags the docker progress messages on stderr; the meaningful line is the
`14/u phase3_denorms (78ms)` confirmation that migration 14 applied up successfully.)

## Post-apply Schema Verification (hpg5)

All four Task 2 checkpoint verifications passed automatically against `shifts-postgres`:

| Check | Probe | Expected | Actual |
|-------|-------|----------|--------|
| schema_migrations version | `SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1` | `14 \| f` | `14 \| f` |
| availability.planning_window_id shape | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='availability' AND column_name='planning_window_id'` | `planning_window_id \| uuid \| NO` | `planning_window_id \| uuid \| NO` |
| availability FK target | `SELECT conname, confrelid::regclass FROM pg_constraint WHERE conrelid='availability'::regclass AND conname LIKE '%planning_window%'` | references `planning_window` | `availability_planning_window_id_fkey \| planning_window` |
| org_unit.template_picked_at shape | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='org_unit' AND column_name='template_picked_at'` | `timestamp with time zone \| YES` | `timestamp with time zone \| YES` |
| Backfill completeness | `SELECT COUNT(*) FROM availability WHERE planning_window_id IS NULL` | `0` | `0` |
| Composite index exists | `SELECT indexname FROM pg_indexes WHERE tablename='availability' AND indexname='idx_availability_window_soldier'` | one row | `idx_availability_window_soldier` |

## Checkpoint Handling

Task 2 was a `checkpoint:human-verify` per plan frontmatter `autonomous: false`. Auto mode is active in `.planning/config.json` (`workflow.auto_advance: true` AND `workflow._auto_chain_active: true`). Per `<checkpoint_protocol>` for auto mode:

> **checkpoint:human-verify** → Auto-approve **except package-legitimacy checkpoints**.

The Task 2 checkpoint is not a package-legitimacy gate (`gate="blocking"`, not `gate="blocking-human"`), so it qualified for auto-approval. All four verification probes ran automatically and returned the expected values, so the checkpoint was auto-approved and execution proceeded to Task 3.

```
⚡ Auto-approved checkpoint Task 2: 4/4 migration verification queries match expectations.
```

## Session Shape After Task 3

Before:
```js
session.user = { user_id, tenant_id, roles, team_ids, locale }
```

After:
```js
session.user = { user_id, tenant_id, soldier_id, roles, team_ids, locale }
```

`soldier_id` is `NULL` for users not on any roster (admins-only, or app_user rows that exist before a CSV import has added them as a soldier). Downstream handlers must guard. The lookup runs inside the same SET ROLE NONE block as the existing `app_user.tenant_id` / `membership.roles` discovery so all three queries share one knex connection lifecycle.

## SOURCE_RANK Single Source of Truth

`app/plugins/shifty-plugin/src/helpers/availability-source.js`:

```js
export const SOURCE_RANK = Object.freeze({
  manager_override: 3,
  per_slot: 2,
  range_blockout: 1,
  default: 0,
});
export const SOURCE_VALUES = Object.keys(SOURCE_RANK);
export default SOURCE_RANK;
```

The frozen object cannot be mutated at runtime. Plan 03-05 DeclareAvailability imports it for ON CONFLICT precedence logic; Plan 03-07 KnexRawTenant my_availability SQL embeds a CASE expression that must mirror the order. A unit test in 03-05 (planned) asserts the CASE expression string matches `SOURCE_VALUES` to prevent silent drift.

## Plugin Registry State After Task 4

`types.js requests:` array now has 21 entries (9 Phase 02 + 12 Phase 03, in documentation order):

```
KnexRawTenant, AuditWrite, ParseCsvAndValidate, CommitRosterImport, CreateSoldier,
UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater,
CreateShiftSlot, UpdateShiftSlot, DeleteShiftSlot,
OpenPlanningWindow, EditPlanningWindow, DeletePlanningWindow,
ApplyShiftTemplate, DeclareAvailability,
UpsertRule, UpsertRuleOverride, ResetRuleOverride, SeedTeamRules
```

`Knex.js` mirrors the registry with 12 new `import ... from './requests/<Name>.js'` lines and 12 new spread-map entries.

## Deviations from Plan

**None — plan executed exactly as written, with one nuance noted below in §Known Gaps regarding verifier behavior.**

No Rule 1/2/3/4 deviations occurred. The migrate compose `command:` already includes `up` so `docker compose run --rm migrate` (without an appended `up` arg) is the correct invocation — this is consistent with the compose-file comment "Note: 'up' is already included in the command above; do not append it to the run command." A first attempt with the appended `up` failed parsing (`URL cannot be empty`) and was retried without the trailing `up`, which succeeded. This was anticipated by the compose-file comment, not a true deviation.

## Known Gaps / Carry-forward

1. **Verifier passes despite 12 dangling imports — by design, not by accident.** `tools/check-handler-registration.mjs` (Plan 03-01) reports `OK 9/9 handlers registered correctly` against the current `main` HEAD. The verifier discovers handler files in `src/connections/Knex/requests/`, iterates over those, and verifies each one is registered in both `types.js` and `Knex.js`. It does NOT check the reverse — that every name in the registry has a corresponding file on disk. Consequence: the 12 Phase 03 imports referencing not-yet-existent files (`./requests/CreateShiftSlot.js` etc.) are not flagged. This is structurally fine — the verifier's job is "every handler I built is registered", not "every registration has a handler" — but it means the verifier cannot serve as a "Phase 03 is done" gate; that job belongs to Plan 03-07 closeout's full build + smoke test. Downstream plans that ADD handler files trigger the verifier on the newly-added files, so the protection works in the direction it was designed.

2. **Knex.js does not parse via the standalone Node ES loader until Plan 03-07.** Running `node --input-type=module -e "import('./app/plugins/shifty-plugin/src/connections/Knex/Knex.js')"` fails with `ERR_MODULE_NOT_FOUND` — first on `@lowdefy/connection-knex` (not installed at repo root), then later on the missing handler files. This is documented in the Knex.js file header comment. Lowdefy is not rebuilt against this file until Plan 03-07; in the meantime hpg5 continues to run the previously-deployed Lowdefy container against the Phase 02 plugin shape. No production impact.

3. **The 12 Phase 03 handler files are owed by Plans 03-03..03-06.** Per the plan-allocation table in 03-CONTEXT (and confirmed below):
   - Plan 03-03 (template + shift management): `ApplyShiftTemplate`, `CreateShiftSlot`, `UpdateShiftSlot`, `DeleteShiftSlot`
   - Plan 03-04 (planning windows): `OpenPlanningWindow`, `EditPlanningWindow`, `DeletePlanningWindow`
   - Plan 03-05 (availability): `DeclareAvailability`
   - Plan 03-06 (rules): `UpsertRule`, `UpsertRuleOverride`, `ResetRuleOverride`, `SeedTeamRules`

## Decisions Made

(Repeated from frontmatter `decisions:` for visibility.)

1. Three-step ADD-COLUMN-with-backfill pattern (nullable → UPDATE → SET NOT NULL) over the default-value-then-drop-default alternative — avoids inserting a sentinel UUID that the FK would reject.
2. `org_unit.template_picked_at` nullable with no backfill — NULL is the legitimate "wizard never ran" state.
3. Reuse the existing SET ROLE NONE block for the soldier_id lookup (one extra round-trip in the same connection lifecycle) rather than opening a second knex connection.
4. Declare all 12 Phase 03 imports up front in Knex.js as skeleton wiring — accepted cost: Knex.js doesn't parse standalone until Plan 03-07.
5. Export `SOURCE_RANK` as both a named export and a default export — supports both `import { SOURCE_RANK }` (explicit, grep-able) and `import sr from` (ergonomic) without duplicating state.

## Self-Check: PASSED

Files created (verified to exist):
- FOUND: `db/migrations/0014_phase3_denorms.up.sql`
- FOUND: `db/migrations/0014_phase3_denorms.down.sql`
- FOUND: `app/plugins/shifty-plugin/src/helpers/availability-source.js`
- FOUND: `.planning/phases/03-availability-rules/03-02-SUMMARY.md` (this file)

Files modified (verified by git diff in commit chain):
- FOUND: `app/plugins/shifty-plugin/src/auth/callbacks.js` (in `8084e77`)
- FOUND: `app/plugins/shifty-plugin/src/types.js` (in `c849a43`)
- FOUND: `app/plugins/shifty-plugin/src/connections/Knex/Knex.js` (in `c849a43`)

Commits (verified via `git log --oneline`):
- FOUND: `bd5c495` feat(03-02): add migration 0014 — Phase 03 denorm columns
- FOUND: `8084e77` feat(03-02): extend ShiftySessionCallback to populate session.user.soldier_id
- FOUND: `c849a43` feat(03-02): SOURCE_RANK helper + Phase 03 handler skeleton in types.js + Knex.js

Migration apply (verified via psql on hpg5):
- FOUND: `schema_migrations.version=14, dirty=f`
- FOUND: `availability.planning_window_id` is `uuid NOT NULL` with FK `availability_planning_window_id_fkey → planning_window`
- FOUND: `org_unit.template_picked_at` is `timestamptz` nullable
- FOUND: `idx_availability_window_soldier` index exists
- FOUND: 0 rows with NULL `planning_window_id`
