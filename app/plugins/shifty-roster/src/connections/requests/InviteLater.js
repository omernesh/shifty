// app/plugins/shifty-roster/src/connections/requests/InviteLater.js
// Lowdefy custom request: re-dispatch a magic-link invite to an existing soldier
// whose `app_user` row is missing (post-create "Invite later" button per D-07).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// Implementation (Plan 02-06 Task 1, replaces plan 02-02 stub):
// - GATED on Plan 02-06 Task 0 spike result: VERIFIED A1 (resend.js header) —
//   sendInvite() pre-computed hash matches next-auth v4.24.14 hashToken byte-equal.
// - Two payload shapes accepted (defensive composition):
//     A) { soldier_id }      — preferred; this handler resolves email + display_name
//                              from soldier + app_user via tenant-scoped SELECT.
//     B) { email, displayName, callbackUrl?, locale? } — direct dispatch (used by
//        single-row create flows that already have email in form state).
//   Layer-4 SQL is enforced in path A via a tenant-scoped SELECT; path B trusts
//   the caller's payload AFTER the tenant/actor guards (the email is treated as
//   the recipient identifier — sending an email to an arbitrary address does not
//   cross tenant boundaries by itself; the verification_tokens row IS bound to
//   the email identifier per Auth.js KnexAdapter schema).
// - Records a schedule_audit row (to_state='invite_resent') inside the same
//   transaction as the verification_tokens insert (the Resend HTTP call is
//   awaited after the SQL transaction commits).

import { sendInvite } from '../../dispatch/resend.js';

async function InviteLater({ request, connection }) {
  const props = request.properties || {};
  const { soldier_id } = props;
  let { email, callbackUrl, displayName, locale } = props;

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('InviteLater: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('InviteLater: actor_user_id missing from session — unauthenticated request');
  }

  if (!email && !soldier_id) {
    throw new Error('InviteLater: either soldier_id or email is required');
  }

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // STEP 1 — resolve email + displayName (transaction-scoped lookups + token insert)
    let resolved_soldier_id = soldier_id || null;
    const txResult = await db.transaction(async (trx) => {
      if (soldier_id) {
        // Path A: tenant-scoped lookup via LEFT JOIN. WHERE clause is Layer-4 enforced.
        const row = await trx('soldier as s')
          .leftJoin('app_user as au', 'au.id', 's.user_id')
          .where({ 's.id': soldier_id, 's.tenant_id': tenant_id })
          .first(
            's.id as soldier_id',
            's.display_name as soldier_display_name',
            'au.email as au_email'
          );
        if (!row) {
          throw new Error('InviteLater: soldier not found in this tenant');
        }
        if (!row.au_email) {
          throw new Error('InviteLater: no email on file for this soldier');
        }
        email = row.au_email;
        displayName = displayName || row.soldier_display_name;
        resolved_soldier_id = row.soldier_id;
      }

      // Token insert + Resend HTTP call live inside sendInvite (which awaits the SQL
      // insert before the HTTP send). We pass `trx` so the verification_tokens row
      // shares the transaction.
      const dispatchResult = await sendInvite({
        email,
        callbackUrl,
        displayName,
        locale: locale || 'he',
        knexTx: trx,
      });

      // Audit row — written even if Resend returns an error so we can trace attempts.
      await trx('schedule_audit').insert({
        tenant_id,
        planning_window_id: null,
        from_state: null,
        to_state: 'invite_resent',
        actor_user_id,
        actor_kind: 'user',
        payload: JSON.stringify({
          soldier_id: resolved_soldier_id,
          email: String(email).toLowerCase(),
          dispatch_status: dispatchResult.error ? 'failed' : 'sent',
          dispatch_error: dispatchResult.error || null,
          message_id: dispatchResult.messageId || null,
        }),
      });

      return dispatchResult;
    });

    // Surface Resend errors to the caller as a soft-fail so the UI can toast them
    // (the audit row is already persisted).
    if (txResult.error) {
      return {
        success: false,
        soldier_id: resolved_soldier_id,
        email: String(email).toLowerCase(),
        error: txResult.error,
      };
    }
    return {
      success: true,
      soldier_id: resolved_soldier_id,
      email: String(email).toLowerCase(),
      message_id: txResult.messageId || null,
    };
  } finally {
    await db.destroy();
  }
}

InviteLater.schema = {
  type: 'object',
  // Either soldier_id (path A — preferred from soldier_detail) or email (path B —
  // direct dispatch). Validated in the handler body since JSON Schema cannot
  // express "at least one of two fields required" cleanly across versions.
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    callbackUrl: { type: 'string' },
    displayName: { type: 'string' },
    locale: { enum: ['he', 'en'] },
  },
};
InviteLater.connectionType = 'Knex';

export default InviteLater;
