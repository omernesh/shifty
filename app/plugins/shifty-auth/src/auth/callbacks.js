// app/plugins/shifty-auth/src/auth/callbacks.js
// ShiftySessionCallback: hydrates session with {tenant_id, roles, team_ids, locale}
//
// Lowdefy auth callback interface (from @lowdefy/api createCallbackPlugins.js):
//   - Exported function receives { properties, session, token, user }
//   - Function must have fn.meta = { type: 'session' }
//   - Return value is the mutated session object
//
// The 'properties' param comes from lowdefy.yaml auth.callbacks[*].properties.
// We use process.env.POSTGRES_CONNECTION_STRING for the DB connection (same as KnexAdapter).
//
// Layer 5 (RLS) note: this callback runs BEFORE tenant context is established. It needs
// to look up the app_user row by email to DISCOVER which tenant the user belongs to
// (chicken-and-egg: can't SET app.current_tenant to query for tenant_id). We resolve
// this by issuing `SET ROLE NONE` after connect — that returns to session_user = shifts
// (the bootstrap SUPERUSER per migration 0013 header) which bypasses RLS. Safe because:
//   - This is server-side only; the email is the session principal (verified by Auth.js).
//   - The query is a narrow lookup by email; no user-controlled SQL.
//   - The Knex instance is short-lived (one query + one membership join, then destroy).

import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

/**
 * Factory that returns a ShiftySessionCallback bound to a Knex factory.
 * The factory is injectable for unit testing.
 * knexFactory(config)(tableName) returns a chainable query builder.
 */
export function makeShiftySessionCallback(knexFactory) {
  async function ShiftySessionCallback({ properties, session, token, user }) {
    // Allow injection for tests; fall back to real knex in production
    let knex;
    if (typeof knexFactory === 'function') {
      knex = knexFactory;
    } else {
      // Load knex from the server's node_modules at runtime
      try {
        const mod = _require('knex');
        knex = mod.default ?? mod;
      } catch {
        throw new Error('ShiftySessionCallback: failed to load knex. Ensure knex is installed.');
      }
    }

    // Build connection config: prefer properties.connectionString, fall back to env var
    const connectionString =
      (properties && properties.connectionString) ||
      process.env.POSTGRES_CONNECTION_STRING;

    if (!connectionString) {
      throw new Error(
        'ShiftySessionCallback: no DB connection — set POSTGRES_CONNECTION_STRING or pass connectionString in properties'
      );
    }

    const db = knex({ client: 'pg', connection: connectionString });

    try {
      // SET ROLE NONE — bypass RLS for this pre-tenant lookup. Migration 0013 makes
      // shifts connections default to current_user = shifty_app (NOSUPERUSER, NOBYPASSRLS),
      // which blocks queries against app_user/membership because app.current_tenant is
      // the sentinel. We need superuser semantics here to discover which tenant the
      // email belongs to. After this lookup, the resolved tenant_id is hydrated onto
      // session.user.tenant_id and downstream request handlers use it for RLS context.
      //
      // SET ROLE NONE goes to session_user (= shifts, the bootstrap SUPERUSER which
      // cannot be demoted). NOT injectable for unit tests — the mock knex factory
      // doesn't see this call; only the production path needs it.
      if (typeof knexFactory !== 'function') {
        await db.raw('SET ROLE NONE');
      }

      const result = await db('app_user as au')
        .select(
          'au.id as user_id',
          'au.tenant_id',
          'au.locale'
        )
        .where('au.email', session.user.email)
        .first();

      if (result) {
        // Fetch roles + team_ids via membership join
        const memberships = await db('membership as m')
          .select('m.role', 'm.org_unit_id')
          .join('soldier as s', 's.id', 'm.soldier_id')
          .where('s.user_id', result.user_id);

        session.user.user_id   = result.user_id;
        session.user.tenant_id = result.tenant_id;
        session.user.locale    = result.locale || 'he';
        session.user.roles     = [...new Set(memberships.map(m => m.role))];
        session.user.team_ids  = memberships.map(m => m.org_unit_id);
      } else {
        // New email; no app_user row yet → unauthenticated for tenant purposes
        session.user.user_id   = null;
        session.user.tenant_id = null;
        session.user.locale    = 'he';
        session.user.roles     = [];
        session.user.team_ids  = [];
      }
    } finally {
      await db.destroy();
    }
    return session;
  }

  // Lowdefy reads fn.meta.type to determine which next-auth callback this handles
  ShiftySessionCallback.meta = { type: 'session' };
  return ShiftySessionCallback;
}

// Default export: the production callback using the real knex (dynamic require)
export const ShiftySessionCallback = makeShiftySessionCallback(null);
// Also set meta on the named export for direct use
ShiftySessionCallback.meta = { type: 'session' };

export default ShiftySessionCallback;
