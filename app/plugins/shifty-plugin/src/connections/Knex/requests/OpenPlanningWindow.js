// app/plugins/shifty-plugin/src/connections/Knex/requests/OpenPlanningWindow.js
// Lowdefy custom request: open a planning_window for a team and materialize the
// (slot × date × headcount_index) cross-product as shift_instance rows in a single
// INSERT…SELECT statement. Tenant ID from request.user (session) — NEVER from
// request.properties. Layer-4 defense.
//
// RESEARCH Recipe 4 + 03-CONTEXT D-Area-2. The CROSS JOIN LATERAL pattern is the
// load-bearing performance win — one round-trip materializes up to 3,600 rows for
// 30 soldiers × 30 days × 4 active rules. Per-row INSERT loops would be ~50× slower.
//
// Implementation (Plan 03-04 Task 1):
// 1. Layer-4 guards: tenant_id, actor_user_id, role guard (unit_admin OR team_manager).
// 2. Payload validation:
//    - missing team_id / start_date / end_date → throw
//    - end_date < start_date → throw
//    - days > 30 → throw (the 30-day window cap; RESEARCH Recipe 4 + Pitfall 7)
// 3. Inside withTenantTx:
//    a) Layer-4 manager scope check (membership-join — non-admin caller must own
//       the team via membership.role='team_manager'). Same pattern as CreateShiftSlot.
//    b) Pre-check: SELECT count(*) FROM shift_slot WHERE team — refuse if 0 with
//       Hebrew-keyed discriminator 'team_has_zero_shift_slots'.
//    c) Resolve constraint_lock_at: caller override OR
//       `(start_date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'`.
//    d) INSERT planning_window with state='open' RETURNING id.
//    e) INSERT…SELECT cross-product:
//       FROM shift_slot s
//       CROSS JOIN generate_series(start_date, end_date, INTERVAL '1 day') d
//       CROSS JOIN LATERAL generate_series(0, s.headcount - 1) h
//       WHERE s.tenant_id AND s.team_id
//       RETURNING id
//       — capture rowCount as instance_count.
//    f) Belt-and-braces: throw if instance_count > 3,600.
//    g) schedule_audit row in same TX (to_state='planning_window_opened').

