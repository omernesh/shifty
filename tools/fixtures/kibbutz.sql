-- tools/fixtures/kibbutz.sql
-- 12 soldiers, 1 team, 64-day planning window mirroring tenant #1's Google Sheet.
-- One soldier (row 12) intentionally has a U+2019 RIGHT SINGLE QUOTATION MARK in
-- display_name to enforce UUID-only-joins rule (PRD §2 "smart-quote bug defense").
-- Seeded in both local dev and CI integration tests.
--
-- Dependencies:
--   - Migration 0002 must be applied (provides tenant, org_unit, soldier tables).
--   - planning_window INSERT is commented out until migration 0003 applies (Plan 02).

BEGIN;

-- Tenant
INSERT INTO tenant (id, name, org_depth)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Kibbutz', 1);

-- Root org_unit (single-level = root is also the leaf)
INSERT INTO org_unit (id, tenant_id, parent_id, level, name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', NULL, 1, 'צוות ראשי');

-- 12 soldiers (11 normal + 1 with U+2019 in display_name)
INSERT INTO soldier (id, tenant_id, display_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'יוסי כהן'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'דני לוי'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'מרב גולן'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'אמיר ברק'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'רותם דהן'),
  ('1111aaaa-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'יעל מזרחי'),
  ('2222aaaa-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'חיים פרץ'),
  ('3333aaaa-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'אלון שמואל'),
  ('4444aaaa-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'מאיה אבני'),
  ('5555aaaa-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'גיא צור'),
  ('6666aaaa-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'נועה שטרן'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'נועם ג’לאל');
  --                                                                                        ^-- U+2019 RIGHT SINGLE QUOTATION MARK

-- 64-day planning window (Phase 1 only seeds the window; Phase 4 solver test uses it)
-- Uncomment after migration 0003 applies (Plan 02):
-- INSERT INTO planning_window (id, tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
-- VALUES ('99999999-9999-9999-9999-999999999999',
--         '11111111-1111-1111-1111-111111111111',
--         '22222222-2222-2222-2222-222222222222',
--         CURRENT_DATE, CURRENT_DATE + 63, CURRENT_DATE + 58, 'open');

COMMIT;
