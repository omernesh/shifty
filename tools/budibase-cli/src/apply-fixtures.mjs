// tools/budibase-cli/src/apply-fixtures.mjs
//
// Idempotent applier — reads JSON fixtures from fixtures/queries/ and
// fixtures/screens/ and applies them to the live Builder app via the
// Internal API. On second run, every fixture should report UNCHANGED.
//
// Matching rules:
//   - Queries match by `name` (the canonical identity)
//   - Screens match by `routing.route` (the URL-stable identity)
//   - Workspace apps match by `name`
//
// Outcomes:
//   - CREATED   — fixture name (or route) not present on server → POST without _id/_rev
//   - UNCHANGED — server payload equals fixture (modulo ignored fields) → no API call
//   - UPDATED   — same name/route but content drift → POST with _id/_rev injected from live copy
//
// Never deletes — leaves the Builder UI as a legitimate ad-hoc authoring
// surface for one-offs that aren't tracked as fixtures.
//
// Pre-requisite: a workspaceApp must exist on the target app. The applier
// auto-creates one named "Shifty" (url "/") if listWorkspaceApps() comes
// back empty. The chosen workspaceApp's _id is INJECTED into every screen
// fixture at apply time (so fixtures don't need to hardcode the _id, which
// would drift across deploys).
//
// Screens reference queries by NAME in their dataSource.label / dataSource.tableId
// placeholders. At apply time, every occurrence of the literal string
// "{{query:NAME}}" inside a screen JSON is replaced with the live query _id
// for "NAME" (or 400-error if not found).
//
// CLI usage:
//   node src/apply-fixtures.mjs [--dry-run]
//
// Env:
//   BB_EMAIL, BB_PASSWORD            — required
//   BB_APP_ID                        — defaults to the canonical dev app ID
//   BB_FIXTURES                      — defaults to ./fixtures (relative to script)
//   BB_WORKSPACE_APP_NAME            — defaults to "Shifty"

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BudibaseClient } from './client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ID = 'app_dev_169e766804934fd18f2e20200d8fd22d';
const FIXTURES_ROOT = process.env.BB_FIXTURES || join(__dirname, '..', 'fixtures');
const WORKSPACE_APP_NAME = process.env.BB_WORKSPACE_APP_NAME || 'Shifty';
const DRY_RUN = process.argv.includes('--dry-run');

// Fields the server adds / mutates that must be excluded when diffing
// fixture-on-disk vs live copy for "exact match" detection.
const IGNORED_FIELDS_TOP = new Set([
  '_id', '_rev', 'createdAt', 'updatedAt', 'pluginAdded',
]);

function stripIgnored(o) {
  if (Array.isArray(o)) return o.map(stripIgnored);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (IGNORED_FIELDS_TOP.has(k)) continue;
      out[k] = stripIgnored(v);
    }
    return out;
  }
  return o;
}

function deepEqual(a, b) {
  return JSON.stringify(stripIgnored(a)) === JSON.stringify(stripIgnored(b));
}

function loadFixtures(subdir) {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      path: join(dir, f),
      data: JSON.parse(readFileSync(join(dir, f), 'utf-8')),
    }));
}

// Replace {{query:NAME}} placeholders inside a screen body with live query _ids.
function resolveQueryRefs(node, queryIdByName) {
  if (typeof node === 'string') {
    return node.replace(/\{\{query:([a-zA-Z0-9_-]+)\}\}/g, (_, name) => {
      const id = queryIdByName.get(name);
      if (!id) throw new Error(`apply-fixtures: screen references unknown query "${name}". Add the query fixture first.`);
      return id;
    });
  }
  if (Array.isArray(node)) return node.map((x) => resolveQueryRefs(x, queryIdByName));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveQueryRefs(v, queryIdByName);
    return out;
  }
  return node;
}

async function ensureWorkspaceApp(client) {
  const { workspaceApps } = await client.listWorkspaceApps();
  let existing = workspaceApps.find((w) => w.name === WORKSPACE_APP_NAME);
  if (!existing && workspaceApps.length > 0) {
    // Prefer a name match, but fall back to the first one if the name doesn't exist yet.
    existing = workspaceApps[0];
    console.log(`  workspaceApp "${WORKSPACE_APP_NAME}" not found — using existing "${existing.name}" (${existing._id})`);
  }
  if (!existing) {
    if (DRY_RUN) {
      console.log(`  DRY-RUN: would CREATE workspaceApp "${WORKSPACE_APP_NAME}"`);
      return { _id: 'dry-run-workspace-app-id', name: WORKSPACE_APP_NAME };
    }
    const r = await client.createWorkspaceApp({ name: WORKSPACE_APP_NAME, url: '/' });
    existing = r.workspaceApp;
    console.log(`  CREATED workspaceApp "${existing.name}" (${existing._id})`);
  } else {
    console.log(`  Using workspaceApp "${existing.name}" (${existing._id})`);
  }
  return existing;
}

