-- 0014_phase3_denorms.down.sql — reverse Phase 03 denorms.
--
-- Structural-only reversal. We do NOT attempt to repopulate dropped data because both
-- columns are denorms reachable via JOIN (availability.planning_window_id derives from
-- shift_instance; org_unit.template_picked_at has no upstream source — its loss is
-- benign because NULL is the legitimate "wizard never ran" state).
--
-- Order: drop index BEFORE dropping the indexed column so Postgres doesn't need to
-- rebuild internal state.

BEGIN;

-- 1. Drop the composite index that depends on planning_window_id.
DROP INDEX IF EXISTS idx_availability_window_soldier;

-- 2. Drop the denorm column on availability (FK is dropped with the column).
ALTER TABLE availability
    DROP COLUMN IF EXISTS planning_window_id;

-- 3. Drop the wizard timestamp on org_unit.
ALTER TABLE org_unit
    DROP COLUMN IF EXISTS template_picked_at;

COMMIT;
