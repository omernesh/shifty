// app/plugins/shifty-plugin/src/connections/Knex/requests/UpdateShiftSlot.js
// Lowdefy custom request: update an existing shift_slot row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Mirrors CreateShiftSlot.js / UpdateSoldier.js patterns. RESEARCH Recipe 2 notes
// the UPDATE variant: same Layer-4 scope check + tenant_id-bound WHERE clause
// (RESEARCH Risk R-03-2: every UPDATE/DELETE MUST explicitly scope on tenant_id
// even though RLS Layer 5 backstops).
//
// Implementation (Plan 03-03 Task 1):
// - Destructure shift_slot_id + the same property set CreateShiftSlot accepts; every
//   field is OPTIONAL except shift_slot_id (partial updates).
// - canonicalizeText(name) only when name is supplied.
// - Layer-4 manager scope check (membership-join) for non-admin callers.
// - UPDATE WHERE id = :shift_slot_id AND tenant_id = :tenant_id. Zero rows returned
//   => "shift_slot not found in tenant" (covers cross-team forgery + already-deleted).
// - schedule_audit (to_state='shift_slot_updated').

import { canonicalizeText } from '../../../helpers/canonicalize.js';
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function UpdateShiftSlot({ request, connection }) {
  const {
    shift_slot_id,
    name,
    start_time,
    end_time,
    headcount,
    required_role_tags,
    min_seniority,
    display_order,
  } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('UpdateShiftSlot: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('UpdateShiftSlot: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('UpdateShiftSlot: requires unit_admin or team_manager role');
  }

  if (!shift_slot_id) {
    throw new Error('UpdateShiftSlot: shift_slot_id is required');
  }

  if (
    start_time !== undefined && end_time !== undefined &&
    start_time === end_time
  ) {
    throw new Error('UpdateShiftSlot: start_time must differ from end_time');
  }

  if (headcount !== undefined && (!Number.isInteger(headcount) || headcount < 1)) {
    throw new Error('UpdateShiftSlot: headcount must be an integer >= 1');
  }

  if (required_role_tags !== undefined && !Array.isArray(required_role_tags)) {
    throw new Error('UpdateShiftSlot: required_role_tags must be an array');
  }

  const canonicalName = name != null ? canonicalizeText(name) : undefined;
  if (canonicalName !== undefined && canonicalName === '') {
    throw new Error('UpdateShiftSlot: name canonicalized to empty string');
  }

  const cleanedRoleTags = Array.isArray(required_role_tags)
    ? Array.from(new Set(required_role_tags.map((t) => String(t).trim()).filter(Boolean)))
    : undefined;

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Load the existing row first so we can:
    //   (a) capture team_id for the scope check (caller never passes team_id),
    //   (b) record pre-image fields in the audit payload (from_state).
    const existing = await trx('shift_slot')
      .where({ id: shift_slot_id, tenant_id })
      .first();
    if (!existing) {
      throw new Error('UpdateShiftSlot: shift_slot not found in tenant');
    }

    // Layer-4 scope check: non-admin manager must own this team.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: existing.team_id, role: 'team_manager' })
        .whereIn('soldier_id', function () {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) {
        throw new Error('UpdateShiftSlot: caller is not team_manager of this team');
      }
    }

    // Build update payload — only include fields the caller supplied.
    const patch = { updated_at: trx.fn.now() };
    if (canonicalName !== undefined) patch.name = canonicalName;
    if (start_time !== undefined) patch.start_time = start_time;
    if (end_time !== undefined) patch.end_time = end_time;
    if (headcount !== undefined) patch.headcount = headcount;
    if (cleanedRoleTags !== undefined) patch.required_role_tags = cleanedRoleTags;
    if (min_seniority !== undefined) patch.min_seniority = min_seniority;
    if (display_order !== undefined && display_order !== null) patch.display_order = display_order;

    // tenant_id MUST be in the WHERE — RESEARCH Risk R-03-2 mitigation.
    const updateRows = await trx('shift_slot')
      .where({ id: shift_slot_id, tenant_id })
      .update(patch)
      .returning('id');
    if (!updateRows || updateRows.length === 0) {
      throw new Error('UpdateShiftSlot: shift_slot not found in tenant (post-check)');
    }

    // Audit row — from_state captures pre-image, to_state='shift_slot_updated'.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: 'shift_slot_pre_update',
      to_state: 'shift_slot_updated',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        shift_slot_id,
        team_id: existing.team_id,
        from: {
          name: existing.name,
          start_time: existing.start_time,
          end_time: existing.end_time,
          headcount: existing.headcount,
          required_role_tags: existing.required_role_tags,
          min_seniority: existing.min_seniority,
          display_order: existing.display_order,
        },
        to: {
          name: canonicalName,
          start_time,
          end_time,
          headcount,
          required_role_tags: cleanedRoleTags,
          min_seniority,
          display_order,
        },
      }),
    });

    return { shift_slot_id };
  });

  return { success: true, shift_slot_id: result.shift_slot_id };
}

UpdateShiftSlot.schema = {
  type: 'object',
  required: ['shift_slot_id'],
  properties: {
    shift_slot_id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1 },
    start_time: { type: 'string' },
    end_time: { type: 'string' },
    headcount: { type: 'integer', minimum: 1 },
    required_role_tags: { type: 'array', items: { type: 'string' } },
    min_seniority: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
    display_order: { type: ['integer', 'null'] },
  },
};
UpdateShiftSlot.connectionType = 'Knex';
UpdateShiftSlot.meta = { checkRead: false, checkWrite: false };

export default UpdateShiftSlot;
