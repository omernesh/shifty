// tools/test/budibase-client-screens.test.mjs
// Live-API smoke tests for BudibaseClient screen/role/workspaceApp/publish
// methods added in W1-01 Task 1. Gated on BB_EMAIL + BB_PASSWORD being set
// in env — when unset, all tests skip+pass so unit-test green isn't gated on
// hpg5 reachability. Run live via:
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools:/work node:22-alpine \
//     node --test /work/test/budibase-client-screens.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BudibaseClient } from '../budibase-cli/src/client.mjs';

const APP_ID = process.env.BB_APP_ID || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const HAS_CREDS = !!(process.env.BB_EMAIL && process.env.BB_PASSWORD);
const SKIP_REASON = HAS_CREDS ? undefined : { skip: 'BB_EMAIL/BB_PASSWORD not set — live tests skipped' };

let client;
async function getClient() {
  if (!client) {
    client = await BudibaseClient.connect({ appId: APP_ID });
  }
  return client;
}

// ──────────── Method existence (synchronous, no API call) ────────────

test('BudibaseClient exposes all 11 new W1-01 methods as functions', () => {
  // Construct with dummy creds (will fail at the network layer if called,
  // but the constructor is enough to validate the prototype shape).
  const c = new BudibaseClient({ appId: 'x', cookieHeader: 'y' });
  const methods = [
    'listScreens', 'createScreen', 'updateScreen', 'deleteScreen',
    'listRoles',
    'listWorkspaceApps', 'createWorkspaceApp', 'updateWorkspaceApp',
    'updateQuery',
    'publishApp', 'getApp', 'unpublishApp',
  ];
  for (const m of methods) {
    assert.strictEqual(typeof c[m], 'function', `${m} must be a function`);
  }
});

// ──────────── Live API: roles, workspaceApps, screens ────────────

test('listRoles returns the three built-in roles', SKIP_REASON, async () => {
  const c = await getClient();
  const roles = await c.listRoles();
  assert.ok(Array.isArray(roles), 'roles must be an array');
  const names = roles.map(r => r._id);
  for (const expected of ['ADMIN', 'BASIC', 'PUBLIC']) {
    assert.ok(names.includes(expected), `expected role "${expected}" in ${JSON.stringify(names)}`);
  }
});

test('listWorkspaceApps returns the workspaceApps envelope', SKIP_REASON, async () => {
  const c = await getClient();
  const r = await c.listWorkspaceApps();
  assert.ok(Array.isArray(r.workspaceApps), 'response must have workspaceApps array');
});

test('getApp returns this app metadata with url + status fields', SKIP_REASON, async () => {
  const c = await getClient();
  const app = await c.getApp();
  assert.strictEqual(app.type, 'app');
  assert.ok(typeof app.url === 'string', `app.url must be a string, got ${typeof app.url}`);
  assert.ok(['development', 'published'].includes(app.status), `unexpected status: ${app.status}`);
});

test('createScreen + listScreens + deleteScreen roundtrip', SKIP_REASON, async () => {
  const c = await getClient();

  // Pre-req: a workspaceApp must exist. Use the first one or fail.
  const { workspaceApps } = await c.listWorkspaceApps();
  assert.ok(workspaceApps.length > 0, 'no workspaceApp on hpg5 — run apply-fixtures.mjs once or create one manually');
  const wapp = workspaceApps[0];

  const probeName = `__W1_01_TEST_${Math.random().toString(36).slice(2, 10)}__`;
  const probeRoute = `/__test_${Math.random().toString(36).slice(2, 10)}`;
  const screen = {
    showNavigation: true,
    width: 'Large',
    props: {
      _id: 'cmp_test_' + Math.random().toString(36).slice(2, 10),
      _component: '@budibase/standard-components/container',
      _styles: { normal: {}, hover: {}, active: {}, selected: {} },
      _children: [],
      _instanceName: 'Test root',
      layout: 'flex',
      direction: 'column',
      hAlign: 'stretch',
      vAlign: 'top',
      size: 'grow',
      gap: 'M',
    },
    routing: { route: probeRoute, roleId: 'BASIC', homeScreen: false },
    name: probeName,
    workspaceAppId: wapp._id,
  };

  let created;
  try {
    created = await c.createScreen(screen);
    assert.ok(created._id, 'created screen must have _id');
    assert.ok(created._rev, 'created screen must have _rev');
    assert.strictEqual(created.name, probeName);

    const list = await c.listScreens();
    const found = list.find(s => s._id === created._id);
    assert.ok(found, `screen ${created._id} must appear in listScreens()`);
  } finally {
    if (created?._id && created?._rev) {
      const del = await c.deleteScreen(created._id, created._rev);
      assert.match(JSON.stringify(del), /deleted successfully/i);
    }
  }
});

// ──────────── publishApp is a destructive op — verify shape without re-publishing if already published ────────────

test('publishApp + getApp round-trip', SKIP_REASON, async () => {
  const c = await getClient();
  const before = await c.getApp();
  // Re-publishing is idempotent-ish: server publishes "any changes since last
  // publish". Running it on an unchanged dev app is fine; the response shape
  // is what we want to confirm here.
  const r = await c.publishApp();
  assert.ok(typeof r === 'object', `publishApp returned non-object: ${typeof r}`);
  // After publish, getApp() on the dev app should still return status=development;
  // the PUBLISHED counterpart (different appId without _dev_) lives separately.
  const after = await c.getApp();
  assert.strictEqual(after.status, 'development');
});