async function applyQueries(client) {
  const fixtures = loadFixtures('queries');
  if (fixtures.length === 0) {
    console.log('No query fixtures found.');
    return new Map();
  }

  const live = await client.list('queries');
  const liveByName = new Map(live.map((q) => [q.name, q]));

  let created = 0, unchanged = 0, updated = 0;
  const queryIdByName = new Map();

  for (const { file, data: spec } of fixtures) {
    // Sanity: file basename should match spec.name (catches rename mistakes early).
    const expectedBase = `${spec.name}.json`;
    if (basename(file) !== expectedBase) {
      console.warn(`  WARN: filename "${file}" does not match spec.name "${spec.name}" (expected ${expectedBase})`);
    }

    const liveCopy = liveByName.get(spec.name);
    if (!liveCopy) {
      if (DRY_RUN) {
        console.log(`  DRY-RUN: would CREATE query "${spec.name}"`);
        queryIdByName.set(spec.name, `dry-run-query-${spec.name}`);
        created++;
        continue;
      }
      const r = await client.createQuery(spec);
      console.log(`  CREATED query "${spec.name}" → ${r._id}`);
      queryIdByName.set(spec.name, r._id);
      created++;
    } else if (deepEqual(spec, liveCopy)) {
      console.log(`  UNCHANGED query "${spec.name}" (${liveCopy._id})`);
      queryIdByName.set(spec.name, liveCopy._id);
      unchanged++;
    } else {
      if (DRY_RUN) {
        console.log(`  DRY-RUN: would UPDATE query "${spec.name}" (drift detected)`);
        queryIdByName.set(spec.name, liveCopy._id);
        updated++;
        continue;
      }
      const updateBody = { ...spec, _id: liveCopy._id, _rev: liveCopy._rev };
      const r = await client.updateQuery(updateBody);
      console.log(`  UPDATED query "${spec.name}" → ${r._id} (was ${liveCopy._rev})`);
      queryIdByName.set(spec.name, r._id);
      updated++;
    }
  }

  console.log(`  Queries: ${created} created, ${updated} updated, ${unchanged} unchanged`);
  return queryIdByName;
}

async function applyScreens(client, workspaceAppId, queryIdByName) {
  const fixtures = loadFixtures('screens');
  if (fixtures.length === 0) {
    console.log('No screen fixtures found.');
    return;
  }

  const live = await client.listScreens();
  const liveByRoute = new Map();
  for (const s of live) {
    const key = `${s.routing?.route ?? ''}@${s.routing?.roleId ?? ''}@${s.workspaceAppId ?? ''}`;
    liveByRoute.set(key, s);
  }

  let created = 0, unchanged = 0, updated = 0;

  for (const { file, data: rawSpec } of fixtures) {
    // 1. Inject the resolved workspaceAppId (fixtures use a placeholder).
    let spec = JSON.parse(
      JSON.stringify(rawSpec).replace(/"\{\{workspaceAppId\}\}"/g, JSON.stringify(workspaceAppId))
    );
    // 2. Resolve {{query:NAME}} placeholders → live query _ids.
    spec = resolveQueryRefs(spec, queryIdByName);

    const key = `${spec.routing?.route}@${spec.routing?.roleId}@${spec.workspaceAppId}`;
    const liveCopy = liveByRoute.get(key);

    if (!liveCopy) {
      if (DRY_RUN) {
        console.log(`  DRY-RUN: would CREATE screen "${spec.name}" @ ${spec.routing.route}`);
        created++;
        continue;
      }
      const r = await client.createScreen(spec);
      console.log(`  CREATED screen "${spec.name}" @ ${spec.routing.route} → ${r._id}`);
      created++;
    } else if (deepEqual(spec, liveCopy)) {
      console.log(`  UNCHANGED screen "${spec.name}" @ ${spec.routing.route} (${liveCopy._id})`);
      unchanged++;
    } else {
      if (DRY_RUN) {
        console.log(`  DRY-RUN: would UPDATE screen "${spec.name}" @ ${spec.routing.route} (drift detected)`);
        updated++;
        continue;
      }
      const updateBody = { ...spec, _id: liveCopy._id, _rev: liveCopy._rev };
      const r = await client.updateScreen(updateBody);
      console.log(`  UPDATED screen "${spec.name}" @ ${spec.routing.route} → ${r._id}`);
      updated++;
    }
  }

  console.log(`  Screens: ${created} created, ${updated} updated, ${unchanged} unchanged`);
}

async function main() {
  if (!process.env.BB_EMAIL || !process.env.BB_PASSWORD) {
    console.error('apply-fixtures: BB_EMAIL and BB_PASSWORD env vars are required.');
    process.exit(2);
  }
  const appId = process.env.BB_APP_ID || DEFAULT_APP_ID;
  console.log(`apply-fixtures: app=${appId} fixtures=${FIXTURES_ROOT} ${DRY_RUN ? '[DRY RUN]' : ''}`);
  const client = await BudibaseClient.connect({ appId });

  console.log('\n[1/3] Ensure workspaceApp ...');
  const wapp = await ensureWorkspaceApp(client);

  console.log('\n[2/3] Apply queries ...');
  const queryIdByName = await applyQueries(client);

  console.log('\n[3/3] Apply screens ...');
  await applyScreens(client, wapp._id, queryIdByName);

  console.log('\napply-fixtures: DONE');
}

main().catch((err) => {
  console.error('apply-fixtures: FAILED');
  console.error(err?.stack ?? err);
  if (err?.bodyText) console.error('  body:', err.bodyText);
  process.exit(1);
});