import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function OpenPlanningWindow({ request, connection }) {
  const { team_id, start_date, end_date, constraint_lock_at } = request.properties || {};

  // Layer-4 tenant / actor guards (BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('OpenPlanningWindow: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('OpenPlanningWindow: actor_user_id missing from session — unauthenticated request');
  }
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) {
    throw new Error('OpenPlanningWindow: requires unit_admin or team_manager role');
  }

  // Payload guards.
  if (!team_id) throw new Error('OpenPlanningWindow: team_id is required');
  if (!start_date) throw new Error('OpenPlanningWindow: start_date is required');
  if (!end_date) throw new Error('OpenPlanningWindow: end_date is required');

  // Date validation — string compare on YYYY-MM-DD is lexicographic = chronological.
  if (String(end_date) < String(start_date)) {
    throw new Error('OpenPlanningWindow: end_date < start_date');
  }
  // 30-day cap (server-side; UI also blocks but a forged POST must still be refused).
  // Day count is inclusive: (end - start) + 1.
  const startMs = Date.parse(String(start_date) + 'T00:00:00Z');
  const endMs = Date.parse(String(end_date) + 'T00:00:00Z');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('OpenPlanningWindow: start_date / end_date must be ISO YYYY-MM-DD');
  }
  const dayCount = Math.round((endMs - startMs) / 86_400_000) + 1;
  if (dayCount > 30) {
    throw new Error('OpenPlanningWindow: window length > 30 days');
  }

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Layer-4 scope check: non-admin manager must own this team via
    // membership.role='team_manager'. RESEARCH Recipe 2/4 membership-join pattern.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: team_id, role: 'team_manager' })
        .whereIn('soldier_id', function () {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) {
        throw new Error('OpenPlanningWindow: caller is not team_manager of this team');
      }
    }

    // Pre-check: team must have at least one shift_slot.
    const slotCountRow = await trx('shift_slot')
      .where({ tenant_id, team_id })
      .count({ c: '*' })
      .first();
    const slotCount = Number(slotCountRow?.c ?? 0);
    if (slotCount === 0) {
      throw new Error('OpenPlanningWindow: team has zero shift_slots — define slots first');
    }

    // Resolve constraint_lock_at: caller override OR default of
    // `(start_date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'`.
    // Both code paths bind the same parameter name `:lock_at` in the INSERT.
    let lockTsExpr;
    let lockTsBinding;
    if (constraint_lock_at) {
      lockTsExpr = trx.raw('?::timestamptz', [constraint_lock_at]);
      lockTsBinding = constraint_lock_at;
    } else {
      lockTsExpr = trx.raw(
        `(:start_date::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'`,
        { start_date }
      );
      lockTsBinding = null; // resolved server-side
    }

    // INSERT planning_window with state='open'. We use a raw INSERT…RETURNING so the
    // constraint_lock_at expression can be the inline TZ-aware Postgres expression
    // (above) when the caller passes null. The state='open' default is also encoded
    // explicitly so the audit row's payload reflects it.
    const pwInsert = await trx.raw(
      `INSERT INTO planning_window (tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
       VALUES (:tenant_id, :team_id, :start_date::date, :end_date::date, ${
         constraint_lock_at
           ? ':lock_at::timestamptz'
           : `(:start_date::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'`
       }, 'open')
       RETURNING id, constraint_lock_at`,
      {
        tenant_id,
        team_id,
        start_date,
        end_date,
        ...(constraint_lock_at ? { lock_at: constraint_lock_at } : {}),
      }
    );
    // pg returns { rows: [...] }; knex returns the raw response — handle both shapes.
    const pwRow = pwInsert?.rows?.[0] ?? pwInsert?.[0]?.[0] ?? pwInsert?.[0];
    const planning_window_id = pwRow?.id ?? pwRow;
    const constraint_lock_at_resolved = pwRow?.constraint_lock_at ?? null;
    // Suppress lint about lockTsExpr/lockTsBinding when only one branch consumed.
    void lockTsExpr; void lockTsBinding;

    if (!planning_window_id) {
      throw new Error('OpenPlanningWindow: planning_window INSERT returned no id');
    }

    // Materialize the cross-product. CROSS JOIN LATERAL with generate_series(0, headcount-1)
    // yields one row per (slot, date, headcount_index) tuple. RESEARCH Recipe 4 verbatim.
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
        start_date,
        end_date,
        tenant_id,
        team_id,
      }
    );
    const xpRows = xpInsert?.rows ?? xpInsert?.[0] ?? [];
    const instance_count = Array.isArray(xpRows) ? xpRows.length : Number(xpInsert?.rowCount ?? 0);

    // Belt-and-braces — defends against pathological headcount configs that would
    // blow up storage. The 30-day cap above + UI client-side preview already make
    // this near-unreachable, but a forged POST could still exercise it.
    if (instance_count > 3600) {
      throw new Error('OpenPlanningWindow: instance_count > 3600 — pathological config refused');
    }

    // Audit row in same TX (to_state='planning_window_opened').
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id,
      from_state: null,
      to_state: 'planning_window_opened',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        team_id,
        start_date,
        end_date,
        constraint_lock_at_resolved,
        day_count: dayCount,
        slot_count: slotCount,
        instance_count,
      }),
    });

    return { planning_window_id, instance_count, constraint_lock_at_resolved };
  });

  return {
    success: true,
    planning_window_id: result.planning_window_id,
    instance_count: result.instance_count,
    constraint_lock_at_resolved: result.constraint_lock_at_resolved,
  };
}

OpenPlanningWindow.schema = {
  type: 'object',
  required: ['team_id', 'start_date', 'end_date'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    start_date: { type: 'string' }, // ISO YYYY-MM-DD
    end_date: { type: 'string' },
    constraint_lock_at: { type: ['string', 'null'] }, // ISO TIMESTAMPTZ when supplied
  },
};
OpenPlanningWindow.connectionType = 'Knex';
// meta required by @lowdefy/api 5.3 (Phase 02-11 hotfix; match upstream KnexRaw/KnexBuilder).
OpenPlanningWindow.meta = { checkRead: false, checkWrite: false };

export default OpenPlanningWindow;
