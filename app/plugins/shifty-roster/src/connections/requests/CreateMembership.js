// app/plugins/shifty-roster/src/connections/requests/CreateMembership.js
// Lowdefy custom request: add a soldier as a member of a team (org_unit).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual INSERT INTO membership + UPDATE org_unit.last_color_index
// (atomic, per D-15) + schedule_audit emission lands in plan 02-07.

import { pickNextColor, PALETTE } from '../../helpers/palette.js';

async function CreateMembership({ request, connection }) {
  const { soldier_id, team_id, role } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CreateMembership: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CreateMembership: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  // eslint-disable-next-line no-unused-vars
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  if (!soldier_id) {
    throw new Error('CreateMembership: soldier_id is required');
  }
  if (!team_id) {
    throw new Error('CreateMembership: team_id is required');
  }

  // Touch palette helpers — proves the import chain is wired.
  // eslint-disable-next-line no-unused-vars
  const _palette_size = PALETTE.length;
  // eslint-disable-next-line no-unused-vars
  const _next_color_preview = pickNextColor(-1);

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full SQL implementation lands in plan 02-07.
    return {
      success: true,
      todo: 'plan-02-07',
      _stub_inputs: { soldier_id, team_id, role: role || 'member' },
    };
  } finally {
    await db.destroy();
  }
}

CreateMembership.schema = {
  type: 'object',
  required: ['soldier_id', 'team_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    team_id: { type: 'string', format: 'uuid' },
    role: { enum: ['member', 'team_manager', 'unit_admin', 'viewer'] },
  },
};
CreateMembership.connectionType = 'Knex';

export default CreateMembership;
