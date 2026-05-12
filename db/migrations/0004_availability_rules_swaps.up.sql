-- 0004_availability_rules_swaps.sql -- soldier availability declarations, rule overrides, and 1-for-1 swap requests
-- Builds on 0003 (shift_instance, planning_window). No RLS preamble — DDL only.
-- Composite (tenant_id, ...) indexes per PERF-04.
--
-- NOTE: The legacy single-tenant `availability` table from 0001_init.sql is renamed to
-- `availability_legacy` here to make room for the new multi-tenant domain table with the
-- same name. Migration 0008 (Phase 2 boundary) will DROP `availability_legacy` along with
-- the other 0001 legacy tables (D-06). The bootstrap /employees page is unaffected.

BEGIN;

-- Rename legacy availability to avoid name collision (D-06: 0008 drops it at Phase 2 boundary)
ALTER TABLE IF EXISTS availability RENAME TO availability_legacy;

-- availability -------------------------------------------------------------
-- Soldier's availability declaration for a specific shift instance.
CREATE TABLE availability (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id          UUID        NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    shift_instance_id   UUID        NOT NULL REFERENCES shift_instance(id) ON DELETE CASCADE,
    declared            TEXT        NOT NULL
                        CHECK (declared IN ('available', 'unavailable')),
    source              TEXT        NOT NULL
                        CHECK (source IN ('default', 'range_blockout', 'per_slot', 'manager_override')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (soldier_id, shift_instance_id)
);

CREATE INDEX idx_availability_tenant   ON availability(tenant_id);
CREATE INDEX idx_availability_soldier  ON availability(soldier_id);
CREATE INDEX idx_availability_instance ON availability(shift_instance_id);

-- assignment ---------------------------------------------------------------
-- Draft or published assignment of a soldier to a shift instance.
CREATE TABLE assignment (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    shift_instance_id   UUID        NOT NULL REFERENCES shift_instance(id) ON DELETE CASCADE,
    soldier_id          UUID        NOT NULL REFERENCES soldier(id) ON DELETE RESTRICT,
    state               TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (state IN ('draft', 'published')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shift_instance_id, soldier_id)
);

CREATE INDEX idx_assignment_tenant       ON assignment(tenant_id);
CREATE INDEX idx_assignment_tenant_state ON assignment(tenant_id, state);
CREATE INDEX idx_assignment_instance     ON assignment(shift_instance_id);

-- rule ---------------------------------------------------------------------
-- Scheduling constraint rules scoped to a team.
CREATE TABLE rule (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id     UUID        NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    rule_key    TEXT        NOT NULL
                CHECK (rule_key IN (
                    'no_same_day_double',
                    'no_consecutive_shift2_then_shift1',
                    'max_consecutive_nights',
                    'weekend_separation',
                    'max_weekly_hours',
                    'min_rest_hours_between_shifts',
                    'max_shifts_per_period',
                    'fairness_objective'
                )),
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    value       JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, team_id, rule_key)
);

CREATE INDEX idx_rule_tenant ON rule(tenant_id);

-- rule_override ------------------------------------------------------------
-- Per-soldier override of a rule value (e.g., max_weekly_hours for one soldier).
CREATE TABLE rule_override (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    rule_id     UUID        NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
    soldier_id  UUID        NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    value       JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rule_id, soldier_id)
);

CREATE INDEX idx_rule_override_tenant ON rule_override(tenant_id);

-- swap_request -------------------------------------------------------------
-- 1-for-1 assignment swap proposal between two soldiers.
CREATE TABLE swap_request (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    from_assignment_id      UUID        NOT NULL REFERENCES assignment(id) ON DELETE RESTRICT,
    to_assignment_id        UUID        NOT NULL REFERENCES assignment(id) ON DELETE RESTRICT,
    initiator_soldier_id    UUID        NOT NULL REFERENCES soldier(id) ON DELETE RESTRICT,
    counterparty_soldier_id UUID        NOT NULL REFERENCES soldier(id) ON DELETE RESTRICT,
    state                   TEXT        NOT NULL DEFAULT 'proposed'
                            CHECK (state IN (
                                'proposed',
                                'awaiting_mgr',
                                'pending_manager',
                                'approved',
                                'rejected',
                                'declined',
                                'withdrawn'
                            )),
    state_history           JSONB       NOT NULL DEFAULT '[]',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_swap_request_tenant_state ON swap_request(tenant_id, state);

-- updated_at triggers -------------------------------------------------------

CREATE TRIGGER trg_availability_updated_at
    BEFORE UPDATE ON availability
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assignment_updated_at
    BEFORE UPDATE ON assignment
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_rule_updated_at
    BEFORE UPDATE ON rule
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_rule_override_updated_at
    BEFORE UPDATE ON rule_override
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_swap_request_updated_at
    BEFORE UPDATE ON swap_request
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
