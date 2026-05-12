-- 0006_audit_and_solver_runs.sql -- schedule_audit (append-only target for 0010), solver_run, notification_log
-- Builds on 0005 (app_user). No RLS preamble — DDL only.
-- schedule_audit and solver_run are append-only: NO updated_at column.
-- notification_log has updated_at: status transitions allowed (0010 only REVOKEs DELETE + TRUNCATE).
-- Composite (tenant_id, ...) indexes per PERF-04.

BEGIN;

-- schedule_audit ------------------------------------------------------------
-- Append-only audit trail for planning_window state transitions.
-- NO updated_at column — this table is append-only (0010 REVOKEs UPDATE/DELETE/TRUNCATE).
-- Actor MUST come from server-side session (enforced in AuditWrite plugin, D-08).
CREATE TABLE schedule_audit (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    planning_window_id  UUID        REFERENCES planning_window(id) ON DELETE SET NULL,
    from_state          TEXT,
    to_state            TEXT        NOT NULL,
    actor_user_id       UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    actor_kind          TEXT        NOT NULL
                        CHECK (actor_kind IN ('user', 'system', 'solver')),
    payload             JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    -- NO updated_at: append-only table; 0010 REVOKEs UPDATE/DELETE/TRUNCATE
);

CREATE INDEX idx_schedule_audit_tenant ON schedule_audit(tenant_id);
CREATE INDEX idx_schedule_audit_window ON schedule_audit(planning_window_id);
CREATE INDEX idx_schedule_audit_actor  ON schedule_audit(actor_user_id);

-- solver_run ----------------------------------------------------------------
-- One row per CP-SAT solver execution. Immutable after creation — no updated_at.
CREATE TABLE solver_run (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    planning_window_id  UUID        NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    status              TEXT        NOT NULL
                        CHECK (status IN ('optimal', 'feasible', 'infeasible', 'error', 'timeout')),
    solve_time_seconds  NUMERIC(10,3),
    request_payload     JSONB       NOT NULL,
    response_payload    JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    -- NO updated_at: each solver run is a complete immutable record
);

CREATE INDEX idx_solver_run_tenant ON solver_run(tenant_id);
CREATE INDEX idx_solver_run_window ON solver_run(planning_window_id);

-- notification_log ----------------------------------------------------------
-- Delivery log for notifications. Has updated_at for status transitions
-- (queued→sent→delivered, etc.). 0010 REVOKEs DELETE + TRUNCATE but NOT UPDATE.
CREATE TABLE notification_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id             UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    event_type          TEXT        NOT NULL,
    channel             TEXT        NOT NULL
                        CHECK (channel IN ('email', 'whatsapp', 'push', 'in_app')),
    status              TEXT        NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')),
    provider_response   JSONB,
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_log_tenant        ON notification_log(tenant_id);
CREATE INDEX idx_notification_log_tenant_status ON notification_log(tenant_id, status);
CREATE INDEX idx_notification_log_user          ON notification_log(user_id);

-- updated_at trigger — notification_log only (schedule_audit + solver_run are append-only)

CREATE TRIGGER trg_notification_log_updated_at
    BEFORE UPDATE ON notification_log
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
