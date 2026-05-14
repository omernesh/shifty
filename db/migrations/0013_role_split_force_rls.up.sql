-- 0013_role_split_force_rls.up.sql
-- Goal G5 enforcement: activate Layer 5 (Postgres RLS) for the app role.
-- See PRD §8.3 four-layer defense and CLAUDE.md "Why PsExec" section's reference
-- to docs/OPERATIONS.md "Postgres role split". Migration 0009 enabled RLS policies
-- and added a pre-flight assertion that `shifts` must NOT be SUPERUSER — but the
-- postgres:16 image creates POSTGRES_USER as SUPERUSER by default and no migration
-- demoted it. Discovered during Phase 02 UAT live run (2026-05-14): the
-- cross-tenant-leak direct-pg test failed because the app role bypassed RLS.
--
-- This migration:
--   1. Reassigns ownership of public-schema tables owned by `shifts` to `migrator`,
--      so the table-owner RLS bypass doesn't apply to the app role.
--   2. Demotes `shifts` (NOSUPERUSER + NOBYPASSRLS) so RLS policies enforce.
--   3. Grants `shifts` DML on all public tables; re-applies 0010 audit REVOKEs.
--   4. FORCE ROW LEVEL SECURITY on RLS-enabled tables so even migrator (which still
--      runs as superuser for DDL) cannot accidentally read across tenants in app code
--      paths that happen to execute via the migrate path.
--
-- Idempotent: ALTER ROLE / ALTER TABLE OWNER / GRANT / REVOKE / FORCE are no-ops
-- when already in the target state.

BEGIN;

-- 1. Reassign ownership of all public-schema tables owned by `shifts` to `migrator`.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tableowner = 'shifts'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO migrator', r.tablename);
  END LOOP;
END $$;

-- 2. Demote shifts role so RLS policies apply.
ALTER ROLE shifts NOSUPERUSER NOBYPASSRLS;

-- 3. Grant baseline DML to shifts on all public tables; default privileges for
--    future tables created by migrator.
GRANT USAGE ON SCHEMA public TO shifts;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shifts;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shifts;

-- 4. Re-apply 0010 audit revokes (the GRANT ALL above re-granted them).
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON invite_code_redemption FROM shifts;
REVOKE DELETE, TRUNCATE ON notification_log FROM shifts;

-- 5. FORCE row security on tables with RLS enabled.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

COMMIT;
