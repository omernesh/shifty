// app/plugins/shifty-roster/src/connections/requests/InviteLater.js
// Lowdefy custom request: re-dispatch a magic-link invite to an existing soldier
// whose `app_user` row is missing (post-create "Invite later" button per D-07).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual sendInvite() call (with verification_tokens insert
// inside the transaction + schedule_audit emission) lands in plan 02-06.
// The dispatch helper (src/dispatch/resend.js) is already implemented.

import { sendInvite } from '../../dispatch/resend.js';

async function InviteLater({ request, connection }) {
  const { email, callbackUrl, displayName, locale } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('InviteLater: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('InviteLater: actor_user_id missing from session — unauthenticated request');
  }

  if (!email) {
    throw new Error('InviteLater: email is required');
  }

  // Touch the dispatch helper import so the chain is exercised (stub does not actually dispatch).
  // eslint-disable-next-line no-unused-vars
  const _dispatcher = sendInvite;

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full sendInvite + audit-emission lands in plan 02-06.
    return {
      success: true,
      todo: 'plan-02-06',
      _stub_inputs: { email, callbackUrl, displayName, locale },
    };
  } finally {
    await db.destroy();
  }
}

InviteLater.schema = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', format: 'email' },
    callbackUrl: { type: 'string' },
    displayName: { type: 'string' },
    locale: { enum: ['he', 'en'] },
  },
};
InviteLater.connectionType = 'Knex';

export default InviteLater;
