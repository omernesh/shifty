// app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js
// Lowdefy custom request: writes one row to schedule_audit.
// Per D-08 (T-02-01): actor_user_id comes from session (request.user), NEVER from request.properties.
// Throws hard if request.user is absent — unauthenticated callers must not produce audit rows.
//
// knex is imported dynamically inside the function body so that unit tests (which test
// only the guard clauses) can import this module without requiring 'knex' to be installed
// in the test environment. In the Lowdefy Docker image, knex is available via
// @lowdefy/connection-knex which peer-depends on knex.

async function AuditWrite({ request, connection }) {
  const { planning_window_id, from_state, to_state, actor_kind, payload_json } = request.properties || {};
  const actor_user_id = request.user?.user_id;

  // T-02-01 mitigation: actor identity from session only — reject unauthenticated calls
  // These guards run BEFORE any DB interaction (no knex import needed at this point).
  if (!actor_user_id) {
    throw new Error('AuditWrite: actor_user_id missing from session — unauthenticated request');
  }
  if (!to_state) {
    throw new Error('AuditWrite: to_state is required');
  }

  // Dynamic import: allows unit tests to exercise guard clauses without needing knex installed.
  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    await db('schedule_audit').insert({
      tenant_id: request.user.tenant_id,
      planning_window_id: planning_window_id || null,
      from_state: from_state || null,
      to_state,
      actor_user_id,
      actor_kind: actor_kind || 'user',
      payload: payload_json ? JSON.stringify(payload_json) : null,
    });
    return { success: true };
  } finally {
    await db.destroy();
  }
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

export default AuditWrite;
