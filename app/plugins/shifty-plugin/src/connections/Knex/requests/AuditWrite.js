// app/plugins/shifty-plugin/src/connections/Knex/requests/AuditWrite.js
// Lowdefy custom request: writes one row to schedule_audit.
// Per D-08 (T-02-01): actor_user_id comes from session (request.user), NEVER from request.properties.
// Throws hard if request.user is absent — unauthenticated callers must not produce audit rows.
//
// Layer 5 (RLS) wireup: runs inside withTenantTx so app.current_tenant is SET LOCAL to
// request.user.tenant_id before the INSERT. RLS USING/WITH CHECK on schedule_audit blocks
// any cross-tenant insert at the database level (defense-in-depth on top of Layer 4).
//
// knex is loaded indirectly via withTenantTx (which does the dynamic import). Unit tests
// that exercise only the guard clauses can still import this module without knex installed,
// because withTenantTx is only invoked AFTER the guards pass.

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function AuditWrite({ request, connection }) {
  const { planning_window_id, from_state, to_state, actor_kind, payload_json } = request.properties || {};
  const actor_user_id = request.user?.user_id;
  const tenant_id = request.user?.tenant_id;

  // T-02-01 mitigation: actor identity from session only — reject unauthenticated calls.
  // These guards run BEFORE any DB interaction.
  if (!actor_user_id) {
    throw new Error('AuditWrite: actor_user_id missing from session — unauthenticated request');
  }
  if (!to_state) {
    throw new Error('AuditWrite: to_state is required');
  }

  return withTenantTx(connection, tenant_id, async (trx) => {
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: planning_window_id || null,
      from_state: from_state || null,
      to_state,
      actor_user_id,
      actor_kind: actor_kind || 'user',
      payload: payload_json ? JSON.stringify(payload_json) : null,
    });
    return { success: true };
  });
}

AuditWrite.schema = {
  type: 'object',
  required: ['to_state'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
    from_state: { type: 'string' },
    to_state: { type: 'string' },
    actor_kind: { enum: ['user', 'system', 'solver'] },
    payload_json: { type: 'object' },
  },
};
AuditWrite.connectionType = 'Knex';
// meta required by @lowdefy/api 5.3 (Phase 02-11 hotfix; match upstream KnexRaw/KnexBuilder).
AuditWrite.meta = { checkRead: false, checkWrite: false };

export default AuditWrite;
