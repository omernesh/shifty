// Diagnostic: what fields does Budibase's {{ Current User }} binding actually expose?
// Also cleanup any orphaned _W0_02_* queries from prior failed runs.

import { login } from './login.mjs';

const WORKER = process.env.BB_WORKER || 'http://budibase-worker:4003';
const APP    = process.env.BB_APP    || 'http://budibase-app:4002';
const APP_ID = process.env.BB_APP_ID || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const PG_DS  = process.env.BB_PG_DS  || 'datasource_plus_e5b3191da9eb4cb8854252f16a15367a';

const { cookieHeader } = await login();
const HA = { Cookie: cookieHeader, 'x-budibase-app-id': APP_ID, 'Content-Type': 'application/json' };
const HW = { Cookie: cookieHeader, 'Content-Type': 'application/json' };

// 1) Cleanup orphans from prior runs
console.log('=== Cleanup pass ===');
const qList = await (await fetch(`${APP}/api/queries`, { headers: HA })).json();
for (const q of qList) {
  if (q.name.startsWith('_W0_02') || q.name.startsWith('_SPIKE_') || q.name.startsWith('_SMOKE_') || q.name === '_BINDING_DIAG') {
    const r = await fetch(`${APP}/api/queries/${q._id}/${q._rev}`, { method: 'DELETE', headers: HA });
    console.log(`  delete ${q.name} (${q._id}): HTTP ${r.status}`);
  }
}

// 2) Diagnose: try multiple bindings to see what resolves
const diags = [
  { binding: '{{ Current User.email }}',           expect: 'admin email' },
  { binding: '{{ Current User._id }}',             expect: 'us_b08...' },
  { binding: '{{ Current User.tenantId }}',        expect: '"default" (Budibase workspace tenant)' },
  { binding: '{{ Current User.shiftyTenantId }}',  expect: 'UUID we just patched, IF schemaless resolves' },
  { binding: '{{ Current User.builder.global }}',  expect: 'true / nested-access support' },
  { binding: '{{ Current User.firstName }}',       expect: 'first name if set, else empty' },
];

const sqlConcat = diags.map((d, i) => `'${d.binding}' AS field_${i}`).join(', ');
const diagQuery = {
  name: '_BINDING_DIAG',
  datasourceId: PG_DS,
  fields: { sql: `SELECT ${sqlConcat};` },
  queryVerb: 'read',
  parameters: [],
  schema: Object.fromEntries(diags.map((_, i) => [`field_${i}`, { type: 'string', name: `field_${i}` }])),
  transformer: 'return data',
  readable: true,
};

const c = await fetch(`${APP}/api/queries`, { method: 'POST', headers: HA, body: JSON.stringify(diagQuery) });
if (c.status !== 200) { console.error('create diag failed:', c.status, await c.text()); process.exit(2); }
const created = await c.json();
try {
  const ex = await fetch(`${APP}/api/queries/${created._id}`, { method: 'POST', headers: HA, body: JSON.stringify({ parameters: {} }) });
  console.log(`\n=== Diagnostic query result (HTTP ${ex.status}) ===`);
  const result = await ex.json();
  if (Array.isArray(result) && result[0]) {
    const row = result[0];
    diags.forEach((d, i) => {
      console.log(`  ${d.binding.padEnd(45)} → ${JSON.stringify(row[`field_${i}`])}`);
    });
  } else {
    console.log('  unexpected result:', JSON.stringify(result).slice(0, 500));
  }
} finally {
  // Cleanup
  await fetch(`${APP}/api/queries/${created._id}/${created._rev}`, { method: 'DELETE', headers: HA });
  console.log('\n  diag query cleaned up');
}

// 3) Probe for hidden customUserSchema endpoints
console.log('\n=== Probe for customUserSchema-related endpoints ===');
const probePaths = [
  '/api/global/users/customAttributes',
  '/api/global/users/schema',
  '/api/global/users/customSchema',
  '/api/global/configs/customUserSchema',
  '/api/admin/customUserSchema',
  '/api/global/customUserSchema',
];
for (const p of probePaths) {
  const r = await fetch(`${WORKER}${p}`, { headers: HW });
  console.log(`  GET ${p.padEnd(45)} → ${r.status}`);
}
