-- 0013_layer5_rls_app_role.down.sql -- revert Layer 5 RLS role split.
-- Reverses the changes in 0013_layer5_rls_app_role.up.sql for emergency rollback.
-- After this runs, `shifts` reverts to having no default role/tenant, and FORCE RLS
-- is removed (RLS itself remains enabled per 0009 — that's a separate migration).

BEGIN;

-- 1. Remove FORCE on tables (RLS itself stays enabled per 0009).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- 2. Reset shifts session defaults.
ALTER ROLE shifts RESET role;
ALTER ROLE shifts RESET app.current_tenant;

-- 3. Revoke shifty_app from shifts.
REVOKE shifty_app FROM shifts;

-- 4. Drop shifty_app (after revoking ownership of any defaults).
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM shifty_app;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM shifty_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM shifty_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM shifty_app;
REVOKE USAGE ON SCHEMA public FROM shifty_app;
REVOKE EXECUTE ON FUNCTION lookup_invite_code(TEXT) FROM shifty_app;

DROP ROLE IF EXISTS shifty_app;

COMMIT;
