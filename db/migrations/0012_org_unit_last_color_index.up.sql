-- 0012_org_unit_last_color_index.up.sql -- org_unit.last_color_index column (D-15, ROST-06)
-- Backs the 24-color round-robin palette assignment in CreateSoldier flow (plan 02-06).
-- The -1 sentinel encodes "no soldier has been color-assigned yet"; pickNextColor(lastIndex)
-- in app/plugins/shifty-roster/src/lib/palette.js branches on `lastIndex < 0 → return 0`,
-- so the first soldier in a fresh team gets palette[0]. Any non-negative value (0..23)
-- means "the previous assignment used that index — wrap (i+1) mod 24 for the next one".
--
-- RLS: org_unit already has ENABLE ROW LEVEL SECURITY + tenant_isolation policy from 0009
-- (the DO-block loop includes 'org_unit' in tenant_tables). This migration adds nothing
-- for RLS — column additions inherit the existing table-level policy automatically.
--
-- No new index: org_unit.idx_org_unit_tenant (0002 line 45) already covers tenant_id
-- access patterns. The last_color_index column is read alongside the row, never alone,
-- so no per-column index is justified.

BEGIN;

ALTER TABLE org_unit ADD COLUMN last_color_index SMALLINT NOT NULL DEFAULT -1 CHECK (last_color_index BETWEEN -1 AND 23);

COMMIT;
