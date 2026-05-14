// app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js
// Lowdefy custom request: create a single soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Layer 5 (RLS) wireup: the transaction is opened via withTenantTx, which issues
// SET LOCAL app.current_tenant = '<tenant_id>' at the top so every INSERT/UPDATE/SELECT
// inside the transaction is RLS-scoped to this tenant.
//
// knex is loaded indirectly via withTenantTx (dynamic import). Unit tests that exercise
// only the guard clauses can still import this module without knex installed, because
// withTenantTx is only invoked AFTER the guards pass.
//
// Implementation (Plan 02-06 Task 1, replaces plan 02-02 stub):
// 1. canonicalizeText(display_name) BEFORE INSERT (D-12, ROST-11; Pitfall P2 mitigation)
// 2. role_tag UPSERT via ON CONFLICT DO NOTHING (D-13)
// 3. Optional app_user resolution / creation when email supplied (D-05)
// 4. Race-safe color assignment: SELECT FOR UPDATE on org_unit.last_color_index +
//    pickNextColor + UPDATE org_unit.last_color_index inside the transaction
//    (D-15, ROST-06; RESEARCH Open Q4 mitigation)
// 5. INSERT soldier
// 6. SELECT-driven INSERT membership when team_id supplied (RESEARCH §"Membership —
//    Constraints" safe form — never insert with raw payload values for tenant_id)
// 7. schedule_audit row (to_state='soldier_created') via the audit-writer pattern
//    from app/plugins/shifty-audit-writer/src/connections/requests/AuditWrite.js

import { canonicalizeText } from '../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../helpers/role-tag.js';
import { pickNextColor, PALETTE } from '../../helpers/palette.js';
import { withTenantTx } from 'shifty-auth/hooks/with-tenant-tx';

async function CreateSoldier({ request, connection }) {
  const { display_name, seniority, role_tags, email, phone_e164, notes, team_id } =
    request.properties || {};

  // Layer-4 tenant / actor guards (run BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CreateSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CreateSoldier: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');
  const is_manager_or_admin = is_admin || roles.includes('team_manager');

  if (!display_name) {
    throw new Error('CreateSoldier: display_name is required');
  }

  // Canonicalize at WRITE time — D-12 / ROST-11 / Pitfall P2.
  const canonicalName = canonicalizeText(display_name);
  if (!canonicalName) {
    throw new Error('CreateSoldier: display_name canonicalized to empty string');
  }

  // Canonicalize role tags (kebab-case keys); drop blanks.
  const canonicalRoleTags = Array.isArray(role_tags)
    ? Array.from(new Set(role_tags.map(canonicalizeRoleTag).filter(Boolean)))
    : [];

  // Notes column is server-side gated to managers/admins (Pitfall P10).
  const safeNotes = (typeof notes === 'string' && is_manager_or_admin) ? notes : null;

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Step 1: upsert any new role_tag keys for this tenant. ON CONFLICT DO NOTHING
    // covers concurrent admin sessions adding the same key.
    if (canonicalRoleTags.length > 0) {
      await trx('role_tag')
        .insert(canonicalRoleTags.map((key) => ({ tenant_id, key })))
        .onConflict(['tenant_id', 'key'])
        .ignore();
    }

    // Step 2: optional app_user resolution.
    let appUserId = null;
    if (email && typeof email === 'string') {
      const lowerEmail = email.toLowerCase();
      const existing = await trx('app_user')
        .where({ tenant_id, email: lowerEmail })
        .first('id');
      if (existing) {
        appUserId = existing.id;
      } else {
        const inserted = await trx('app_user')
          .insert({
            tenant_id,
            email: lowerEmail,
            display_name: canonicalName,
            locale: 'he',
          })
          .returning('id');
        appUserId = inserted[0]?.id ?? inserted[0];
      }
    }

    // Step 3: race-safe color assignment via SELECT FOR UPDATE
    // (RESEARCH Open Q4 — concurrent inserts in the same team would otherwise read
    // the same last_color_index and both write the same color).
    let colorIndex = 0;
    let colorHex = PALETTE[0];
    if (team_id) {
      const ouRow = await trx('org_unit')
        .where({ id: team_id, tenant_id })
        .forUpdate()
        .first('last_color_index');
      if (!ouRow) {
        throw new Error('CreateSoldier: team_id not found in this tenant');
      }
      colorIndex = pickNextColor(ouRow.last_color_index);
      colorHex = PALETTE[colorIndex];
      await trx('org_unit')
        .where({ id: team_id, tenant_id })
        .update({ last_color_index: colorIndex, updated_at: trx.fn.now() });
    }

    // Step 4: INSERT soldier.
    const soldierInsert = await trx('soldier')
      .insert({
        tenant_id,
        user_id: appUserId,
        display_name: canonicalName,
        color: colorHex,
        seniority: typeof seniority === 'number' ? seniority : 0,
        role_tags: canonicalRoleTags, // pg TEXT[] — knex passes through
        phone_e164: phone_e164 || null,
        status: 'active',
        notes: safeNotes,
      })
      .returning('id');
    const soldier_id = soldierInsert[0]?.id ?? soldierInsert[0];

    // Step 5: SELECT-driven membership INSERT (RESEARCH §"Membership — Constraints"
    // safe form). The SELECT enforces cross-tenant safety even if upstream payload
    // is forged: rows are emitted only when both soldier and org_unit live in the
    // same tenant. ON CONFLICT keeps the operation idempotent on retries.
    if (team_id) {
      await trx.raw(
        `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
         SELECT s.tenant_id, s.id, ou.id, 'member'
           FROM soldier s, org_unit ou
          WHERE s.id = :soldier_id
            AND ou.id = :team_id
            AND s.tenant_id = :tenant_id
            AND ou.tenant_id = :tenant_id
         ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`,
        { soldier_id, team_id, tenant_id }
      );
    }

    // Step 6: audit row (matches shifty-audit-writer payload shape).
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: null,
      to_state: 'soldier_created',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        soldier_id,
        display_name: canonicalName,
        team_id: team_id || null,
        role_tags: canonicalRoleTags,
        app_user_id: appUserId,
        color_index: team_id ? colorIndex : null,
      }),
    });

    return {
      soldier_id,
      color: colorHex,
      color_index: team_id ? colorIndex : null,
      app_user_id: appUserId,
    };
  });

  return {
    success: true,
    soldier: {
      id: result.soldier_id,
      display_name: canonicalName,
      color: result.color,
      role_tags: canonicalRoleTags,
    },
    app_user_id: result.app_user_id,
    color_index: result.color_index,
  };
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
