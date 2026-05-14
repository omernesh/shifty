// app/plugins/shifty-roster/src/connections/requests/CreateMembership.js
// Lowdefy custom request: add a soldier as a member of a team (org_unit).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Layer 5 (RLS) wireup: the transaction is opened via withTenantTx, which issues
// SET LOCAL app.current_tenant before any DB activity.
//
// knex is loaded indirectly via withTenantTx (dynamic import). Unit tests that exercise
// only the guard clauses can still import this module without knex installed.
//
// Implementation (Plan 02-07 Task 1, replaces plan 02-02 stub):
// 1. Layer-4 caller-scope check: caller_team_ids must include team_id unless unit_admin.
// 2. SELECT-driven INSERT (RESEARCH §"Membership — Constraints" safe form): the row is
//    emitted ONLY when BOTH the soldier and the org_unit live in the same tenant.
//    `s.tenant_id` is taken from the database row (not from payload) for the INSERT,
//    so a forged caller_team_ids array still cannot land a cross-tenant membership.
// 3. ON CONFLICT (soldier_id, org_unit_id) DO NOTHING → idempotent on retry; the
//    distinguishing `already_member` post-check tells the UI whether the no-op was
//    "already there" (success) or "soldier/team not in tenant" (error).
// 4. No round-robin color bump on membership-add (D-15 line 3: "soldier keeps their
//    current color (no recolor on team-add)"). CreateSoldier (plan 02-06) is the only
//    write path that touches org_unit.last_color_index — Phase 2 scope.
// 5. schedule_audit row to_state='membership_added'.

import { canonicalizeRoleTag } from '../../helpers/role-tag.js'; // eslint-disable-line no-unused-vars
import { pickNextColor, PALETTE } from '../../helpers/palette.js'; // eslint-disable-line no-unused-vars
import { withTenantTx } from 'shifty-auth/hooks/with-tenant-tx';

async function CreateMembership({ request, connection }) {
  const { soldier_id, team_id, role } = request.properties || {};

  // Layer-4 tenant / actor guards (run BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CreateMembership: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CreateMembership: actor_user_id missing from session — unauthenticated request');
  }
  const caller_team_ids = request.user?.team_ids || [];
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');

  if (!soldier_id) {
    throw new Error('CreateMembership: soldier_id is required');
  }
  if (!team_id) {
    throw new Error('CreateMembership: team_id is required');
  }

  // Schema default 'member' covers any optional/null role passed from the page.
  const effectiveRole = role || 'member';
  const ALLOWED_ROLES = new Set(['unit_admin', 'team_manager', 'member', 'viewer']);
  if (!ALLOWED_ROLES.has(effectiveRole)) {
    throw new Error(`CreateMembership: invalid role '${effectiveRole}'`);
  }

  // Layer-4 scope: only admins or managers whose caller_team_ids includes this team
  // may add a member to it. T-02-06 mitigation — the SQL gate `(:is_admin OR
  // :team_id = ANY(:caller_team_ids))` lives only in YAML KnexRaw flows; here we
  // mirror it in JS so the plugin handler is independently safe.
  const canWrite = is_admin || caller_team_ids.includes(team_id);
  if (!canWrite) {
    throw new Error('CreateMembership: access denied — team not in caller scope');
  }

  return await withTenantTx(connection, tenant_id, async (trx) => {
    // Step 1: SELECT-driven safe INSERT. Emits a row only when soldier AND org_unit
    // both live in `tenant_id`. ON CONFLICT keeps the call idempotent on retry.
    // `s.status = 'active'` blocks adding archived soldiers (ROST-05).
    const insertRes = await trx.raw(
      `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
       SELECT s.tenant_id, s.id, ou.id, :role
         FROM soldier s, org_unit ou
        WHERE s.id = :soldier_id
          AND ou.id = :team_id
          AND s.tenant_id = :tenant_id
          AND ou.tenant_id = :tenant_id
          AND s.status = 'active'
       ON CONFLICT (soldier_id, org_unit_id) DO NOTHING
       RETURNING id, tenant_id, soldier_id, org_unit_id`,
      { role: effectiveRole, soldier_id, team_id, tenant_id }
    );

    const rows = insertRes?.rows || [];

    if (rows.length === 0) {
      // Distinguish "already a member" (idempotent success) from "soldier or team
      // not found in tenant scope" (real error). One extra round-trip; cheap.
      const existsRes = await trx.raw(
        `SELECT EXISTS (
           SELECT 1 FROM membership
            WHERE soldier_id = :soldier_id
              AND org_unit_id = :team_id
              AND tenant_id = :tenant_id
         ) AS already_member`,
        { soldier_id, team_id, tenant_id }
      );
      const already_member = existsRes?.rows?.[0]?.already_member === true;
      if (already_member) {
        // Idempotent no-op: do NOT write an audit row for a no-op retry.
        return { success: true, already_member: true, membership_id: null };
      }
      throw new Error('CreateMembership: soldier or team not found in tenant scope');
    }

    const newRow = rows[0];

    // Step 2: schedule_audit row (matches shifty-audit-writer payload shape).
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: null,
      to_state: 'membership_added',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        membership_id: newRow.id,
        soldier_id: newRow.soldier_id,
        team_id: newRow.org_unit_id,
        role: effectiveRole,
      }),
    });

    return {
      success: true,
      already_member: false,
      membership_id: newRow.id,
    };
  });
}

CreateMembership.schema = {
  type: 'object',
  required: ['soldier_id', 'team_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    team_id: { type: 'string', format: 'uuid' },
    role: {
      type: 'string',
      enum: ['unit_admin', 'team_manager', 'member', 'viewer'],
      default: 'member',
    },
  },
};
CreateMembership.connectionType = 'Knex';

export default CreateMembership;
