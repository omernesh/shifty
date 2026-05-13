// app/plugins/shifty-roster/src/connections/requests/UpdateSoldier.js
// Lowdefy custom request: update an existing soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual UPDATE (with manager-only notes gate + canonicalize +
// schedule_audit emission) lands in plan 02-06.

import { canonicalizeText } from '../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../helpers/role-tag.js';

async function UpdateSoldier({ request, connection }) {
  const { soldier_id, display_name, seniority, role_tags, phone_e164, notes, status, color } =
    request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('UpdateSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('UpdateSoldier: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  // eslint-disable-next-line no-unused-vars
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  if (!soldier_id) {
    throw new Error('UpdateSoldier: soldier_id is required');
  }

  // Canonicalize incoming fields even in the stub — proves chain works.
  // eslint-disable-next-line no-unused-vars
  const canonical_display_name = display_name != null ? canonicalizeText(display_name) : undefined;
  // eslint-disable-next-line no-unused-vars
  const canonical_role_tags = Array.isArray(role_tags)
    ? role_tags.map(canonicalizeRoleTag).filter(Boolean)
    : undefined;

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full SQL implementation lands in plan 02-06.
    return {
      success: true,
      todo: 'plan-02-06',
      _stub_inputs: { soldier_id, seniority, phone_e164, notes, status, color },
    };
  } finally {
    await db.destroy();
  }
}

UpdateSoldier.schema = {
  type: 'object',
  required: ['soldier_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    display_name: { type: 'string', minLength: 1 },
    seniority: { type: 'integer', minimum: 0, maximum: 10 },
    role_tags: { type: 'array', items: { type: 'string' } },
    phone_e164: { type: 'string' },
    notes: { type: 'string' },
    status: { enum: ['active', 'archived'] },
    color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
  },
};
UpdateSoldier.connectionType = 'Knex';

export default UpdateSoldier;
