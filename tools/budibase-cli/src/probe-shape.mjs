// Probe script: log in + fetch a few key resource shapes for SCREEN-SHAPE.md.
// Run from hpg5 in an ephemeral node:22-alpine container.
import { login } from './login.mjs';

const APP_ID = process.argv[2] || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const APP_URL = process.env.BB_APP || 'http://budibase-app:4002';

const { cookieHeader } = await login({});

const _headers = {
  'Cookie': cookieHeader,
  'x-budibase-app-id': APP_ID,
  'Content-Type': 'application/json',
};

async function get(path) {
  const r = await fetch(`${APP_URL}${path}`, { headers: _headers });
  const t = await r.text();
  return { status: r.status, body: t };
}

const out = {};
for (const path of [
  '/api/workspaceApp',
  '/api/screens',
  '/api/roles',
  `/api/applications/${APP_ID}`,
  '/api/applications?status=all',
  '/api/datasources',
]) {
  const r = await get(path);
  let parsed = r.body;
  try {
    const j = JSON.parse(r.body);
    parsed = JSON.stringify(j, null, 2);
  } catch {}
  out[path] = { status: r.status, body: parsed.length > 4000 ? parsed.slice(0, 4000) + '\n... [truncated]' : parsed };
}

console.log(JSON.stringify(out, null, 2));
