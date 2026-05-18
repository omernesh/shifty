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

const WORKER = process.env.BB_WORKER || 'http://budibase-worker:4003';
// Sentinel tenant — replace with a real tenant UUID once tenants are provisioned (Phase 3+ work).
const SENTINEL_TENANT = process.env.BB_SHIFTY_TENANT_ID || '00000000-0000-0000-0000-000000000001';

const { cookieHeader } = await login();
const HW = { Cookie: cookieHeader, 'Content-Type': 'application/json' };
// Note (CR-03 fix): APP_URL/APP_ID/PG_DS were used by the removed step-4
// binding test. They are no longer referenced by this script.

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

// 4) Step REMOVED (CR-03 fix, 2026-05-18).
// The W0-02 spike conclusively proved that {{ Current User.* }} bindings
// resolve to null when queries are executed via POST /api/queries/<id>
// (the Builder API path). End-to-end binding verification has to happen
// at published-app runtime (deferred to Phase 3 W1+). See
// tools/budibase-cli/SPIKE-FINDINGS.md for the full analysis.

console.log(`\n[4] SKIPPED — binding test against the Builder API is known to return null`);
console.log(`     for {{ Current User.* }} bindings (see SPIKE-FINDINGS.md). Verify the`);
console.log(`     binding resolves by visiting the published app at /app/<slug> and`);
console.log(`     observing the value in a Builder UI data binding preview.`);

console.log(`\n✅ apply-tenantid.mjs DONE — admin's shiftyTenantId = ${SENTINEL_TENANT} (binding test deferred to runtime).`);
