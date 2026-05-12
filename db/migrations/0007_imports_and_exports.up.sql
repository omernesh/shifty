-- 0007_imports_and_exports.sql -- roster_import_log (append-only Phase 2 consumer)
-- Builds on 0005 (app_user). No RLS preamble — DDL only.
-- roster_import_log is append-only: NO updated_at column (0010 REVOKEs UPDATE/DELETE/TRUNCATE).
-- Composite (tenant_id, ...) indexes per PERF-04.

BEGIN;

-- roster_import_log --------------------------------------------------------
-- Append-only log of each roster import operation (CSV/sheet/etc).
-- Phase 2 consumer for the soldier import flow; provisioned now so 0010 can REVOKE on it.
-- NO updated_at: each import event is a complete immutable record.
CREATE TABLE roster_import_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    imported_by     UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    source          TEXT        NOT NULL,
    rows_created    INTEGER     NOT NULL DEFAULT 0,
    rows_skipped    INTEGER     NOT NULL DEFAULT 0,
    rows_errored    INTEGER     NOT NULL DEFAULT 0,
    error_details   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- NO updated_at: append-only; 0010 REVOKEs UPDATE/DELETE/TRUNCATE
);

CREATE INDEX idx_roster_import_log_tenant ON roster_import_log(tenant_id);
CREATE INDEX idx_roster_import_log_actor  ON roster_import_log(imported_by);

-- No triggers: roster_import_log has no updated_at column

COMMIT;
