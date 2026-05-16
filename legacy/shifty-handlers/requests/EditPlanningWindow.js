// app/plugins/shifty-plugin/src/connections/Knex/requests/EditPlanningWindow.js
// Lowdefy custom request: edit an open-state planning_window. On date-range change,
// WIPE + REGENERATE shift_instance rows (FK CASCADE on availability transitively wipes
// soldier availability) — RESEARCH Pitfall 6 accepted simple alternative.
//
// Tenant ID from request.user (session) — NEVER from request.properties.
//
// Implementation (Plan 03-04 Task 1):
// - Guards: tenant_id, actor_user_id, role guard.
// - Required: planning_window_id. Optional: start_date, end_date, constraint_lock_at.
// - Inside withTenantTx:
//   1. SELECT pw row by id+tenant — capture pre-image (state + dates) for audit + check.
//   2. Refuse if state !== 'open' (Phase 03 limit — Phase 04 expands draft/published).
//   3. Layer-4 scope check on pw.team_id (non-admin manager must own the team).
//   4. If start_date OR end_date is being changed:
//      a) Validate end_date >= start_date (using the NEW value where supplied,
//         pre-image otherwise) and the resulting window length ≤ 30 days.
//      b) DELETE FROM availability WHERE planning_window_id — explicit count for audit.
//         (FK ON DELETE CASCADE from shift_instance would also wipe it, but counting
//         here makes the audit row's payload directly comparable to the count the
//         UI Modal warning showed the user before submit.)
//      c) DELETE FROM shift_instance WHERE planning_window_id — explicit count.
//      d) Pre-check: team must still have at least one shift_slot for the regen.
//      e) Re-run CROSS JOIN LATERAL INSERT…SELECT cross-product with new dates.
//      f) 3,600-row belt-and-braces check after the regen.
//   5. UPDATE planning_window SET ... WHERE id AND tenant_id (always include
//      updated_at = now()).
//   6. schedule_audit row to_state='planning_window_edited' with from/to dates,
//      wipedCount, new instance_count, and pre-image of constraint_lock_at.

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function EditPlanningWindow({ request, connection }) {
  const { planning_window_id, start_date, end_date, constraint_lock_at } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('EditPlanningWindow: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('EditPlanningWindow: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('EditPlanningWindow: requires unit_admin or team_manager role');
  }

  if (!planning_window_id) {
    throw new Error('EditPlanningWindow: planning_window_id is required');
  }

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // 1. Load pre-image.
    const existing = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id })
      .first();
    if (!existing) {
      throw new Error('EditPlanningWindow: planning_window not found in tenant');
    }

    // 2. State gate — only `open` windows are editable in Phase 03.
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
        throw new Error('EditPlanningWindow: caller is not team_manager of this team');
      }
    }

    // Helper: format Postgres DATE column to YYYY-MM-DD for comparison.
    const fmtDate = (d) => {
      if (!d) return null;
      if (typeof d === 'string') return d.slice(0, 10);
      // Date instance from pg
      const iso = new Date(d).toISOString();
      return iso.slice(0, 10);
    };
    const prevStart = fmtDate(existing.start_date);
    const prevEnd = fmtDate(existing.end_date);

    // 4. Detect date-range change.
    const nextStart = start_date !== undefined && start_date !== null ? String(start_date) : prevStart;
    const nextEnd = end_date !== undefined && end_date !== null ? String(end_date) : prevEnd;
    const dateChanged = nextStart !== prevStart || nextEnd !== prevEnd;

    let wipedAvailability = 0;
    let wipedInstances = 0;
    let regenInstanceCount = null;

    if (dateChanged) {
      // 4a. Validate the resulting date range.
      if (nextEnd < nextStart) {
        throw new Error('EditPlanningWindow: end_date < start_date');
      }
      const startMs = Date.parse(nextStart + 'T00:00:00Z');
      const endMs = Date.parse(nextEnd + 'T00:00:00Z');
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new Error('EditPlanningWindow: start_date / end_date must be ISO YYYY-MM-DD');
      }
      const dayCount = Math.round((endMs - startMs) / 86_400_000) + 1;
      if (dayCount > 30) {
        throw new Error('EditPlanningWindow: window length > 30 days');
      }

      // 4b. Wipe availability — count for audit even though CASCADE would also drop it.
      const avDel = await trx('availability')
        .where({ planning_window_id, tenant_id })
        .del();
      wipedAvailability = Number(avDel || 0);

      // 4c. Wipe shift_instance.
      const siDel = await trx('shift_instance')
        .where({ planning_window_id, tenant_id })
        .del();
      wipedInstances = Number(siDel || 0);

      // 4d. Pre-check: team must have at least one slot for the regen.
      const slotCountRow = await trx('shift_slot')
        .where({ tenant_id, team_id: existing.team_id })
        .count({ c: '*' })
        .first();
      const slotCount = Number(slotCountRow?.c ?? 0);
      if (slotCount === 0) {
        throw new Error('EditPlanningWindow: team has zero shift_slots — define slots first');
      }

      // 4e. Re-run cross-product.
      const xpInsert = await trx.raw(
        `INSERT INTO shift_instance (tenant_id, shift_slot_id, planning_window_id, date, headcount_index)
         SELECT s.tenant_id, s.id, :pw_id::uuid, d.date::date, h.idx
           FROM shift_slot s
           CROSS JOIN generate_series(:start_date::date, :end_date::date, INTERVAL '1 day') AS d(date)
           CROSS JOIN LATERAL generate_series(0, s.headcount - 1) AS h(idx)
          WHERE s.tenant_id = :tenant_id AND s.team_id = :team_id
         RETURNING id`,
        {
          pw_id: planning_window_id,
          start_date: nextStart,
          end_date: nextEnd,
          tenant_id,
          team_id: existing.team_id,
        }
      );
      const xpRows = xpInsert?.rows ?? xpInsert?.[0] ?? [];
      regenInstanceCount = Array.isArray(xpRows) ? xpRows.length : Number(xpInsert?.rowCount ?? 0);
      if (regenInstanceCount > 3600) {
        throw new Error('EditPlanningWindow: instance_count > 3600 — pathological config refused');
      }
    }

    // 5. UPDATE planning_window — only patch fields the caller supplied.
    const patch = { updated_at: trx.fn.now() };
    if (start_date !== undefined && start_date !== null) patch.start_date = start_date;
    if (end_date !== undefined && end_date !== null) patch.end_date = end_date;
    if (constraint_lock_at !== undefined && constraint_lock_at !== null) {
      patch.constraint_lock_at = constraint_lock_at;
    }
    const updateRows = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id })
      .update(patch)
      .returning('id');
    if (!updateRows || updateRows.length === 0) {
      throw new Error('EditPlanningWindow: planning_window not found in tenant (post-check)');
    }

    // 6. Audit row.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id,
      from_state: 'planning_window_pre_edit',
      to_state: 'planning_window_edited',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        team_id: existing.team_id,
        from: {
          start_date: prevStart,
          end_date: prevEnd,
          constraint_lock_at: existing.constraint_lock_at,
        },
        to: {
          start_date: nextStart,
          end_date: nextEnd,
          constraint_lock_at: constraint_lock_at ?? existing.constraint_lock_at,
        },
        date_changed: dateChanged,
        wiped_availability: wipedAvailability,
        wiped_instances: wipedInstances,
        regen_instance_count: regenInstanceCount,
      }),
    });

    return {
      planning_window_id,
      wipedAvailability,
      wipedInstances,
      regenInstanceCount,
      dateChanged,
    };
  });

  return { success: true, ...result };
}

EditPlanningWindow.schema = {
  type: 'object',
  required: ['planning_window_id'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
    start_date: { type: ['string', 'null'] },
    end_date: { type: ['string', 'null'] },
    constraint_lock_at: { type: ['string', 'null'] },
  },
};
EditPlanningWindow.connectionType = 'Knex';
EditPlanningWindow.meta = { checkRead: false, checkWrite: false };

export default EditPlanningWindow;
