// app/plugins/shifty-plugin/src/hooks/knex-tenant.js
// Knex pool.afterCreate hook that sets app.current_tenant per connection checkout.
// Source: RESEARCH Pattern 7 + Anti-Patterns (SET LOCAL is mandatory)

/**
 * Sets `app.current_tenant` on a Postgres connection using SET LOCAL.
 * Called from Knex's pool.afterCreate(conn, done).
 * If tenantId is null/undefined (unauthenticated request), the SET is skipped —
 * the RLS policy uses current_setting('app.current_tenant', true)::uuid which
 * returns NULL, blocking all tenant-scoped rows (correct for anonymous state).
 *
 * @param {object} conn — pg Client object
 * @param {function} done — callback (err, conn)
 * @param {string|null} tenantId — UUID string; if null, no SET is emitted
 */
export function setTenantOnConnection(conn, done, tenantId) {
  if (!tenantId) {
    // No tenant context — leave app.current_tenant unset; RLS will block tenant-scoped queries.
    return done(null, conn);
  }
  // Validate UUID shape defensively (Postgres will fail later if malformed; this is a fast-fail)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    return done(new Error('setTenantOnConnection: invalid UUID format for tenantId'), null);
  }
  // SET LOCAL — value persists only for the duration of the transaction (or until reset).
  // Without LOCAL, the value persists across pooled connection reuse and leaks across requests.
  conn.query(`SET LOCAL app.current_tenant = '${tenantId}'`, (err) => done(err, conn));
}
