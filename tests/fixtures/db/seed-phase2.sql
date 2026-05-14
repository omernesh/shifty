-- tests/fixtures/db/seed-phase2.sql
-- Phase 2 minimum seed: two tenants with admin users, leaf teams, and role_tags.
-- Used for manual / offline validation when the full e2e seed-tenants.ts helper is not
-- available (e.g., quick psql smoke against a fresh migration set).
--
-- UUIDs are deterministic (fixed) so this seed is idempotent.
-- Run: psql -U shifts -d shifts -f tests/fixtures/db/seed-phase2.sql
--
-- Preconditions:
--   All migrations up through 0012 must be applied.
--   app.current_tenant GUC is set per-INSERT to satisfy RLS policies.

BEGIN;

-- ─── Tenant A ────────────────────────────────────────────────────────────────
SELECT set_config('app.current_tenant', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

INSERT INTO tenant (id, name, org_depth) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Seed Tenant A', 1)
  ON CONFLICT (id) DO NOTHING;

-- Root org_unit for Tenant A
INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES
  ('aaaabbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 1, 'Root Unit A')
  ON CONFLICT (id) DO NOTHING;

-- Leaf team (Phase 2) — this is the team_id used in CSV fixtures
INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES
  ('aaaacccc-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaabbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 'Team Alpha A')
  ON CONFLICT (id) DO NOTHING;

-- Auth.js users row for admin-A
INSERT INTO "users" (id, name, email, "emailVerified") VALUES
  ('aaaadddd-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin-a', 'admin-a@example.test', now())
  ON CONFLICT (id) DO NOTHING;

-- app_user for admin-A
INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id) VALUES
  ('aaaaeee1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'admin-a@example.test', 'Admin A', 'he', 'aaaadddd-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  ON CONFLICT (id) DO NOTHING;

-- Soldier row for admin-A
INSERT INTO soldier (id, tenant_id, user_id, display_name) VALUES
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaaeee1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin A Soldier')
  ON CONFLICT (id) DO NOTHING;

-- Membership (admin role)
INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role) VALUES
  ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaabbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'unit_admin')
  ON CONFLICT (soldier_id, org_unit_id) DO NOTHING;

-- Role tags for Tenant A
INSERT INTO role_tag (id, tenant_id, key, label) VALUES
  ('aaaarol1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'driving', 'driving'),
  ('aaaarol2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'comms', 'comms'),
  ('aaaarol3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'medic', 'medic')
  ON CONFLICT (tenant_id, key) DO NOTHING;

-- ─── Tenant B ────────────────────────────────────────────────────────────────
SELECT set_config('app.current_tenant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

INSERT INTO tenant (id, name, org_depth) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seed Tenant B', 1)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES
  ('bbbbaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 1, 'Root Unit B')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO org_unit (id, tenant_id, parent_id, level, name) VALUES
  ('bbbbcccc-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, 'Team Alpha B')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO "users" (id, name, email, "emailVerified") VALUES
  ('bbbbdddd-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin-b', 'admin-b@example.test', now())
  ON CONFLICT (id) DO NOTHING;

INSERT INTO app_user (id, tenant_id, email, display_name, locale, user_id) VALUES
  ('bbbbeee1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'admin-b@example.test', 'Admin B', 'he', 'bbbbdddd-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO soldier (id, tenant_id, user_id, display_name) VALUES
  ('bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbeee1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin B Soldier')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO membership (id, tenant_id, soldier_id, org_unit_id, role) VALUES
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'unit_admin')
  ON CONFLICT (soldier_id, org_unit_id) DO NOTHING;

INSERT INTO role_tag (id, tenant_id, key, label) VALUES
  ('bbbbrol1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'driving', 'driving'),
  ('bbbbrol2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'comms', 'comms'),
  ('bbbbrol3-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'medic', 'medic')
  ON CONFLICT (tenant_id, key) DO NOTHING;

COMMIT;

-- Summary:
-- Tenant A: id=aaaaaaaa-..., admin=admin-a@example.test, team=aaaacccc-...
-- Tenant B: id=bbbbbbbb-..., admin=admin-b@example.test, team=bbbbcccc-...
