// app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js
// Lowdefy custom request: parse an uploaded CSV (base64) and produce a per-row
// preview state for the import wizard (ok / warn / error per row).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// SCAFFOLD-ONLY: the actual papaparse + duplicate detection + role-tag warn
// pipeline (D-09, D-10, D-12) lands in plan 02-08.

import { canonicalizeText } from '../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../helpers/role-tag.js';

async function ParseCsvAndValidate({ request, connection }) {
  const { file_b64 } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('ParseCsvAndValidate: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('ParseCsvAndValidate: actor_user_id missing from session — unauthenticated request');
  }

  if (!file_b64) {
    throw new Error('ParseCsvAndValidate: file_b64 is required');
  }

  // Touch helper imports so the chain is exercised (stub returns empty rows).
  // eslint-disable-next-line no-unused-vars
  const _canonicalize = canonicalizeText;
  // eslint-disable-next-line no-unused-vars
  const _role_tag = canonicalizeRoleTag;

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // Placeholder: full papaparse + dedup pipeline lands in plan 02-08.
    return {
      rows: [],
      total: 0,
      todo: 'plan-02-08',
    };
  } finally {
    await db.destroy();
  }
}

ParseCsvAndValidate.schema = {
  type: 'object',
  required: ['file_b64'],
  properties: {
    file_b64: { type: 'string', minLength: 1 },
  },
};
ParseCsvAndValidate.connectionType = 'Knex';

export default ParseCsvAndValidate;
