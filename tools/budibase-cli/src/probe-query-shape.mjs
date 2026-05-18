// Probe: dump the live Baseline query and a freshly-CREATED test query to
// see the canonical `parameters` field shape.
import { BudibaseClient } from './client.mjs';

const APP_ID = 'app_dev_169e766804934fd18f2e20200d8fd22d';
const c = await BudibaseClient.connect({ appId: APP_ID });

console.log('=== live queries ===');
const live = await c.list('queries');
console.log(JSON.stringify(live, null, 2));

// Now create a query with parameters and see what comes back
const probe = {
  name: '_PROBE_PARAMS_DELETE_ME',
  datasourceId: 'datasource_plus_e5b3191da9eb4cb8854252f16a15367a',
  queryVerb: 'read',
  fields: { sql: 'SELECT :foo AS val' },
  parameters: [
    { name: 'foo', default: 'bar' },  // No "type" field
  ],
  schema: { val: { type: 'string', name: 'val' } },
  transformer: 'return data',
  readable: true,
};

try {
  const r = await c.createQuery(probe);
  console.log('=== created probe ===');
  console.log(JSON.stringify(r, null, 2));
  await c.deleteQuery(r._id, r._rev);
  console.log('cleaned up');
} catch (e) {
  console.error('create failed:', e.message, e.bodyText);
}
