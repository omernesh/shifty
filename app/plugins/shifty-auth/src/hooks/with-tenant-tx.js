// app/plugins/shifty-auth/src/hooks/with-tenant-tx.js
// Helper: run a callback inside a Knex transaction with `app.current_tenant` SET LOCAL
// to the session-derived tenant_id. Layer 5 (RLS) enforcement.
//
// Usage from a custom request handler:
//
//   import { withTenantTx } from 'shifty-auth/hooks/with-tenant-tx';
//
//   async function MyRequest({ request, connection }) {
//     return withTenantTx(connection, request.user?.tenant_id, async (trx) => {
//       // trx is a Knex transaction; SET LOCAL app.current_tenant has already executed.
//       const rows = await trx.raw('SELECT ...');
//       return { rows };
//     });
//   }
//
// Why SET LOCAL (not SET):
// - SET persists for the session; pooled connections reuse causes tenant_id leakage.
// - SET LOCAL is transaction-scoped — when the transaction commits/rolls back, the value
//   reverts to whatever ALTER ROLE shifts SET app.current_tenant established (the sentinel
//   '00000000-0000-0000-0000-000000000000' from migration 0013), making the next request
//   start from a clean denied-by-default state.
//
// Why a transaction (not just an unwrapped query):
// - The `LOCAL` scope of SET LOCAL is the current transaction. Without a transaction
//   wrapper, "SET LOCAL" outside a transaction block raises a NOTICE and is silently
//   discarded — RLS would then fall back to the sentinel and queries would return 0 rows.
//
// Tenant guard:
// - If tenant_id is null/undefined (unauthenticated request hitting a handler that
//   nonetheless got dispatched), we throw. Defense-in-depth: a missing tenant_id is
//   never an acceptable "anonymous" state for these handlers.

/**
 * Validates a UUID-shaped string. Fail-fast before passing to Postgres.
 * @param {string} id
 * @returns {boolean}
 */
function isUuid(id) {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Runs the callback inside a Knex transaction with SET LOCAL app.current_tenant
 * set to tenantId. Returns whatever the callback returns. Tears down the Knex
 * instance after the transaction completes (success or failure).
 *
 * @param {object} connection — Lowdefy connection config; passed to knex()
 * @param {string} tenantId — UUID from session (request.user.tenant_id)
 * @param {(trx: import('knex').Knex.Transaction) => Promise<any>} fn — body
 * @returns {Promise<any>}
 */
export async function withTenantTx(connection, tenantId, fn) {
  if (!isUuid(tenantId)) {
    throw new Error(
      'withTenantTx: tenant_id missing or invalid — request rejected (Layer 5 RLS guard)'
    );
  }
  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    return await db.transaction(async (trx) => {
      // SET LOCAL — transaction-scoped tenant binding.
      // Using a parameter binding (?) is safe for plain string values; SET does not
      // accept parameterized identifiers but DOES accept parameterized string literals
      // when the value is a quoted string.
      //
      // Belt: tenant_id has already passed the UUID regex above, so direct interpolation
      // is also safe. Use the regex-validated value directly to keep this simple.
      await trx.raw(`SET LOCAL app.current_tenant = '${tenantId}'`);
      return await fn(trx);
    });
  } finally {
    await db.destroy();
  }
}
