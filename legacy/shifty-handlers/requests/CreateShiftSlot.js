// app/plugins/shifty-plugin/src/connections/Knex/requests/CreateShiftSlot.js
// Lowdefy custom request: create a single shift_slot row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Layer 5 (RLS) wireup: the transaction is opened via withTenantTx, which issues
// SET LOCAL app.current_tenant before any DB activity.
//
// Mirrors CreateSoldier.js shape (Phase 02 — Plan 02-06 Task 1) and RESEARCH Recipe 2.
//
// Implementation (Plan 03-03 Task 1):
// 1. Guards: tenant_id, actor_user_id, role guard (unit_admin OR team_manager).
// 2. Payload validation: team_id/name/start_time/end_time required; start_time !== end_time;
//    headcount >= 1; required_role_tags must be an array.
// 3. canonicalizeText(name) BEFORE INSERT (D-12 / ROST-11 / Pitfall P2 — same defense
//    applied to roster names is applied here so smart-quote U+2019 + bidi marks never
//    persist on shift_slot.name either).
// 4. Cleaned role_tags = Set( trim + filter(Boolean) ) — defensive dedup. We do NOT
//    re-canonicalize each tag via canonicalizeRoleTag here; per CONTEXT D-13 the
//    dedicated role-tag flow owns canonicalization.
// 5. Layer-4 manager scope check (RESEARCH Recipe 2): non-admin caller must have
//    membership.role='team_manager' on this org_unit. Implemented via SELECT against
//    membership JOIN soldier (the caller's soldier row is the one with user_id = actor).
// 6. display_order auto-resolved to max(existing)+1 when caller does not supply.
// 7. INSERT shift_slot.
// 8. schedule_audit row in the SAME TX (to_state='shift_slot_created').

import { canonicalizeText } from '../../../helpers/canonicalize.js';
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function CreateShiftSlot({ request, connection }) {
  const {
    team_id,
    name,
    start_time,
    end_time,
    headcount = 1,
    required_role_tags = [],
    min_seniority = null,
    display_order = null,
  } = request.properties || {};

  // Layer-4 tenant / actor guards (BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CreateShiftSlot: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CreateShiftSlot: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('CreateShiftSlot: requires unit_admin or team_manager role');
  }

  // Payload guards.
  if (!team_id) throw new Error('CreateShiftSlot: team_id is required');
  if (!name) throw new Error('CreateShiftSlot: name is required');
  if (!start_time || !end_time) throw new Error('CreateShiftSlot: start_time and end_time are required');
  if (start_time === end_time) {
    throw new Error('CreateShiftSlot: start_time must differ from end_time');
  }
  if (!Number.isInteger(headcount) || headcount < 1) {
    throw new Error('CreateShiftSlot: headcount must be an integer >= 1');
  }
  if (!Array.isArray(required_role_tags)) {
    throw new Error('CreateShiftSlot: required_role_tags must be an array');
  }

  const canonicalName = canonicalizeText(name);
  if (!canonicalName) {
    throw new Error('CreateShiftSlot: name canonicalized to empty string');
  }

  // Defensive dedup (trim + filter blanks + uniq); per D-13 we do NOT canonicalize the
  // tag keys themselves — the dedicated role-tag flow owns that.
  const cleanedRoleTags = Array.from(
    new Set(required_role_tags.map((t) => String(t).trim()).filter(Boolean))
  );

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Layer-4 scope check: non-admin manager must own this team via
    // membership.role='team_manager'. RESEARCH Recipe 2 membership-join pattern.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: team_id, role: 'team_manager' })
        .whereIn('soldier_id', function () {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) {
        throw new Error('CreateShiftSlot: caller is not team_manager of this team');
      }
    }

    // Auto-resolve display_order when caller passes null/undefined: next-after-max.
    let order = display_order;
    if (order === null || order === undefined) {
      const maxRow = await trx('shift_slot')
        .where({ tenant_id, team_id })
        .max({ m: 'display_order' })
        .first();
      order = (maxRow?.m ?? -1) + 1;
    }

    // INSERT.
    const ins = await trx('shift_slot')
      .insert({
        tenant_id,
        team_id,
        name: canonicalName,
        start_time,
        end_time,
        headcount,
        required_role_tags: cleanedRoleTags, // pg TEXT[] — knex passes through
        min_seniority,
        display_order: order,
      })
      .returning('id');
    const shift_slot_id = ins[0]?.id ?? ins[0];

    // Audit row in same TX.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: null,
      to_state: 'shift_slot_created',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        shift_slot_id,
        team_id,
        name: canonicalName,
        start_time,
        end_time,
        headcount,
        required_role_tags: cleanedRoleTags,
        min_seniority,
        display_order: order,
      }),
    });

    return { shift_slot_id, display_order: order };
  });

  return {
    success: true,
    shift_slot: {
      id: result.shift_slot_id,
      name: canonicalName,
      start_time,
      end_time,
      headcount,
      required_role_tags: cleanedRoleTags,
      min_seniority,
      display_order: result.display_order,
    },
  };
}

CreateShiftSlot.schema = {
  type: 'object',
  required: ['team_id', 'name', 'start_time', 'end_time'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1 },
    start_time: { type: 'string' }, // HH:MM (Postgres TIME accepts HH:MM or HH:MM:SS)
    end_time: { type: 'string' },
    headcount: { type: 'integer', minimum: 1 },
    required_role_tags: { type: 'array', items: { type: 'string' } },
    min_seniority: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
    display_order: { type: ['integer', 'null'] },
  },
};
CreateShiftSlot.connectionType = 'Knex';
// meta required by @lowdefy/api 5.3 (Phase 02-11 hotfix; match upstream KnexRaw/KnexBuilder).
CreateShiftSlot.meta = { checkRead: false, checkWrite: false };

export default CreateShiftSlot;
