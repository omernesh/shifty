// Run: node --test app/plugins/shifty-auth/tests/auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShiftySessionCallback } from '../src/auth/callbacks.js';
import { setTenantOnConnection } from '../src/hooks/knex-tenant.js';

// Mock Knex factory: returns a chainable query builder that resolves to canned results.
function makeMockKnex(rows) {
  const factory = (cfg) => {
    const makeChain = (resolveValue) => {
      const chain = {
        select: () => chain,
        from: () => chain,
        join: () => chain,
        where: () => chain,
        first: () => Promise.resolve(resolveValue),
        then: (resolve) => Promise.resolve(resolveValue).then(resolve),
        catch: (reject) => Promise.resolve(resolveValue).catch(reject),
      };
      return chain;
    };

    let queryCount = 0;
    const fn = (table) => {
      // First call: app_user query; second call: membership query
      if (queryCount === 0) {
        queryCount++;
        return makeChain(rows.app_user);
      }
      queryCount++;
      return makeChain(rows.memberships || []);
    };
    fn.destroy = () => Promise.resolve();
    return fn;
  };
  return factory;
}

test('ShiftySessionCallback hydrates known user', async () => {
  const knexMock = makeMockKnex({
    app_user: { user_id: 'u1', tenant_id: 't1', locale: 'he' },
    memberships: [{ role: 'unit_admin', org_unit_id: 'ou1' }, { role: 'team_manager', org_unit_id: 'ou2' }],
  });
  const callback = makeShiftySessionCallback(knexMock);
  const session = { user: { email: 'admin-a@example.test' } };
  // New Lowdefy interface: single { properties, session, token, user } arg
  const out = await callback({ properties: { connectionString: 'mock' }, session, token: {}, user: {} });
  assert.equal(out.user.user_id, 'u1');
  assert.equal(out.user.tenant_id, 't1');
  assert.equal(out.user.locale, 'he');
  assert.deepEqual(out.user.roles.sort(), ['team_manager', 'unit_admin']);
  assert.deepEqual(out.user.team_ids.sort(), ['ou1', 'ou2']);
});

test('ShiftySessionCallback defaults for unknown email', async () => {
  const knexMock = makeMockKnex({ app_user: null, memberships: [] });
  const callback = makeShiftySessionCallback(knexMock);
  const session = { user: { email: 'nobody@example.test' } };
  // New Lowdefy interface: single { properties, session, token, user } arg
  const out = await callback({ properties: { connectionString: 'mock' }, session, token: {}, user: {} });
  assert.equal(out.user.tenant_id, null);
  assert.equal(out.user.locale, 'he');
  assert.deepEqual(out.user.roles, []);
  assert.deepEqual(out.user.team_ids, []);
});

test('setTenantOnConnection emits SET LOCAL (not SET) for valid UUID', (t, done) => {
  const fakeConn = {
    query(sql, cb) {
      assert.match(sql, /^SET LOCAL app\.current_tenant = '/);
      assert.doesNotMatch(sql, /^SET app\.current_tenant/);
      cb(null);
    },
  };
  setTenantOnConnection(fakeConn, (err) => {
    assert.equal(err, null);
    done();
  }, '11111111-1111-1111-1111-111111111111');
});

test('setTenantOnConnection skips SET when tenantId is null', (t, done) => {
  const fakeConn = {
    query() {
      assert.fail('query should not be called when tenantId is null');
    },
  };
  setTenantOnConnection(fakeConn, (err, conn) => {
    assert.equal(err, null);
    assert.equal(conn, fakeConn);
    done();
  }, null);
});

test('setTenantOnConnection rejects malformed UUID', (t, done) => {
  const fakeConn = { query() { assert.fail('query should not be called for invalid UUID'); } };
  setTenantOnConnection(fakeConn, (err) => {
    assert.match(err.message, /invalid UUID/);
    done();
  }, 'not-a-uuid');
});
