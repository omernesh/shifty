-- 0011_role_tag.up.sql -- per-tenant role-tag catalog (D-13, ROST-07)
-- Backs autocomplete in soldier_detail + CSV preview pre-flight (`validRoleTagKeys`).
-- RLS is inlined in this migration: 0009_rls_policies.up.sql is sealed at schema_migrations.version=10
-- (Phase 1 P01 sequencing rule — immutable once applied), so any tenant-scoped table created after
-- 0009 must ENABLE ROW LEVEL SECURITY and CREATE POLICY tenant_isolation in its own .up.sql file.
-- The `key` CHECK regex `^[a-z][a-z0-9-]*$` is byte-equal to `canonicalizeRoleTag` output in
-- app/plugins/shifty-roster/src/lib/canonicalize.js — these are a single contract.

BEGIN;

-- role_tag -----------------------------------------------------------------
-- Per-tenant catalog of role-tag identifiers. Soldiers reference these by `key`
-- via the soldier.role_tags TEXT[] column (0002). NOT append-only — admins may
-- edit/delete entries in v1.1; the Phase 2 UI surface is read-only by design.
CREATE TABLE role_tag (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$'),
    label       TEXT        COLLATE "he-x-icu",
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE INDEX idx_role_tag_tenant ON role_tag(tenant_id);

-- RLS: inline ENABLE + CREATE POLICY (0009 is sealed; mirror its canonical literal)
ALTER TABLE role_tag ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON role_tag;
CREATE POLICY tenant_isolation ON role_tag
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
