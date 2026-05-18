// Probe: attempt to execute a Layer-2-filtered query against the PUBLISHED
// app's /api/v2/queries/<id> endpoint to see whether {{ Current User.shiftyTenantId }}
// resolves to anything. This is the spike that SPIKE-BINDINGS.md "Forward Path A"
// left open.
import { login } from './login.mjs';

const PUB_APP_ID = 'app_169e766804934fd18f2e20200d8fd22d';
const DEV_APP_ID = 'app_dev_169e766804934fd18f2e20200d8fd22d';
const APP_URL = process.env.BB_APP || 'http://budibase-app:4002';

const { cookieHeader } = await login({});

async function exec(appId, queryName) {
  // Find the query _id in this app's queries list
  const list = await fetch(`${APP_URL}/api/queries`, {
    headers: { Cookie: cookieHeader, 'x-budibase-app-id': appId, 'Content-Type': 'application/json' },
  }).then(r => r.json());
  const q = list.find(x => x.name === queryName);
  if (!q) {
    console.log(`  no query "${queryName}" in app ${appId}`);
    return;
  }
  console.log(`  query _id: ${q._id} (verb: ${q.queryVerb})`);

  // Try v2 published endpoint
  for (const path of [`/api/v2/queries/${q._id}`, `/api/queries/${q._id}`]) {
    const r = await fetch(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'x-budibase-app-id': appId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: {} }),
    });
    const body = await r.text();
    console.log(`  ${path}: HTTP ${r.status}, body: ${body.slice(0, 400)}`);
  }
}

console.log('=== role-tag-list — published app ===');
await exec(PUB_APP_ID, 'role-tag-list');
console.log('\n=== role-tag-list — dev app ===');
await exec(DEV_APP_ID, 'role-tag-list');
console.log('\n=== team-list — published app ===');
await exec(PUB_APP_ID, 'team-list');
