-- 0001_init.sql -- initial schema for shifts-manager v1
-- Single-tenant. Add tenant_id later if multi-tenant becomes a real need.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- employees ----------------------------------------------------------------
CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    email           TEXT        UNIQUE,
    phone           TEXT,
    role            TEXT,
    employment_type TEXT        CHECK (employment_type IN ('full-time','part-time','casual')),
    hourly_rate     NUMERIC(8,2),
    max_weekly_hrs  INTEGER     NOT NULL DEFAULT 40 CHECK (max_weekly_hrs >= 0),
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_active ON employees(active) WHERE active = TRUE;

-- shifts -------------------------------------------------------------------
-- Concrete shifts to be staffed (not recurring templates).
CREATE TABLE shifts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
    role_required   TEXT,
    min_staff       INTEGER     NOT NULL DEFAULT 1 CHECK (min_staff >= 0),
    max_staff       INTEGER     NOT NULL DEFAULT 1 CHECK (max_staff >= min_staff),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_starts_at ON shifts(starts_at);
CREATE INDEX idx_shifts_role      ON shifts(role_required) WHERE role_required IS NOT NULL;

-- assignments --------------------------------------------------------------
CREATE TABLE assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES shifts(id)    ON DELETE CASCADE,
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    status          TEXT        NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','confirmed','cancelled','no_show','completed')),
    assigned_by     TEXT,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes           TEXT,
    UNIQUE (shift_id, employee_id)
);

CREATE INDEX idx_assignments_shift    ON assignments(shift_id);
CREATE INDEX idx_assignments_employee ON assignments(employee_id);
CREATE INDEX idx_assignments_status   ON assignments(status);

-- availability -------------------------------------------------------------
-- Employee's recurring weekly availability. day_of_week 0=Sunday..6=Saturday.
CREATE TABLE availability (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day_of_week     INTEGER     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    starts_at       TIME        NOT NULL,
    ends_at         TIME        NOT NULL CHECK (ends_at > starts_at),
    kind            TEXT        NOT NULL DEFAULT 'available'
                    CHECK (kind IN ('available','preferred','unavailable')),
    notes           TEXT
);

CREATE INDEX idx_availability_employee ON availability(employee_id);

-- time_clock_entries -------------------------------------------------------
CREATE TABLE time_clock_entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    shift_id        UUID        REFERENCES shifts(id) ON DELETE SET NULL,
    clock_in        TIMESTAMPTZ NOT NULL,
    clock_out       TIMESTAMPTZ CHECK (clock_out IS NULL OR clock_out > clock_in),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_time_clock_employee ON time_clock_entries(employee_id);
CREATE INDEX idx_time_clock_shift    ON time_clock_entries(shift_id)    WHERE shift_id IS NOT NULL;
CREATE INDEX idx_time_clock_open     ON time_clock_entries(employee_id) WHERE clock_out IS NULL;

-- updated_at trigger for employees ----------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
