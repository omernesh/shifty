-- 0014_phase3_denorms.up.sql — Phase 03 denorm columns (availability.planning_window_id + org_unit.template_picked_at).
--
-- Why this migration exists:
--   Phase 03's hot read path (my_availability page; RESEARCH §"Recipe 6") needs to filter
--   availability rows by planning_window_id without paying a JOIN through shift_instance on
--   every page render. Today availability rows reach their window only via
--     availability.shift_instance_id → shift_instance.planning_window_id
--   That's an extra index hop per page; the (planning_window_id, soldier_id) read happens
--   on every page navigation for every authenticated soldier. We denormalize by storing
--   planning_window_id directly on `availability` and back this with a composite index.
--
--   The denorm is consistent-by-construction: every availability row INSERT/UPDATE in
--   Phase 03 handlers must populate planning_window_id from the same shift_instance row
--   it references (the DeclareAvailability handler in Plan 03-05 owns this invariant).
--   We do NOT add a CHECK or trigger to enforce it because Phase 02 closes with zero
--   availability rows and Phase 03 owns every future write; a defensive trigger would
--   add cost without a real attacker model (RLS already blocks cross-tenant writes).
--
--   org_unit.template_picked_at: nullable timestamptz that the team-setup wizard
--   (Plan 03-04 ApplyShiftTemplate) stamps when a team first picks a shift template.
--   NULL means the wizard has not run for that team — used by the home page to drive
--   the "Set up your team" CTA. No backfill: every existing org_unit row legitimately
--   has NULL because no template has been applied.
--
-- RLS interaction:
--   `availability` already has RLS enabled (migration 0009). Adding a column does NOT
--   change which policies apply; the existing tenant_id predicate is unaffected.
--   `org_unit` likewise has existing RLS; same reasoning.
--
-- Backfill UPDATE:
--   Phase 02 closes with zero availability rows in production data, so the backfill
--   UPDATE affects zero rows in practice. The SQL must still be present because:
--     (a) some test environments may have non-zero availability rows from earlier
--         experiments,
--     (b) re-running the migration against a partially-populated environment must be
--         a no-op (the `IS NULL` predicate makes the UPDATE idempotent), and
--     (c) the NOT NULL constraint that follows would fail if any availability row had
--         a NULL planning_window_id at apply time.
--
--   The UPDATE derives planning_window_id from shift_instance via the existing
--   shift_instance_id FK. If an availability row references a shift_instance that
--   itself has no planning_window_id (impossible — shift_instance.planning_window_id
--   is NOT NULL per migration 0003), the UPDATE leaves the row's planning_window_id
--   NULL and the subsequent SET NOT NULL would fail. That failure mode is desirable:
--   it surfaces a data-integrity bug, not a migration bug.
--
-- Idempotency:
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS — safe to re-run.
--   UPDATE ... WHERE planning_window_id IS NULL — safe to re-run; already-set rows are skipped.
--   ALTER TABLE ... ALTER COLUMN SET NOT NULL — no-op when already NOT NULL.
--   CREATE INDEX IF NOT EXISTS — safe to re-run.

BEGIN;

-- 1. availability.planning_window_id — denorm with FK + ON DELETE CASCADE.
--    ADD COLUMN is nullable here so the backfill UPDATE can populate it before the
--    NOT NULL constraint is applied. Splitting "add column" and "set not null" is
--    standard practice for adding a NOT NULL column with a backfill.
ALTER TABLE availability
    ADD COLUMN IF NOT EXISTS planning_window_id UUID
        REFERENCES planning_window(id) ON DELETE CASCADE;

-- 2. Backfill from shift_instance.planning_window_id.
--    Idempotent — only touches rows where planning_window_id is NULL.
UPDATE availability av
   SET planning_window_id = si.planning_window_id
  FROM shift_instance si
 WHERE av.shift_instance_id = si.id
   AND av.planning_window_id IS NULL;

-- 3. Promote to NOT NULL once the backfill is complete.
ALTER TABLE availability
    ALTER COLUMN planning_window_id SET NOT NULL;

-- 4. Composite index for the hot read path: filter availability by window + soldier.
--    RESEARCH §"Recipe 6" my_availability page query:
--      SELECT ... FROM availability WHERE planning_window_id = :w AND soldier_id = :s
CREATE INDEX IF NOT EXISTS idx_availability_window_soldier
    ON availability(planning_window_id, soldier_id);

-- 5. org_unit.template_picked_at — nullable timestamptz; no backfill (NULL means
--    "no template applied yet" for every existing team).
ALTER TABLE org_unit
    ADD COLUMN IF NOT EXISTS template_picked_at TIMESTAMPTZ;

COMMIT;
