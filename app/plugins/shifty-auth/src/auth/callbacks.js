// app/plugins/shifty-auth/src/auth/callbacks.js
// Source: RESEARCH Pattern 4 + skill reference/08-auth.md SessionCallback
// Dynamic knex import for testability without live DB or installed knex.

/**
 * Factory that returns a ShiftySessionCallback bound to a Knex factory.
 * The factory is injectable for unit testing.
 * knexFactory(config) must return a Knex-compatible query builder where
 * knexFactory(config)(tableName) returns a chainable query builder.
 */
export function makeShiftySessionCallback(knexFactory) {
  return async function ShiftySessionCallback({ session, token, user }, connectionProperties) {
    // Allow injection for tests; fall back to real knex in production
    let getDb;
    if (typeof knexFactory === 'function') {
      getDb = knexFactory;
    } else {
      const { default: knex } = await import('knex');
      getDb = knex;
    }

    const db = getDb(connectionProperties);

    try {
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
  };
}

// Default export: the production callback using the real knex (dynamic import)
export const ShiftySessionCallback = makeShiftySessionCallback(null);
export default ShiftySessionCallback;
