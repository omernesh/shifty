-- 0005_auth_and_notifications.sql -- invite codes, redemption log, notification prefs, push subs, report recipients, iCal tokens
-- Builds on 0002 (app_user, soldier, org_unit). No RLS preamble — DDL only.
-- report_recipient.display_name uses COLLATE "he-x-icu" per I18N-07.
-- invite_code.code enforces Crockford base32 regex per AUTH-04.
-- Composite (tenant_id, ...) indexes per PERF-04.

BEGIN;

-- invite_code --------------------------------------------------------------
-- Single-use or multi-use codes for inviting soldiers to a team.
-- code enforces 8-char Crockford base32 alphabet (AUTH-04).
CREATE TABLE invite_code (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code            TEXT        NOT NULL
                    CHECK (code ~ '^[0-9A-HJKMNPQRSTVWXYZ]{8}$'),
    org_unit_id     UUID        NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL
                    CHECK (role IN ('unit_admin', 'team_manager', 'member', 'viewer')),
    expires_at      TIMESTAMPTZ,
    max_uses        INTEGER,
    uses            INTEGER     NOT NULL DEFAULT 0 CHECK (uses >= 0),
    revoked_at      TIMESTAMPTZ,
    created_by      UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_invite_code_tenant ON invite_code(tenant_id);
CREATE INDEX idx_invite_code_code   ON invite_code(code);

-- invite_code_redemption ---------------------------------------------------
-- Append-only log of each invite code use. No updated_at (immutable).
CREATE TABLE invite_code_redemption (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    invite_code_id  UUID        NOT NULL REFERENCES invite_code(id) ON DELETE RESTRICT,
    user_id         UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_code_redemption_tenant ON invite_code_redemption(tenant_id);
CREATE INDEX idx_invite_code_redemption_code   ON invite_code_redemption(invite_code_id);

-- notification_pref --------------------------------------------------------
-- Per-user notification channel preferences per event type.
CREATE TABLE notification_pref (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    event_type  TEXT        NOT NULL,
    channels    JSONB       NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_type)
);

CREATE INDEX idx_notification_pref_tenant ON notification_pref(tenant_id);

-- push_subscription --------------------------------------------------------
-- Web Push subscription endpoint + keys per user. Phase 6 consumer; provisioned now for RLS coverage.
CREATE TABLE push_subscription (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    endpoint    TEXT        NOT NULL,
    keys        JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscription_tenant ON push_subscription(tenant_id);

-- report_recipient ---------------------------------------------------------
-- Email report recipient list (manager/admin distribution). Phase 6 consumer.
CREATE TABLE report_recipient (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    email           CITEXT      NOT NULL,
    display_name    TEXT        COLLATE "he-x-icu",
    locale          TEXT        NOT NULL DEFAULT 'he'
                    CHECK (locale IN ('he', 'en')),
    subscriptions   JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_recipient_tenant ON report_recipient(tenant_id);

-- ical_subscription_token --------------------------------------------------
-- Signed iCal subscription tokens per soldier. Phase 7 consumer; provisioned now for RLS coverage.
-- token is globally unique (used as a URL secret — no tenant filter in the query path).
CREATE TABLE ical_subscription_token (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id  UUID        NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    token       TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_ical_token_tenant  ON ical_subscription_token(tenant_id);
CREATE INDEX idx_ical_token_token   ON ical_subscription_token(token);

-- updated_at triggers -------------------------------------------------------
-- invite_code_redemption: no updated_at (append-only)
-- push_subscription: no updated_at (immutable endpoint record)
-- ical_subscription_token: no updated_at (revocation via revoked_at column)

CREATE TRIGGER trg_invite_code_updated_at
    BEFORE UPDATE ON invite_code
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_pref_updated_at
    BEFORE UPDATE ON notification_pref
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_report_recipient_updated_at
    BEFORE UPDATE ON report_recipient
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
