// app/plugins/shifty-plugin/src/connections/Knex/requests/DeletePlanningWindow.js
// Lowdefy custom request: hard-delete a planning_window. Conservatively gated:
//   state = 'open'  AND  zero availability rows.
//
// Tenant ID from request.user (session) — NEVER from request.properties.
//
// Implementation (Plan 03-04 Task 1):
// - Guards: tenant_id, actor_user_id, role guard (unit_admin OR team_manager).
// - Required: planning_window_id.
// - Inside withTenantTx:
//   1. SELECT pw row by id+tenant — also drives team_id scope check + audit pre-image.
//   2. Refuse if state !== 'open' with the Hebrew-keyed discriminator
//      'planning_window_not_open' (YAML toast maps this to a Hebrew string).
//   3. Layer-4 scope check on pw.team_id.
//   4. SELECT count(*) FROM availability WHERE planning_window_id — refuse with
//      'planning_window_has_availability' when > 0.
//   5. AUDIT FIRST (to_state='planning_window_deleted', payload contains pre-image)
//      so the trail survives the DELETE.
//   6. DELETE FROM planning_window WHERE id AND tenant_id —
//      shift_instance is wiped via FK CASCADE; availability count was already 0.

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function DeletePlanningWindow({ request, connection }) {
  const { planning_window_id } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('DeletePlanningWindow: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('DeletePlanningWindow: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('DeletePlanningWindow: requires unit_admin or team_manager role');
  }

  if (!planning_window_id) {
    throw new Error('DeletePlanningWindow: planning_window_id is required');
  }

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // 1. Load pre-image.
    const existing = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id })
      .first();
    if (!existing) {
      throw new Error('DeletePlanningWindow: planning_window not found in tenant');
    }

    // 2. State gate — only `open` windows can be deleted.
    if (existing.state !== 'open') {
      throw new Error('planning_window_not_open');
    }

    // 3. Layer-4 scope check.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: existing.team_id, role: 'team_manager' })
        .whereIn('soldier_id', function () {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) {
        throw new Error('DeletePlanningWindow: caller is not team_manager of this team');
      }
    }

    // 4. Reject when soldiers have already declared availability.
    const avCountRow = await trx('availability')
      .where({ planning_window_id, tenant_id })
      .count({ c: '*' })
      .first();
    const avCount = Number(avCountRow?.c ?? 0);
    if (avCount > 0) {
      throw new Error('planning_window_has_availability');
    }

    // 5. Audit row BEFORE the DELETE so the trail survives. The schedule_audit FK
    //    on planning_window_id has ON DELETE SET NULL (per 0012 migration); using
    //    a planning_window_id reference on the audit row is fine because the audit
    //    row's payload also captures the pre-image, which is the durable trail.
    //    We set planning_window_id explicitly so it can be queried while the row
    //    still exists; once the DELETE runs the FK will null it out.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id,
      from_state: 'planning_window_pre_delete',
      to_state: 'planning_window_deleted',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        planning_window_id,
        team_id: existing.team_id,
        pre_image: {
          start_date: existing.start_date,
          end_date: existing.end_date,
          constraint_lock_at: existing.constraint_lock_at,
          state: existing.state,
        },
      }),
    });

    // 6. DELETE — shift_instance + availability cascade (availability count is 0 here).
    const deleteRows = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id })
      .delete()
      .returning('id');
    if (!deleteRows || deleteRows.length === 0) {
      throw new Error('DeletePlanningWindow: planning_window not found in tenant (post-check)');
    }

    return { planning_window_id, team_id: existing.team_id };
  });

  return { success: true, planning_window_id: result.planning_window_id, team_id: result.team_id };
}

DeletePlanningWindow.schema = {
  type: 'object',
  required: ['planning_window_id'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
  },
};
DeletePlanningWindow.connectionType = 'Knex';
DeletePlanningWindow.meta = { checkRead: false, checkWrite: false };

export default DeletePlanningWindow;
