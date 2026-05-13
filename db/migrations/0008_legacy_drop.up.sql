-- 0008_legacy_drop.up.sql -- drop Phase-0 bootstrap tables once Phase 2 supersedes them
-- Phase 1 D-06 deferred this migration to the Phase 2 boundary.
-- Pre-flight checklist (verify before applying):
--   1. app/lowdefy.yaml no longer contains the `employees` page (was lines 131–183).
--   2. app/lowdefy.yaml `menus.links` no longer contains employees_link (was lines 81–85).
--   3. tools/check-queries.mjs reports zero violations.
--   4. Playwright cross-tenant-leak.spec.ts run is clean without `/employees` in scope.
--
-- Order: drop in reverse FK dependency to avoid FK violations.
--   employees (0001) is referenced by:
--     shifts.role_required (no FK) — but assignments.employee_id and time_clock_entries.employee_id
--     reference employees(id); availability.employee_id references employees(id).
--   shifts (0001) is referenced by assignments.shift_id and time_clock_entries.shift_id.
--   Reverse-FK order: time_clock_entries -> availability_legacy -> assignments -> shifts -> employees.
--   Note: 0004 renamed `availability` -> `availability_legacy` to free the name for the new
--   multi-tenant `availability` table; we drop the LEGACY one here.
--
-- The trigger function set_updated_at() is referenced by other tables — DO NOT drop it.
-- (Postgres' DROP TABLE auto-drops triggers ON the table; it does NOT drop the function
--  body, which is shared with org_unit, soldier, app_user, availability, assignment, rule,
--  rule_override, swap_request, and Phase-2+ tables.)
--
-- Idempotent: every DROP uses IF EXISTS so a re-run is a no-op (golang-migrate also short-
-- circuits via schema_migrations.version, but IF EXISTS belt-and-braces against manual reruns).

BEGIN;

DROP TABLE IF EXISTS time_clock_entries;
DROP TABLE IF EXISTS availability_legacy;  -- renamed in 0004 per Phase 1 Plan 02 decision
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS employees;

-- The trigger function set_updated_at() is still referenced by other tables;
-- DO NOT drop the function.

COMMIT;
