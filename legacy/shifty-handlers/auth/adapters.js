// app/plugins/shifty-plugin/src/auth/adapters.js
// KnexAdapter: next-auth v4 database adapter backed by the Shifty Postgres schema.
//
// Tables used (defined in 0002_tenancy_and_org.up.sql):
//   users              — Auth.js canonical user (id, name, email, "emailVerified", image)
//   accounts           — linked OAuth accounts (id, "userId", type, provider, "providerAccountId", ...)
//   sessions           — active sessions (id, "sessionToken", "userId", expires)
//   verification_tokens — magic-link tokens (identifier, token, expires)
//
// Column names with camelCase use quoted identifiers to match Auth.js expectations.
// EmailProvider uses createUser + createVerificationToken + useVerificationToken only.
// SessionStrategy=database also uses createSession / getSessionAndUser / updateSession / deleteSession.
//
// Called by Lowdefy build system via: import { KnexAdapter } from 'shifty-plugin/auth/adapters'
// Signature per Lowdefy plugin adapter convention: KnexAdapter({ properties }) → AdapterObject

import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

/**
 * KnexAdapter({ properties }) — next-auth v4 adapter for the Shifty Postgres schema.
 *
 * @param {object} param0
 * @param {object} param0.properties — Lowdefy adapter properties block from lowdefy.yaml
 *   Currently unused (Knex connection is managed externally by @lowdefy/connection-knex).
 *   The adapter receives a `db` Knex instance via the Lowdefy plugin lifecycle.
 *   For next-auth's internal use, we instantiate a temporary Knex from POSTGRES_CONNECTION_STRING.
 */
export function KnexAdapter({ properties } = {}) {
  // next-auth calls this factory synchronously; it must return the adapter object immediately.
  // We build a per-request Knex instance from env vars (same pattern as @lowdefy/connection-knex).
  // This adapter is only used by next-auth internals (session tokens, magic links) — NOT for
  // tenant-scoped queries (those go through @lowdefy/connection-knex with the RLS hook).

  const getDb = () => {
    // Dynamic import of knex to avoid bundler issues.
    // We use createRequire to get the knex installed alongside next-auth in .lowdefy/server.
    let knexFactory;
    try {
      knexFactory = _require('knex');
    } catch {
      // ESM fallback
      knexFactory = _require('knex/knex.js');
    }
    const knex = knexFactory.default ?? knexFactory;
    const connectionString = process.env.POSTGRES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('KnexAdapter: POSTGRES_CONNECTION_STRING env var is not set');
    }
    return knex({
      client: 'pg',
      connection: connectionString,
    });
  };

  // Lazy singleton for the adapter lifecycle
  let _db = null;
  const db = () => {
    if (!_db) _db = getDb();
    return _db;
  };

  return {
    // -------------------------------------------------------------------------
    // User methods
    // -------------------------------------------------------------------------
    async createUser(data) {
      const rows = await db()('users').insert({
        id: data.id,
        name: data.name ?? null,
        email: data.email,
        emailVerified: data.emailVerified ?? null,
        image: data.image ?? null,
      }).returning(['id', 'name', 'email', 'emailVerified', 'image']);
      return rows[0];
    },

    async getUser(id) {
      const row = await db()('users').where({ id }).first();
      return row ?? null;
    },

    async getUserByEmail(email) {
      const row = await db()('users').where({ email }).first();
      return row ?? null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db()('accounts')
        .where({ provider, providerAccountId })
        .first();
      if (!account) return null;
      const user = await db()('users').where({ id: account.userId }).first();
      return user ?? null;
    },

    async updateUser(data) {
      const { id, ...rest } = data;
      const rows = await db()('users')
        .where({ id })
        .update(rest)
        .returning(['id', 'name', 'email', 'emailVerified', 'image']);
      return rows[0];
    },

    async deleteUser(userId) {
      await db()('accounts').where({ userId }).delete();
      await db()('sessions').where({ userId }).delete();
      await db()('users').where({ id: userId }).delete();
    },

    // -------------------------------------------------------------------------
    // Account (OAuth) methods
    // -------------------------------------------------------------------------
    async linkAccount(account) {
      await db()('accounts').insert({
        id: account.id,
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token ?? null,
        access_token: account.access_token ?? null,
        expires_at: account.expires_at ?? null,
        token_type: account.token_type ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
        session_state: account.session_state ?? null,
      });
      return account;
    },

    async unlinkAccount({ provider, providerAccountId }) {
      const row = await db()('accounts')
        .where({ provider, providerAccountId })
        .first();
      if (row) {
        await db()('accounts').where({ id: row.id }).delete();
      }
      return row;
    },

    // -------------------------------------------------------------------------
    // Session methods
    // -------------------------------------------------------------------------
    async createSession(session) {
      const rows = await db()('sessions').insert({
        id: session.id,
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires,
      }).returning(['id', 'sessionToken', 'userId', 'expires']);
      return rows[0];
    },

    async getSessionAndUser(sessionToken) {
      const session = await db()('sessions').where({ sessionToken }).first();
      if (!session) return null;
      const user = await db()('users').where({ id: session.userId }).first();
      if (!user) return null;
      return { session, user };
    },

    async updateSession({ sessionToken, ...data }) {
      const rows = await db()('sessions')
        .where({ sessionToken })
        .update(data)
        .returning(['id', 'sessionToken', 'userId', 'expires']);
      return rows[0] ?? null;
    },

    async deleteSession(sessionToken) {
      const row = await db()('sessions').where({ sessionToken }).first();
      if (row) {
        await db()('sessions').where({ sessionToken }).delete();
      }
      return row ?? null;
    },

    // -------------------------------------------------------------------------
    // Verification token methods (magic-link)
    // -------------------------------------------------------------------------
    async createVerificationToken(data) {
      await db()('verification_tokens').insert({
        identifier: data.identifier,
        token: data.token,
        expires: data.expires,
      });
      return data;
    },

    async useVerificationToken({ identifier, token }) {
      const row = await db()('verification_tokens')
        .where({ identifier, token })
        .first();
      if (!row) return null;
      await db()('verification_tokens').where({ identifier, token }).delete();
      return { identifier: row.identifier, token: row.token, expires: row.expires };
    },
  };
}

export default { KnexAdapter };
