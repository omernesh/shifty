// Cookie-auth login for the Budibase Internal API.
//
// Reads BB_EMAIL + BB_PASSWORD from env. Returns a Cookie header string
// that all downstream Internal API calls must include.
//
// Endpoint discovery: Builder UI uses POST /api/global/auth/default/login
// with the field `username` (not `email` — CE 3.38.4 specific). On 200,
// the response sets cookies `budibase:auth` + `budibase:auth.sig`.
//
// Verified 2026-05-17 against shifty-budibase-worker:4003 on the
// shifts-manager_default network.

const DEFAULT_WORKER = process.env.BB_WORKER || 'http://budibase-worker:4003';

export async function login({ worker = DEFAULT_WORKER, username, password } = {}) {
  username ||= process.env.BB_EMAIL;
  password ||= process.env.BB_PASSWORD;
  if (!username || !password) {
    throw new Error('login: username/password required (or set BB_EMAIL/BB_PASSWORD)');
  }
  const r = await fetch(`${worker}/api/global/auth/default/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) {
    const body = await r.text().catch(() => '<no body>');
    throw new Error(`login: HTTP ${r.status} — ${body}`);
  }
  const setCookies = r.headers.getSetCookie();
  if (!setCookies?.length) throw new Error('login: no Set-Cookie returned despite 200');
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  return { cookieHeader, setCookies };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('login.mjs')) {
  // CLI smoke-test mode: prove login works, print cookie names (not values).
  const { setCookies } = await login();
  console.log(`OK: ${setCookies.length} cookie(s) returned —`,
    setCookies.map(c => c.split('=')[0]).join(', '));
}
