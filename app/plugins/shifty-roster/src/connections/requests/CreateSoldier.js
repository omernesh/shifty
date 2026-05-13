// app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js
// Lowdefy custom request: create a single soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual INSERT (with pickNextColor + role_tag validation +
// schedule_audit emission) lands in plan 02-06. This stub canonicalizes
// display_name through the helper chain to prove the wiring works.

import { canonicalizeText } from '../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../helpers/role-tag.js';
import { pickNextColor, PALETTE } from '../../helpers/palette.js';

async function CreateSoldier({ request, connection }) {
  const { display_name, seniority, role_tags, email, phone_e164, notes, team_id } =
    request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CreateSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CreateSoldier: actor_user_id missing from session — unauthenticated request');
  }
  // Caller context for downstream Layer-4 scope checks (plan 02-06 / 02-07).
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  // eslint-disable-next-line no-unused-vars
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  // Property guards — REQUIRED only.
  if (!display_name) {
    throw new Error('CreateSoldier: display_name is required');
  }

  // Canonicalize at the API boundary — prove the helper chain is wired up.
  const canonical_display_name = canonicalizeText(display_name);
  // Touch role-tag canonicalizer + palette so the stub exercises every helper import.
  const canonical_role_tags = Array.isArray(role_tags)
    ? role_tags.map(canonicalizeRoleTag).filter(Boolean)
    : [];
  // eslint-disable-next-line no-unused-vars
  const _palette_size = PALETTE.length;
  // eslint-disable-next-line no-unused-vars
  const _next_color_preview = pickNextColor(-1);

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full SQL implementation lands in plan 02-06.
    // The shape returned here is stable — downstream YAML can rely on
    // { success, soldier: { id, display_name } }.
    return {
      success: true,
      soldier: {
        id: null,
        display_name: canonical_display_name,
        role_tags: canonical_role_tags,
      },
      // eslint-disable-next-line no-undef
      todo: 'plan-02-06',
      _stub_inputs: { email, phone_e164, notes, team_id, seniority },
    };
  } finally {
    await db.destroy();
  }
}

CreateSoldier.schema = {
  type: 'object',
  required: ['display_name'],
  properties: {
    display_name: { type: 'string', minLength: 1 },
    seniority: { type: 'integer', minimum: 0, maximum: 10 },
    role_tags: { type: 'array', items: { type: 'string' } },
    email: { type: 'string', format: 'email' },
    phone_e164: { type: 'string' },
    notes: { type: 'string' },
    team_id: { type: 'string', format: 'uuid' },
  },
};
CreateSoldier.connectionType = 'Knex';

export default CreateSoldier;
