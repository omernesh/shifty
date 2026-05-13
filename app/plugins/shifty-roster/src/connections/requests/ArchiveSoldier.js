// app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js
// Lowdefy custom request: archive (soft-delete) a soldier row.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// Implementation (Plan 02-06 Task 1, replaces plan 02-02 stub):
// - UPDATE soldier SET status = 'archived' (NEVER DELETE — D-08, ROST-05, Pitfall P11)
// - Layer-4 scope SQL: admin can archive any soldier in the tenant; team_manager
//   can archive only soldiers in their _user.team_ids
// - Preserves all membership rows, app_user row, audit history (D-08)
// - schedule_audit row (to_state='soldier_archived')

async function ArchiveSoldier({ request, connection }) {
  const { soldier_id } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('ArchiveSoldier: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('ArchiveSoldier: actor_user_id missing from session — unauthenticated request');
  }
  const caller_team_ids = request.user?.team_ids || [];
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');

  if (!soldier_id) {
    throw new Error('ArchiveSoldier: soldier_id is required');
  }

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    const result = await db.transaction(async (trx) => {
      // Soft-delete UPDATE with Layer-4 scope check.
      // D-08 + Pitfall P11: this MUST be an UPDATE (never DELETE) so memberships,
      // schedule_audit history, and app_user remain intact. The literal SQL fragment
      // `status = 'archived'` is one contiguous token (W4 fix from PLAN revision).
      const updateRows = await trx.raw(
        `UPDATE soldier
            SET status = 'archived',
                updated_at = now()
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
        { soldier_id, tenant_id, is_admin, caller_team_ids }
      );
      const rows = updateRows?.rows ?? updateRows;
      if (!rows || rows.length === 0) {
        throw new Error('ArchiveSoldier: soldier not found or access denied');
      }

      // Audit row.
      await trx('schedule_audit').insert({
        tenant_id,
        planning_window_id: null,
        from_state: 'soldier_pre_archive',
        to_state: 'soldier_archived',
        actor_user_id,
        actor_kind: 'user',
        payload: JSON.stringify({ soldier_id }),
      });

      return { soldier_id };
    });

    return { success: true, soldier_id: result.soldier_id };
  } finally {
    await db.destroy();
  }
}

ArchiveSoldier.schema = {
  type: 'object',
  required: ['soldier_id'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
  },
};
ArchiveSoldier.connectionType = 'Knex';

export default ArchiveSoldier;
