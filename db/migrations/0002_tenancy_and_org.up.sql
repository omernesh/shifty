-- 0002_tenancy_and_org.sql -- multi-tenant foundations + NextAuth KnexAdapter schema
-- Introduces tenant scoping; supersedes the single-tenant 0001 in Phase 2 via 0008 (deferred).
-- Includes NextAuth KnexAdapter tables (users/accounts/sessions/verification_tokens) per D-05.
-- Hebrew text columns use COLLATE "he-x-icu" per I18N-07.
-- Composite (tenant_id, ...) indexes per PERF-04.
-- No RLS preamble needed — this migration is DDL-only.

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email matching (needed for app_user.email)
-- pgcrypto already enabled in 0001 (provides gen_random_uuid())

-- ICU Hebrew collation for ORDER BY correctness on Hebrew text columns.
-- The postgres:16 image ships with ICU support; IF NOT EXISTS makes this idempotent.
CREATE COLLATION IF NOT EXISTS "he-x-icu" (PROVIDER = icu, LOCALE = 'he');

-- ============================================================================
-- Shifty domain tables (FK order: tenant → org_unit → users → app_user → soldier → membership)
-- ============================================================================

-- tenant -------------------------------------------------------------------
-- id IS the tenant key — no tenant_id column on tenant itself.
-- RLS policy (migration 0009): USING (id = current_setting('app.current_tenant')::uuid)
CREATE TABLE tenant (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        COLLATE "he-x-icu" NOT NULL,
    org_depth   SMALLINT    NOT NULL CHECK (org_depth BETWEEN 1 AND 3),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- org_unit -----------------------------------------------------------------
CREATE TABLE org_unit (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    parent_id   UUID        REFERENCES org_unit(id) ON DELETE CASCADE,
    level       SMALLINT    NOT NULL,
    name        TEXT        COLLATE "he-x-icu" NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, parent_id, name)
);

CREATE INDEX idx_org_unit_tenant        ON org_unit(tenant_id);
CREATE INDEX idx_org_unit_tenant_parent ON org_unit(tenant_id, parent_id);

-- ============================================================================
-- NextAuth KnexAdapter tables (Auth.js schema contract — exact names required)
-- NOTE: app_user is the Shifty domain user; users is the Auth.js adapter table.
-- KnexAdapter writes to users; session callback joins via email to app_user.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "users" (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT,
    email           TEXT        UNIQUE,
    "emailVerified" TIMESTAMPTZ,
    image           TEXT
);

-- app_user -----------------------------------------------------------------
-- Shifty domain user; linked to Auth.js users table via user_id FK.
CREATE TABLE app_user (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    email           CITEXT      NOT NULL,
    display_name    TEXT        COLLATE "he-x-icu",
    locale          TEXT        NOT NULL DEFAULT 'he' CHECK (locale IN ('he', 'en')),
    user_id         UUID        REFERENCES "users"(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX idx_app_user_tenant ON app_user(tenant_id, email);
CREATE INDEX idx_app_user_user_id ON app_user(user_id);

-- soldier ------------------------------------------------------------------
CREATE TABLE soldier (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    display_name TEXT       COLLATE "he-x-icu" NOT NULL,
    color       TEXT        NOT NULL DEFAULT '#3B82F6',
    seniority   SMALLINT    NOT NULL DEFAULT 0 CHECK (seniority BETWEEN 0 AND 10),
    role_tags   TEXT[]      NOT NULL DEFAULT '{}',
    phone_e164  TEXT,
    status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_soldier_tenant        ON soldier(tenant_id);
CREATE INDEX idx_soldier_tenant_status ON soldier(tenant_id, status) WHERE status = 'active';

-- membership ---------------------------------------------------------------
CREATE TABLE membership (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id  UUID        NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    org_unit_id UUID        NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    role        TEXT        NOT NULL CHECK (role IN ('unit_admin', 'team_manager', 'member', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (soldier_id, org_unit_id)
);

CREATE INDEX idx_membership_tenant    ON membership(tenant_id);
CREATE INDEX idx_membership_soldier   ON membership(soldier_id);
CREATE INDEX idx_membership_org_unit  ON membership(org_unit_id);

-- ============================================================================
-- NextAuth KnexAdapter remaining tables
-- Quoted identifiers MUST match Auth.js convention exactly — KnexAdapter throws
-- "column does not exist" if these names differ.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"            UUID    NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    type                TEXT    NOT NULL,
    provider            TEXT    NOT NULL,
    "providerAccountId" TEXT    NOT NULL,
    refresh_token       TEXT,
    access_token        TEXT,
    expires_at          INTEGER,
    token_type          TEXT,
    scope               TEXT,
    id_token            TEXT,
    session_state       TEXT,
    UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    "sessionToken"  TEXT        NOT NULL UNIQUE,
    "userId"        UUID        NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    expires         TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier  TEXT        NOT NULL,
    token       TEXT        NOT NULL UNIQUE,
    expires     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- ============================================================================
-- updated_at triggers — reuse set_updated_at() from 0001 (do NOT redefine it)
-- ============================================================================

CREATE TRIGGER trg_tenant_updated_at
    BEFORE UPDATE ON tenant
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_org_unit_updated_at
    BEFORE UPDATE ON org_unit
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_app_user_updated_at
    BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_soldier_updated_at
    BEFORE UPDATE ON soldier
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
