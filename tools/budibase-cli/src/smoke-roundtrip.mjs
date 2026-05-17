// Smoke test: prove the Internal API supports full CRUD by creating a
// disposable query, executing it, and deleting it. Leaves the app
// exactly as it was found.
//
// Run from an ephemeral container in shifts-manager_default:
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools/budibase-cli:/cli \
//     node:22-alpine node /cli/src/smoke-roundtrip.mjs <appId> <pgDatasourceId>
//
// Exits non-zero on any step failure so CI can pick it up.

import { BudibaseClient } from './client.mjs';

const APP_ID = process.argv[2];
const PG_DS  = process.argv[3];
if (!APP_ID || !PG_DS) {
  console.error('Usage: smoke-roundtrip.mjs <appId> <pgDatasourceId>');
  process.exit(1);
}

const c = await BudibaseClient.connect({ appId: APP_ID });

const probe = {
  name: '_SMOKE_DELETE_ME',
  datasourceId: PG_DS,
  fields: { sql: "SELECT 'smoke ok' AS msg, now() AS ts;" },
  queryVerb: 'read',
  parameters: [],
  schema: { msg: { type: 'string', name: 'msg' }, ts: { type: 'string', name: 'ts' } },
  transformer: 'return data',
  readable: true,
};

let created;
try {
  console.log('[1/4] CREATE…');
  created = await c.createQuery(probe);
  console.log(`     OK _id=${created._id}`);

  console.log('[2/4] READBACK…');
  const list = await c.list('queries');
  if (!list.find(q => q._id === created._id)) throw new Error('not in list after create');
  console.log('     OK appears in /api/queries');

  console.log('[3/4] EXECUTE…');
  const result = await c.executeQuery(created._id);
  if (!Array.isArray(result) || result[0]?.msg !== 'smoke ok') {
    throw new Error(`unexpected result: ${JSON.stringify(result).slice(0, 200)}`);
  }
  console.log(`     OK result=${JSON.stringify(result)}`);
} finally {
  if (created?._id && created?._rev) {
    console.log('[4/4] DELETE…');
    try {
      await c.deleteQuery(created._id, created._rev);
      console.log('     OK cleaned up');
    } catch (e) {
      console.error(`     CLEANUP FAILED — manual delete needed: ${e.message}`);
      process.exit(2);
    }
  }
}

console.log('\nSPIKE ROUNDTRIP: PASS');
