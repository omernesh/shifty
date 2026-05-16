// app/plugins/shifty-plugin/src/connections/Knex/requests/ApplyShiftTemplate.js
// Lowdefy custom request: apply a preset shift template (2x12h / 3x8h / custom) to a
// team. RESEARCH Recipe 3 — the wizard handler.
//
// HEBREW NAMES ARE BYTE-EXACT FROM PRD §7.4 + CONTEXT D-Area-1 specifics.
// Do NOT paraphrase. The CONTEXT calls this out TWICE:
//   2x12h → 'בוקר' (06:00–18:00), 'לילה' (18:00–06:00)
//   3x8h  → 'בוקר' (06:00–14:00), 'ערב' (14:00–22:00), 'לילה' (22:00–06:00)
// The 3x8h evening slot is named exactly 'ערב' per PRD §7.4 — a different,
// daytime-leaning Hebrew word that the UI-checker flagged as forbidden has been
// avoided throughout this handler and its callers.
//
// Implementation (Plan 03-03 Task 1):
// - Guards: tenant_id, actor_user_id, role guard.
// - Pre-check: refuse to overwrite if any shift_slot already exists for the team
//   (D-Area-1: 'Once any slot exists for the team, modal does NOT re-prompt').
// - Layer-4 scope check (membership-join) for non-admin callers.
// - Loop INSERT preset slots; capture returned ids.
// - UPDATE org_unit.template_picked_at = now() (column from migration 0014).
// - schedule_audit (to_state='shift_template_applied').
// - 'custom' template inserts ZERO slots but STILL sets template_picked_at so the
//   wizard never re-prompts (D-Area-1).

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

const TEMPLATES = {
  '2x12h': [
    { name: 'בוקר', start_time: '06:00', end_time: '18:00', display_order: 0 },
    { name: 'לילה', start_time: '18:00', end_time: '06:00', display_order: 1 },
  ],
  '3x8h': [
    { name: 'בוקר', start_time: '06:00', end_time: '14:00', display_order: 0 },
    { name: 'ערב',  start_time: '14:00', end_time: '22:00', display_order: 1 },
    { name: 'לילה', start_time: '22:00', end_time: '06:00', display_order: 2 },
  ],
  'custom': [],
};

async function ApplyShiftTemplate({ request, connection }) {
  const { team_id, template_key, headcount = 1 } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('ApplyShiftTemplate: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('ApplyShiftTemplate: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('ApplyShiftTemplate: requires unit_admin or team_manager role');
  }

  if (!team_id) throw new Error('ApplyShiftTemplate: team_id is required');
  if (!template_key || !Object.prototype.hasOwnProperty.call(TEMPLATES, template_key)) {
    throw new Error('ApplyShiftTemplate: unknown template_key');
  }
  if (!Number.isInteger(headcount) || headcount < 1) {
    throw new Error('ApplyShiftTemplate: headcount must be an integer >= 1');
  }

  const slots = TEMPLATES[template_key];

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Confirm the team exists in this tenant before doing any work.
    const team = await trx('org_unit').where({ id: team_id, tenant_id }).first('id', 'template_picked_at');
    if (!team) {
      throw new Error('ApplyShiftTemplate: team not found in tenant');
    }

    // Layer-4 scope check: non-admin manager must own this team.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: team_id, role: 'team_manager' })
        .whereIn('soldier_id', function () {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) {
        throw new Error('ApplyShiftTemplate: caller is not team_manager of this team');
      }
    }

    // Refuse if any slot already exists for this team (D-Area-1; T-03-12 mitigation).
    // Concurrent applies: the SECOND TX sees the FIRST's rows and refuses.
    const existsRow = await trx('shift_slot').where({ tenant_id, team_id }).first('id');
    if (existsRow) {
      throw new Error('ApplyShiftTemplate: slots already exist for this team; refusing to overwrite');
    }

    // INSERT preset slots (zero for 'custom').
    const created_ids = [];
    for (const s of slots) {
      const ins = await trx('shift_slot')
        .insert({
          tenant_id,
          team_id,
          name: s.name,
          start_time: s.start_time,
          end_time: s.end_time,
          headcount,
          required_role_tags: [],
          min_seniority: null,
          display_order: s.display_order,
        })
        .returning('id');
      created_ids.push(ins[0]?.id ?? ins[0]);
    }

    // Mark template_picked_at — column from 0014_phase3_denorms.up.sql.
    // Set even for 'custom' so the wizard never re-prompts (D-Area-1).
    await trx('org_unit')
      .where({ id: team_id, tenant_id })
      .update({ template_picked_at: trx.fn.now(), updated_at: trx.fn.now() });

    // Audit in same TX.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: null,
      to_state: 'shift_template_applied',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        team_id,
        template_key,
        created_ids,
        headcount,
        slot_count: created_ids.length,
      }),
    });

    return { created_ids, slot_count: created_ids.length };
  });

  return {
    success: true,
    team_id,
    template_key,
    created_ids: result.created_ids,
    slot_count: result.slot_count,
  };
}

ApplyShiftTemplate.schema = {
  type: 'object',
  required: ['team_id', 'template_key'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    template_key: { enum: ['2x12h', '3x8h', 'custom'] },
    headcount: { type: 'integer', minimum: 1 },
  },
};
ApplyShiftTemplate.connectionType = 'Knex';
ApplyShiftTemplate.meta = { checkRead: false, checkWrite: false };

export default ApplyShiftTemplate;
