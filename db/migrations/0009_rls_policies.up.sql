-- 0009_rls_policies.up.sql -- enable Postgres RLS on every tenant-scoped table (D-07)
-- The `shifts` role must NOT be SUPERUSER (verify: SELECT rolsuper FROM pg_roles WHERE rolname='shifts' → false).
-- The Knex pool.afterCreate hook in shifty-auth plugin sets app.current_tenant per connection.
--
-- RLS Architecture Notes:
-- - current_setting('app.current_tenant', true) uses missing_ok=true so anonymous sessions return NULL
--   rather than raising an error; the tenant_id = NULL condition evaluates FALSE, blocking all rows.
-- - SET LOCAL (not SET) in the afterCreate hook ensures the value scopes to the transaction only,
--   preventing cross-pooled-connection tenant_id leakage.
-- - Auth.js tables (users/accounts/sessions/verification_tokens) intentionally NOT RLS-protected:
--   they cross tenant boundaries by design (users sign in by email, then session callback hydrates tenant).
--   Tenant scoping happens at the app_user join in ShiftySessionCallback.
-- - Legacy 0001 tables (employees/shifts/assignments/availability/time_clock_entries) intentionally
--   NOT RLS-protected: superseded by Phase 2 migration 0008 (drop). Bootstrap smoke surface is
--   gated by auth.protected (all pages now require login).
-- - The `migrate` service runs as the superuser (postgres user) and bypasses RLS automatically.
--   The `shifts` app role is NOT a superuser; it must respect RLS.
--
-- Pre-flight assertion (run manually before applying):
--   SELECT rolsuper FROM pg_roles WHERE rolname='shifts';  -- must return 'f' (false)
--
-- lookup_invite_code SECURITY DEFINER function: supports pre-tenant invite lookup in signup_with_invite flow.
-- The function executes as its definer (postgres superuser), bypassing RLS on invite_code.
-- Grants EXECUTE to shifts role so the app can call it from signup_with_invite.yaml.

BEGIN;

-- ============================================================================
-- SECURITY DEFINER helper for pre-tenant invite code lookup (signup_with_invite flow)
-- ============================================================================
-- This function is required because invite_code has RLS enabled (below) but the
-- signup_with_invite page must look up a code BEFORE the session has a tenant_id.
-- Running as SECURITY DEFINER (owner = postgres superuser) bypasses RLS.
-- The function is intentionally narrow: it only returns rows for valid, non-expired,
-- non-revoked, non-exhausted codes — no distinguishing errors between invalid reasons
-- (SEC-09: timing-consistent response, no enumeration signal).

CREATE OR REPLACE FUNCTION lookup_invite_code(p_code TEXT)
RETURNS TABLE(id UUID, tenant_id UUID, org_unit_id UUID, role TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT ic.id, ic.tenant_id, ic.org_unit_id, ic.role::TEXT
    FROM invite_code ic
    WHERE ic.code = UPPER(p_code)
      AND (ic.expires_at IS NULL OR ic.expires_at > now())
      AND (ic.max_uses IS NULL OR ic.uses < ic.max_uses)
      AND ic.revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION lookup_invite_code(TEXT) TO shifts;

-- ============================================================================
-- Enable RLS on the special `tenant` table (no tenant_id column; id IS the key)
-- ============================================================================

DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  USING (id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Enable RLS on all tenant-scoped tables (loop via DO block)
-- ============================================================================
-- Each table in the list has a `tenant_id` column that must match the session's
-- current_setting('app.current_tenant', true)::uuid for every row access.
-- The policy covers both SELECT (USING) and INSERT/UPDATE/DELETE (WITH CHECK).

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'org_unit',
    'app_user',
    'soldier',
    'membership',
    'shift_slot',
    'planning_window',
    'shift_instance',
    'availability',
    'assignment',
    'rule',
    'rule_override',
    'swap_request',
    'invite_code',
    'invite_code_redemption',
    'notification_pref',
    'push_subscription',
    'report_recipient',
    'ical_subscription_token',
    'schedule_audit',
    'solver_run',
    'notification_log',
    'roster_import_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
      t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMIT;
