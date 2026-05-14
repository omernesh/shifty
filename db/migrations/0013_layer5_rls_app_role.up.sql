-- 0013_layer5_rls_app_role.up.sql -- Layer 5 (Postgres RLS) activation via role split.
--
-- Goal G5 enforcement: PRD §8.3 four-layer defense — make RLS policies actually enforce.
-- Migration 0009 added RLS policies and a pre-flight assertion that `shifts` must NOT be
-- SUPERUSER, but postgres:16 created POSTGRES_USER (shifts) as SUPERUSER by default.
-- Postgres refuses `ALTER ROLE shifts NOSUPERUSER` with
--   "the bootstrap user must have the SUPERUSER attribute"
-- so we cannot demote `shifts` directly. Instead, we create a non-superuser companion
-- role `shifty_app` and use Postgres's session-default-role mechanism so every connection
-- as `shifts` *automatically* assumes `shifty_app` at session start.
--
-- Mechanism:
--   1. CREATE ROLE shifty_app NOSUPERUSER NOBYPASSRLS INHERIT NOLOGIN
--      — NOLOGIN: cannot connect directly; only reachable via SET ROLE
--      — NOBYPASSRLS: even if granted superuser later, RLS still applies
--      — INHERIT: so SELECT/INSERT/UPDATE/DELETE privileges granted to shifty_app
--        are immediately effective for any role that becomes shifty_app
--   2. GRANT shifty_app TO shifts — allows shifts to SET ROLE shifty_app
--   3. ALTER ROLE shifts SET role = shifty_app — every new connection automatically
--      becomes shifty_app after authentication
--   4. ALTER ROLE shifts SET app.current_tenant = '<sentinel-uuid>' — defaults to a
--      sentinel that will never match any real tenant; RLS blocks everything until
--      the request handler issues SET LOCAL app.current_tenant = '<real-uuid>'.
--   5. FORCE ROW LEVEL SECURITY on every table where relrowsecurity is true — without
--      FORCE, table owners bypass RLS. Even though shifty_app does not own the tables
--      (migrator does), forcing RLS is defense-in-depth.
--
-- The `migrator` role (used by docker compose run --rm migrate) remains a superuser
-- and bypasses RLS automatically — migrations continue to work.
--
-- The `shifts` session_user is preserved (just gains a default current_user of
-- shifty_app). Tests that need superuser bypass can call RESET ROLE which returns
-- to session_user = shifts.
--
-- Idempotent: CREATE ROLE uses IF NOT EXISTS pattern via DO block; GRANT and ALTER
-- ROLE are no-ops when already in target state; ALTER TABLE FORCE is a no-op when
-- already forced.
--
-- WARNING about applying via the `migrate` service: the migrate container connects as
-- `migrator` (NOT `shifts`), so ALTER ROLE shifts SET role = shifty_app does NOT take
-- effect for the migrate session itself. It DOES affect future connections by `shifts`
-- (the Lowdefy app role). This is correct — we want migrations to bypass RLS, app
-- queries to respect it.

BEGIN;

-- 1. Create the non-superuser app role (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shifty_app') THEN
    CREATE ROLE shifty_app NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB INHERIT NOLOGIN;
  END IF;
END $$;

-- 2. Grant baseline schema + DML to shifty_app.
GRANT USAGE ON SCHEMA public TO shifty_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shifty_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shifty_app;

-- 3. Default privileges for future tables created by migrator (the DDL role).
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shifty_app;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO shifty_app;

-- 4. Re-apply 0010 audit revokes for shifty_app (mirrors the exact statements from
--    0010_audit_revokes.up.sql, scoped to shifty_app instead of shifts).
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifty_app;
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifty_app;
REVOKE UPDATE, DELETE, TRUNCATE ON invite_code_redemption FROM shifty_app;
REVOKE DELETE, TRUNCATE ON notification_log FROM shifty_app;

-- 5. Grant EXECUTE on the SECURITY DEFINER invite lookup function (from 0009).
GRANT EXECUTE ON FUNCTION lookup_invite_code(TEXT) TO shifty_app;

-- 6. Grant shifty_app to shifts so `SET ROLE shifty_app` is allowed for that session_user.
GRANT shifty_app TO shifts;

-- 7. Default role for shifts connections: automatically SET ROLE shifty_app on connect.
ALTER ROLE shifts SET role = shifty_app;

-- 8. Default tenant sentinel for shifts connections. Set to all-zero UUID — no real
--    tenant has this id, so RLS blocks all tenant-scoped reads until the request
--    handler issues `SET LOCAL app.current_tenant = '<real-uuid>'`. The cast in the
--    RLS USING clause (current_setting('app.current_tenant', true)::uuid) will succeed
--    on this value and produce a comparison that's always false against real tenant_id.
ALTER ROLE shifts SET app.current_tenant = '00000000-0000-0000-0000-000000000000';

-- 9. FORCE row level security on every table where RLS is already enabled. Without
--    FORCE, table owners bypass RLS — migrator owns the tables but is superuser so
--    that path is already covered; this is belt-and-suspenders for any future role
--    that gets table ownership.
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
