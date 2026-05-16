// app/plugins/shifty-plugin/src/connections/Knex/requests/DeclareAvailability.js
// Lowdefy custom request: declare a soldier's availability for a planning window.
//
// Three modes in one handler (RESEARCH §"Recipe 5"):
//
//   1. mode='range_blockout'     — soldier marks themselves unavailable across
//                                  a continuous date range. Single INSERT…SELECT
//                                  materializes ALL affected shift_instance rows
//                                  with source='range_blockout'. ON CONFLICT
//                                  upgrade only when the existing row is at the
//                                  same or lower precedence (default | range_blockout).
//   2. mode='per_slot_toggle'    — soldier toggles availability for a single
//                                  shift_instance. UPSERT with source='per_slot';
//                                  overwrites range_blockout and default but
//                                  NEVER overwrites a manager_override row.
//   3. mode='manager_override'   — unit_admin or team_manager of the target's
//                                  team overrides a soldier's declaration. UPSERT
//                                  with source='manager_override'; ALWAYS wins.
//                                  Requires Layer-4 scope check (membership-join).
//
// Source precedence (single source of truth in SOURCE_RANK):
//   manager_override (3) > per_slot (2) > range_blockout (1) > default (0)
//
// Precedence enforcement is symmetric:
//   WRITE: ON CONFLICT WHERE clause filters which rows can be overwritten.
//   READ:  load_availability LATERAL+CASE rank ORDER BY in my_availability.yaml.
//   Both sides use SOURCE_RANK from helpers/availability-source.js (Risk R-03-3
//   mitigation; drift-detection meta-test in availability-source-precedence.spec.ts).
//
// Audit-in-same-TX:
//   schedule_audit row inserted inside the withTenantTx callback. Payload captures
//   { mode, soldier_id, was_locked, writes, shift_instance_id, range_from, range_to,
//     declared, from_source, to_source } for forensics.
//
// Layer 4 (handler) tenant defense:
//   tenant_id comes from request.user (session) — NEVER from request.properties.
//   For modes 'range_blockout' and 'per_slot_toggle', target_soldier_id is derived
//   from the actor's session via SELECT FROM soldier WHERE user_id = actor_user_id
//   (RESEARCH §"Security Domain V13" — payload soldier_id is ignored for self-write
//   modes; honoring it would let soldier A write availability as soldier B).
//   For mode 'manager_override', target_soldier_id IS taken from the payload but a
//   Layer-4 membership-join scope check confirms the actor manages the target's team.
//
// Constraint-lock guard (AVAL-06):
//   For non-manager soldier-self writes: when now() > pw.constraint_lock_at the
//   handler refuses the write. Manager writes after lock ARE allowed and produce
//   an audit row with to_state='availability_manager_override' AND was_locked=true.

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';
import { SOURCE_RANK } from '../../../helpers/availability-source.js';

