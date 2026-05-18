// W0-02 Task 2 — populate admin user's shiftyTenantId + verify the {{ Current User.shiftyTenantId }} binding.
//
// User docs in Budibase 3.38.4 CE are schemaless (verified 2026-05-18 via dump-configs.mjs):
// no `customUserSchema` config doc type exists. So we just PATCH `shiftyTenantId` on the
// user record and trust Budibase's binding resolver to expose the field.
//
// Idempotent: re-running this script when shiftyTenantId is already set produces no diff.
//
// Run from an ephemeral container in shifts-manager_default:
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools/budibase-cli:/cli \
//     node:22-alpine node /cli/src/apply-tenantid.mjs

import { login } from './login.mjs';

const WORKER  = process.env.BB_WORKER  || 'http://budibase-worker:4003';
const APP_URL = process.env.BB_APP     || 'http://budibase-app:4002';
const APP_ID  = process.env.BB_APP_ID  || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const PG_DS   = process.env.BB_PG_DS   || 'datasource_plus_e5b3191da9eb4cb8854252f16a15367a';
// Sentinel tenant — replace with a real tenant UUID once tenants are provisioned (Phase 3+ work).
const SENTINEL_TENANT = process.env.BB_SHIFTY_TENANT_ID || '00000000-0000-0000-0000-000000000001';

const { cookieHeader } = await login();
const HW = { Cookie: cookieHeader, 'Content-Type': 'application/json' };
const HA = { Cookie: cookieHeader, 'x-budibase-app-id': APP_ID, 'Content-Type': 'application/json' };

// 1) Find the admin user (matches BB_EMAIL)
const adminEmail = process.env.BB_EMAIL;
const usersResp = await fetch(`${WORKER}/api/global/users`, { headers: HW });
if (usersResp.status !== 200) { console.error(`[1] list users HTTP ${usersResp.status}`); process.exit(2); }
const users = await usersResp.json();
const me = users.find(u => u.email === adminEmail);
if (!me) { console.error(`[1] admin user with email ${adminEmail} not found`); process.exit(2); }
console.log(`[1] admin user: ${me._id}, rev=${me._rev}, current shiftyTenantId=${JSON.stringify(me.shiftyTenantId)}`);

// 2) Idempotency check
let patchedUser = me;
if (me.shiftyTenantId === SENTINEL_TENANT) {
  console.log(`[2] idempotent — shiftyTenantId already = ${SENTINEL_TENANT}, skipping PATCH`);
} else {
  // Budibase user-patch shape: POST /api/global/users with the full updated doc body
  const patch = { ...me, shiftyTenantId: SENTINEL_TENANT };
  const r = await fetch(`${WORKER}/api/global/users`, {
    method: 'POST', headers: HW,
    body: JSON.stringify(patch),
  });
  if (r.status < 200 || r.status >= 300) {
    const txt = await r.text();
    console.error(`[2] PATCH user HTTP ${r.status} — ${txt.slice(0, 400)}`);
    process.exit(2);
  }
  const result = await r.json();
  console.log(`[2] PATCH OK — new rev=${result._rev || '(in body)'}`);
  patchedUser = result;
}

// 3) Verify round-trip via fresh GET
const verifyResp = await fetch(`${WORKER}/api/global/users/${me._id}`, { headers: HW });
if (verifyResp.status !== 200) { console.error(`[3] GET user HTTP ${verifyResp.status}`); process.exit(2); }
const verifyUser = await verifyResp.json();
if (verifyUser.shiftyTenantId !== SENTINEL_TENANT) {
  console.error(`[3] round-trip FAILED — expected ${SENTINEL_TENANT}, got ${JSON.stringify(verifyUser.shiftyTenantId)}`);
  process.exit(3);
}
console.log(`[3] round-trip OK — shiftyTenantId=${verifyUser.shiftyTenantId}`);

// 4) Binding test — create disposable query, execute as the admin, assert {{ Current User.shiftyTenantId }} resolves
const testQuery = {
  name: '_W0_02_BINDING_TEST_DELETE_ME',
  datasourceId: PG_DS,
  fields: { sql: "SELECT '{{ Current User.shiftyTenantId }}'::uuid AS resolved;" },
  queryVerb: 'read',
  parameters: [],
  schema: { resolved: { type: 'string', name: 'resolved' } },
  transformer: 'return data',
  readable: true,
};
const createR = await fetch(`${APP_URL}/api/queries`, { method: 'POST', headers: HA, body: JSON.stringify(testQuery) });
if (createR.status !== 200) { console.error(`[4a] create binding-test query HTTP ${createR.status} — ${await createR.text()}`); process.exit(4); }
const created = await createR.json();
console.log(`[4a] created binding-test query: ${created._id}`);

try {
  const execR = await fetch(`${APP_URL}/api/queries/${created._id}`, { method: 'POST', headers: HA, body: JSON.stringify({ parameters: {} }) });
  if (execR.status !== 200) { console.error(`[4b] execute HTTP ${execR.status} — ${await execR.text()}`); process.exit(4); }
  const result = await execR.json();
  const resolved = Array.isArray(result) && result[0]?.resolved;
  if (resolved === SENTINEL_TENANT) {
    console.log(`[4b] BINDING TEST PASS — {{ Current User.shiftyTenantId }} resolved to ${resolved}`);
  } else {
    console.error(`[4b] BINDING TEST FAIL — got ${JSON.stringify(result)}`);
    console.error(`     This means {{ Current User.shiftyTenantId }} does NOT resolve from a schemaless field.`);
    console.error(`     A separate declaration mechanism (or different field name strategy) is needed.`);
    process.exit(5);
  }
} finally {
  // Cleanup the binding-test query
  const delR = await fetch(`${APP_URL}/api/queries/${created._id}/${created._rev}`, { method: 'DELETE', headers: HA });
  if (delR.status === 200) console.log(`[4c] cleanup OK`);
  else console.error(`[4c] cleanup FAILED HTTP ${delR.status} — manual delete needed for ${created._id}`);
}

console.log(`\n✅ apply-tenantid.mjs DONE — admin's shiftyTenantId = ${SENTINEL_TENANT}, binding verified.`);
