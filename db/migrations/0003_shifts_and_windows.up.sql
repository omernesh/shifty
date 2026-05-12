-- 0003_shifts_and_windows.sql -- shift slot templates, planning windows, and the shift_instance cross-product
-- Builds on 0002 (tenant, org_unit). No RLS preamble — DDL only, no DML.
-- shift_slot.name uses COLLATE "he-x-icu" per I18N-07.
-- Composite (tenant_id, ...) indexes per PERF-04.
-- NOTE: shift_slot has NO CHECK (end_time > start_time) — slots may cross midnight (SHFT-01).

BEGIN;

-- shift_slot ---------------------------------------------------------------
-- Recurring shift template for a team. Defines the "shape" of one shift type.
CREATE TABLE shift_slot (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id             UUID        NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    name                TEXT        COLLATE "he-x-icu" NOT NULL,
    start_time          TIME        NOT NULL,
    end_time            TIME        NOT NULL,
    headcount           SMALLINT    NOT NULL DEFAULT 1 CHECK (headcount >= 1),
    required_role_tags  TEXT[]      NOT NULL DEFAULT '{}',
    min_seniority       SMALLINT,
    display_order       SMALLINT    NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    -- No CHECK (end_time > start_time): shift slots may cross midnight (SHFT-01)
);

CREATE INDEX idx_shift_slot_tenant ON shift_slot(tenant_id);
CREATE INDEX idx_shift_slot_team   ON shift_slot(team_id);

-- planning_window -----------------------------------------------------------
-- A date range representing one scheduling cycle for a team.
CREATE TABLE planning_window (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id             UUID        NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    start_date          DATE        NOT NULL,
    end_date            DATE        NOT NULL CHECK (end_date >= start_date),
    constraint_lock_at  TIMESTAMPTZ NOT NULL,
    state               TEXT        NOT NULL DEFAULT 'open'
                        CHECK (state IN ('open', 'draft', 'published', 'closed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_planning_window_tenant       ON planning_window(tenant_id);
CREATE INDEX idx_planning_window_tenant_state ON planning_window(tenant_id, state);

-- shift_instance ------------------------------------------------------------
-- Cross-product of (shift_slot, date) within a planning window.
-- Immutable after creation — no updated_at column.
-- headcount_index >= 1 means the slot needs multiple soldiers on that date.
CREATE TABLE shift_instance (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    shift_slot_id       UUID        NOT NULL REFERENCES shift_slot(id) ON DELETE CASCADE,
    planning_window_id  UUID        NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    date                DATE        NOT NULL,
    headcount_index     SMALLINT    NOT NULL DEFAULT 0,
    UNIQUE (shift_slot_id, date, headcount_index)
);

CREATE INDEX idx_shift_instance_tenant ON shift_instance(tenant_id);
CREATE INDEX idx_shift_instance_window ON shift_instance(planning_window_id);
CREATE INDEX idx_shift_instance_date   ON shift_instance(date);

-- updated_at triggers -------------------------------------------------------
-- shift_instance has no updated_at (immutable cross-product row)

CREATE TRIGGER trg_shift_slot_updated_at
    BEFORE UPDATE ON shift_slot
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_planning_window_updated_at
    BEFORE UPDATE ON planning_window
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