async function DeclareAvailability({ request, connection }) {
  const {
    planning_window_id,
    mode,
    soldier_id,          // for manager_override; ignored for self-write modes
    range_from, range_to,
    shift_instance_id,
    declared,
  } = request.properties || {};

  // Layer-4 tenant / actor guards (BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('DeclareAvailability: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('DeclareAvailability: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');

  // Payload guards (mode + planning_window_id are mandatory for every mode).
  if (!planning_window_id) {
    throw new Error('DeclareAvailability: planning_window_id is required');
  }
  if (!['range_blockout', 'per_slot_toggle', 'manager_override'].includes(mode)) {
    throw new Error('DeclareAvailability: invalid mode (must be range_blockout|per_slot_toggle|manager_override)');
  }

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Resolve the planning_window row + lock state.
    const pw = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id })
      .first('id', 'team_id', 'start_date', 'end_date', 'state', 'constraint_lock_at');
    if (!pw) {
      throw new Error('DeclareAvailability: planning_window not found in tenant');
    }
    if (pw.state !== 'open') {
      // Phase 03 limits writes to open windows; closed/published windows are immutable.
      throw new Error('DeclareAvailability: window not in open state');
    }
    const locked = pw.constraint_lock_at
      ? new Date(pw.constraint_lock_at) <= new Date()
      : false;

    // Resolve target_soldier_id by mode.
    let target_soldier_id;
    if (mode === 'manager_override') {
      if (!is_admin && !is_manager) {
        throw new Error('DeclareAvailability: manager_override requires unit_admin or team_manager role');
      }
      if (!soldier_id) {
        throw new Error('DeclareAvailability: manager_override requires soldier_id in payload');
      }
      // Layer-4 scope check: non-admin manager must own the target soldier's team
      // via membership.role='team_manager'. Admin role bypasses this check (admins
      // manage every team in their tenant).
      if (!is_admin) {
        const own = await trx('membership')
          .where({ tenant_id, org_unit_id: pw.team_id, role: 'team_manager' })
          .whereIn('soldier_id', function () {
            this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
          })
          .first();
        if (!own) {
          throw new Error('DeclareAvailability: manager_override caller is not team_manager of target team');
        }
      }
      // Belt-and-braces: confirm the target soldier_id lives in this tenant. The
      // INSERT…SELECT FROM shift_instance already filters by tenant_id (Layer 5
      // RLS would also block), but failing fast here gives a clearer error message.
      const targetExists = await trx('soldier')
        .where({ id: soldier_id, tenant_id })
        .first('id');
      if (!targetExists) {
        throw new Error('DeclareAvailability: target soldier not found in tenant');
      }
      target_soldier_id = soldier_id;
    } else {
      // Soldier writing their own availability — derive soldier_id from session user.
      // NEVER take from request body (RESEARCH §"Security Domain V13"; T-03-18).
      // Raw form `SELECT id FROM soldier WHERE tenant_id AND user_id LIMIT 1` is the
      // load-bearing security expression — the structural verifier asserts this exact
      // pattern is present so a future refactor cannot accidentally pull soldier_id
      // from the payload for self-write modes.
      const meRes = await trx.raw(
        `SELECT id FROM soldier
          WHERE tenant_id = :tenant_id AND user_id = :actor_user_id
          LIMIT 1`,
        { tenant_id, actor_user_id }
      );
      const meRow = meRes?.rows?.[0] ?? meRes?.[0]?.[0] ?? meRes?.[0];
      if (!meRow || !meRow.id) {
        throw new Error('DeclareAvailability: no soldier record for actor in this tenant');
      }
      target_soldier_id = meRow.id;

      // Lock guard (AVAL-06): non-manager cannot write after constraint_lock_at.
      // Admin / manager flows go through mode='manager_override' (audited).
      if (locked && !is_admin && !is_manager) {
        throw new Error('DeclareAvailability: constraint locked — window is past its constraint_lock_at');
      }
    }

    // Mode dispatch.
    let writes = 0;
    let from_state_for_audit = null;
    let to_state_for_audit = null;
    let to_source = null;

    if (mode === 'range_blockout') {
      if (!range_from || !range_to) {
        throw new Error('DeclareAvailability: range_blockout requires range_from and range_to');
      }
      // String compare on YYYY-MM-DD is lexicographic = chronological.
      if (String(range_from) > String(range_to)) {
        throw new Error('DeclareAvailability: range_from > range_to');
      }
      // Sanity invariant: catches enum drift at runtime (R-03-3 belt-and-braces).
      if (SOURCE_RANK['range_blockout'] === undefined) {
        throw new Error('DeclareAvailability: SOURCE_RANK enum is missing range_blockout (drift detected)');
      }

      // Materialize ALL affected shift_instance rows with source='range_blockout'.
      // ON CONFLICT WHERE clause: only upgrade rows whose existing source is at
      // the same or lower precedence (default | range_blockout). per_slot and
      // manager_override rows are preserved unchanged.
      const res = await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT
           si.tenant_id,
           :soldier_id::uuid,
           si.id,
           'unavailable',
           'range_blockout',
           si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id
           AND si.planning_window_id = :pw_id
           AND si.date BETWEEN :range_from::date AND :range_to::date
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = EXCLUDED.source,
               updated_at = now()
           WHERE availability.source = 'default' OR availability.source = 'range_blockout'
         RETURNING id`,
        {
          soldier_id: target_soldier_id,
          tenant_id,
          pw_id: planning_window_id,
          range_from,
          range_to,
        }
      );
      writes = res?.rowCount ?? res?.rows?.length ?? 0;
      to_state_for_audit = 'availability_range_blockout';
      to_source = 'range_blockout';
    } else if (mode === 'per_slot_toggle') {
      if (!shift_instance_id) {
        throw new Error('DeclareAvailability: per_slot_toggle requires shift_instance_id');
      }
      if (!['available', 'unavailable'].includes(declared)) {
        throw new Error('DeclareAvailability: declared must be available|unavailable');
      }
      // Sanity invariant.
      if (SOURCE_RANK['per_slot'] === undefined) {
        throw new Error('DeclareAvailability: SOURCE_RANK enum is missing per_slot (drift detected)');
      }

      // Capture previous state for audit (single row).
      const prev = await trx('availability')
        .where({ tenant_id, soldier_id: target_soldier_id, shift_instance_id })
        .first('declared', 'source');
      from_state_for_audit = prev ? `${prev.source}:${prev.declared}` : 'default:available';

      // UPSERT with source='per_slot'. The WHERE clause refuses to overwrite a
      // manager_override row — that's the symmetric counterpart to manager_override
      // always winning in the LATERAL read.
      const res = await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT si.tenant_id, :soldier_id::uuid, si.id, :declared, 'per_slot', si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id
           AND si.id = :si_id
           AND si.planning_window_id = :pw_id
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = 'per_slot',
               updated_at = now()
           WHERE availability.source <> 'manager_override'
         RETURNING id`,
        {
          soldier_id: target_soldier_id,
          declared,
          tenant_id,
          si_id: shift_instance_id,
          pw_id: planning_window_id,
        }
      );
      writes = res?.rowCount ?? res?.rows?.length ?? 0;
      to_state_for_audit = 'availability_per_slot';
      to_source = 'per_slot';
    } else if (mode === 'manager_override') {
      if (!shift_instance_id) {
        throw new Error('DeclareAvailability: manager_override requires shift_instance_id');
      }
      if (!['available', 'unavailable'].includes(declared)) {
        throw new Error('DeclareAvailability: declared must be available|unavailable');
      }
      // Sanity invariant.
      if (SOURCE_RANK['manager_override'] === undefined) {
        throw new Error('DeclareAvailability: SOURCE_RANK enum is missing manager_override (drift detected)');
      }

      // Capture previous state for audit.
      const prev = await trx('availability')
        .where({ tenant_id, soldier_id: target_soldier_id, shift_instance_id })
        .first('declared', 'source');
      from_state_for_audit = prev ? `${prev.source}:${prev.declared}` : 'default:available';

      // UPSERT with source='manager_override' — ALWAYS wins (no WHERE on update).
      const res = await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT si.tenant_id, :soldier_id::uuid, si.id, :declared, 'manager_override', si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id
           AND si.id = :si_id
           AND si.planning_window_id = :pw_id
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = 'manager_override',
               updated_at = now()
         RETURNING id`,
        {
          soldier_id: target_soldier_id,
          declared,
          tenant_id,
          si_id: shift_instance_id,
          pw_id: planning_window_id,
        }
      );
      writes = res?.rowCount ?? res?.rows?.length ?? 0;
      to_state_for_audit = 'availability_manager_override';
      to_source = 'manager_override';
    }

    // Audit row IN THE SAME TX (AVAL-07). was_locked captures the constraint_lock_at
    // state at write time — load-bearing for the "manager wrote after lock" forensic.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id,
      from_state: from_state_for_audit,
      to_state: to_state_for_audit,
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        mode,
        soldier_id: target_soldier_id,
        was_locked: locked,
        writes,
        shift_instance_id: shift_instance_id || null,
        range_from: range_from || null,
        range_to: range_to || null,
        declared: declared || null,
        from_source: from_state_for_audit,
        to_source,
      }),
    });

    return { writes, mode, soldier_id: target_soldier_id };
  });

  return {
    success: true,
    writes: result.writes,
    mode: result.mode,
    soldier_id: result.soldier_id,
  };
}

DeclareAvailability.schema = {
  type: 'object',
  required: ['planning_window_id', 'mode'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
    mode: { enum: ['range_blockout', 'per_slot_toggle', 'manager_override'] },
    soldier_id: { type: 'string', format: 'uuid' },
    range_from: { type: 'string' },
    range_to: { type: 'string' },
    shift_instance_id: { type: 'string', format: 'uuid' },
    declared: { enum: ['available', 'unavailable'] },
  },
};
DeclareAvailability.connectionType = 'Knex';
// meta required by @lowdefy/api 5.3 (Phase 02-11 hotfix; match upstream KnexRaw/KnexBuilder).
DeclareAvailability.meta = { checkRead: false, checkWrite: false };

export default DeclareAvailability;
