// app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js
// Lowdefy custom request: archive (soft-delete) a soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual UPDATE soldier SET status='archived' (with the
// historical-membership-preservation rule per D-08 + schedule_audit emission)
// lands in plan 02-06.

async function ArchiveSoldier({ request, connection }) {
  const { soldier_id } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('ArchiveSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('ArchiveSoldier: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  // eslint-disable-next-line no-unused-vars
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  if (!soldier_id) {
    throw new Error('ArchiveSoldier: soldier_id is required');
  }

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full SQL implementation lands in plan 02-06.
    return {
      success: true,
      todo: 'plan-02-06',
      _stub_inputs: { soldier_id },
    };
  } finally {
    await db.destroy();
  }
}

ArchiveSoldier.schema = {
  type: 'object',
  required: ['soldier_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
  },
};
ArchiveSoldier.connectionType = 'Knex';

export default ArchiveSoldier;
