-- 0010_audit_revokes.up.sql -- enforce append-only on audit + immutable tables (SEC-07)
-- The `shifts` role can INSERT but not UPDATE/DELETE/TRUNCATE on append-only tables.
-- notification_log allows UPDATE (status transitions: queued -> sent -> delivered) but
-- no DELETE/TRUNCATE (SEC-07 partial: logged state changes preserved).
-- invite_code_redemption is append-only by design (audit trail for invite usage).
--
-- Applies after 0009 so RLS is already active; REVOKE adds a second enforcement layer.
-- Idempotent: REVOKE on already-revoked privileges is a no-op in Postgres.

BEGIN;

-- schedule_audit: append-only — system of record for shift mutations; any mutation
-- would destroy audit integrity (T-03-09 mitigation)
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifts;

-- roster_import_log: append-only — import event log; Phase 2 consumer (roster_import)
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifts;

-- invite_code_redemption: append-only — audit trail for invite code usage (AUTH-05)
REVOKE UPDATE, DELETE, TRUNCATE ON invite_code_redemption FROM shifts;

-- notification_log: UPDATE allowed (status transitions via webhook callbacks);
-- DELETE and TRUNCATE revoked to preserve delivery audit (SEC-07 partial)
REVOKE DELETE, TRUNCATE ON notification_log FROM shifts;

COMMIT;
