// app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js
// Lowdefy custom request: commit a validated roster preview (one transaction)
// and synchronously dispatch Resend magic-link invites with progress reporting.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual db.transaction with batched INSERTs (soldier +
// app_user + membership + role_tag) + Resend bulk-dispatch + roster_import_log
// write (D-10, ROST-13 SLO <10s/50rows) lands in plan 02-08.

import { canonicalizeText } from '../../helpers/canonicalize.js';
import { pickNextColor, PALETTE } from '../../helpers/palette.js';
import { sendInvite, bulkDispatchWithBackoff } from '../../dispatch/resend.js';

async function CommitRosterImport({ request, connection }) {
  const { rows } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CommitRosterImport: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CommitRosterImport: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  // eslint-disable-next-line no-unused-vars
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  if (!Array.isArray(rows)) {
    throw new Error('CommitRosterImport: rows must be an array');
  }

  // Touch helper imports so the chain is exercised in the scaffold.
  // eslint-disable-next-line no-unused-vars
  const _canonicalize = canonicalizeText;
  // eslint-disable-next-line no-unused-vars
  const _palette = PALETTE;
  // eslint-disable-next-line no-unused-vars
  const _picker = pickNextColor;
  // eslint-disable-next-line no-unused-vars
  const _send = sendInvite;
  // eslint-disable-next-line no-unused-vars
  const _bulk = bulkDispatchWithBackoff;

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full transactional pipeline + Resend dispatch lands in plan 02-08.
    return {
      rowsCreated: 0,
      rowsSkipped: 0,
      rowsErrored: 0,
      invitesSent: 0,
      invitesFailed: 0,
      todo: 'plan-02-08',
      _stub_inputs: { rows_count: rows.length },
    };
  } finally {
    await db.destroy();
  }
}

CommitRosterImport.schema = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          display_name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role_tags: { type: 'array', items: { type: 'string' } },
          seniority: { type: 'integer', minimum: 0, maximum: 10 },
          team_id: { type: 'string', format: 'uuid' },
          phone_e164: { type: 'string' },
          reinvite: { type: 'boolean' },
        },
      },
    },
  },
};
CommitRosterImport.connectionType = 'Knex';

export default CommitRosterImport;
