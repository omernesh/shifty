// app/plugins/shifty-plugin/src/connections/Knex/requests/KnexRawTenant.js
// Layer 5 (RLS) wrapper around @lowdefy/connection-knex's KnexRaw.
//
// Purpose:
//   Same shape and behavior as KnexRaw — accepts { query, parameters } — but executes
//   the query inside a Knex transaction with `SET LOCAL app.current_tenant = '<uuid>'`
//   issued first. The tenant_id is taken from request.user (session-derived, NEVER from
//   request.parameters). This activates Postgres RLS policies introduced in migration
//   0009 + the role split in migration 0013.
//
// YAML usage (drop-in replacement for KnexRaw on tenant-scoped queries):
//
//   - id: list_soldiers
//     type: KnexRawTenant
//     connectionId: shifts_db
//     payload:
//       tenant_id:
//         _user: tenant_id
//     properties:
//       query: |
//         SELECT id, display_name FROM soldier
//         WHERE tenant_id = :tenant_id AND status = 'active'
//       parameters:
//         tenant_id: { _payload: tenant_id }
//
// Notes on payload.tenant_id:
//   Existing YAML already populates payload.tenant_id from _user.tenant_id and binds it
//   into the SQL WHERE clause (Layer 2 defense). KnexRawTenant additionally uses
//   request.user.tenant_id to set RLS context (Layer 5). The two MUST match — if YAML
//   accidentally bound a different tenant_id into :tenant_id, the WHERE clause filters
//   to those rows but RLS would block them (Layer 5 guards Layer 2 against forgery).

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function KnexRawTenant({ request, connection }) {
  // request.parameters carries the resolved YAML payload (query, parameters, etc.)
  // — same shape as the upstream @lowdefy/connection-knex KnexRaw resolver expects.
  // request.user comes from the Lowdefy server-side session context.
  const { query, parameters } = request || {};
  if (!query || typeof query !== 'string') {
    throw new Error('KnexRawTenant: properties.query is required and must be a string');
  }
  const tenantId = request?.user?.tenant_id;
  return withTenantTx(connection, tenantId, async (trx) => {
    // Mirror upstream KnexRaw semantics: pass parameters (object or array) to trx.raw().
    const res = await trx.raw(query, parameters || {});
    // node-postgres returns { rows, rowCount, ... }; mimic the upstream shape (rows only).
    return res?.rows ?? res;
  });
}

KnexRawTenant.schema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    parameters: { type: ['object', 'array'] },
  },
};

// connectionType MUST match the connection's type in YAML; the connections use type: Knex
// (defined by @lowdefy/connection-knex). KnexRawTenant rides the same connection schema.
KnexRawTenant.connectionType = 'Knex';

// meta = { checkRead, checkWrite } is required by @lowdefy/api 5.3's checkConnectionRead /
// checkConnectionWrite (otherwise `requestResolver.meta.checkRead` throws TypeError on
// undefined). Match the upstream KnexRaw/KnexBuilder defaults — connection-level read/write
// controls are opt-in per-handler; we don't restrict here. Phase 02-11 hotfix.
KnexRawTenant.meta = { checkRead: false, checkWrite: false };

export default KnexRawTenant;
