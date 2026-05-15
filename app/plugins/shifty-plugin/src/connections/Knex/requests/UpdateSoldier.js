// app/plugins/shifty-plugin/src/connections/Knex/requests/UpdateSoldier.js
// Lowdefy custom request: update an existing soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Layer 5 (RLS) wireup: the transaction is opened via withTenantTx, which issues
// SET LOCAL app.current_tenant before any DB activity.
//
// knex is loaded indirectly via withTenantTx (dynamic import). Unit tests that exercise
// only the guard clauses can still import this module without knex installed.
//
// Implementation (Plan 02-06 Task 1, replaces plan 02-02 stub):
// - canonicalizeText(display_name) at WRITE time (D-12; Pitfall P2)
// - role_tag UPSERT (D-13)
// - Layer-4 scope SQL on UPDATE: admin can edit anyone in the tenant; team_manager
//   can edit only soldiers in their _user.team_ids (RESEARCH §"Layer 4")
// - notes column server-side gated via CASE WHEN :is_manager_or_admin (Pitfall P10
//   — defense-in-depth; the load_soldier SELECT also conditional-nulls notes for
//   non-managers so the client never sees them in the first place)
// - schedule_audit row (to_state='soldier_updated')

import { canonicalizeText } from '../../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../../helpers/role-tag.js';
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function UpdateSoldier({ request, connection }) {
  const { soldier_id, display_name, seniority, role_tags, phone_e164, notes, status, color } =
    request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('UpdateSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('UpdateSoldier: actor_user_id missing from session — unauthenticated request');
  }
  const caller_team_ids = request.user?.team_ids || [];
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager_or_admin = is_admin || roles.includes('team_manager');

  if (!soldier_id) {
    throw new Error('UpdateSoldier: soldier_id is required');
  }

  // Canonicalize at WRITE time. Use `undefined` (not null) to signal "no change"
  // so the COALESCE in SQL preserves the existing value.
  const canonicalDisplayName = display_name != null ? canonicalizeText(display_name) : undefined;
  const canonicalRoleTags = Array.isArray(role_tags)
    ? Array.from(new Set(role_tags.map(canonicalizeRoleTag).filter(Boolean)))
    : undefined;

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // Upsert any new role-tag keys for this tenant (mirrors CreateSoldier step 1).
    if (canonicalRoleTags && canonicalRoleTags.length > 0) {
      await trx('role_tag')
        .insert(canonicalRoleTags.map((key) => ({ tenant_id, key })))
        .onConflict(['tenant_id', 'key'])
        .ignore();
    }

    // Single parameterized UPDATE with Layer-4 scope check.
    // RETURNING id lets us detect "not found OR access denied" → 0 rows.
    //
    // Notes column is gated by CASE WHEN :is_manager_or_admin so even if a non-manager
    // POSTs a `notes` field, the SQL refuses to write it (defense-in-depth on top of
    // safeNotes guard which already nulls it before binding).
    const safeNotes = (typeof notes === 'string' && is_manager_or_admin) ? notes : null;

    const updateRows = await trx.raw(
      `UPDATE soldier
          SET display_name = COALESCE(:display_name, display_name),
              seniority    = COALESCE(:seniority, seniority),
              role_tags    = COALESCE(:role_tags, role_tags),
              phone_e164   = COALESCE(:phone_e164, phone_e164),
              notes        = CASE WHEN :is_manager_or_admin THEN COALESCE(:notes, notes) ELSE notes END,
              color        = COALESCE(:color, color),
              status       = COALESCE(:status, status),
              updated_at   = now()
        WHERE id = :soldier_id
          AND tenant_id = :tenant_id
          AND (
            :is_admin
            OR EXISTS (
              SELECT 1 FROM membership m
               WHERE m.soldier_id = :soldier_id
                 AND m.org_unit_id = ANY(:caller_team_ids)
            )
          )
      RETURNING id`,
      {
        display_name: canonicalDisplayName ?? null,
        seniority: typeof seniority === 'number' ? seniority : null,
        role_tags: canonicalRoleTags ?? null,
        phone_e164: phone_e164 ?? null,
        notes: safeNotes,
        color: color ?? null,
        status: status ?? null,
        is_manager_or_admin,
        is_admin,
        soldier_id,
        tenant_id,
        caller_team_ids,
      }
    );

    // pg returns { rows: [...] }; some knex dialects return the array directly.
    const rows = updateRows?.rows ?? updateRows;
    if (!rows || rows.length === 0) {
      throw new Error('UpdateSoldier: soldier not found or access denied');
    }

    // Audit row.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,
      from_state: 'soldier_pre_update',
      to_state: 'soldier_updated',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({
        soldier_id,
        changed_fields: {
          display_name: canonicalDisplayName ?? undefined,
          seniority: typeof seniority === 'number' ? seniority : undefined,
          role_tags: canonicalRoleTags ?? undefined,
          phone_e164: phone_e164 ?? undefined,
          notes_changed: safeNotes != null,
          color: color ?? undefined,
          status: status ?? undefined,
        },
      }),
    });

    return { soldier_id };
  });

  return { success: true, soldier_id: result.soldier_id };
}

UpdateSoldier.schema = {
  type: 'object',
  required: ['soldier_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    display_name: { type: 'string', minLength: 1 },
    seniority: { type: 'integer', minimum: 0, maximum: 10 },
    role_tags: { type: 'array', items: { type: 'string' } },
    phone_e164: { type: 'string' },
    notes: { type: 'string' },
    status: { enum: ['active', 'archived'] },
    color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
  },
};
UpdateSoldier.connectionType = 'Knex';
// meta required by @lowdefy/api 5.3 (Phase 02-11 hotfix; match upstream KnexRaw/KnexBuilder).
UpdateSoldier.meta = { checkRead: false, checkWrite: false };

export default UpdateSoldier;
