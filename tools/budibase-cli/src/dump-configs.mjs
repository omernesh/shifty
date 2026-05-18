// Dump Budibase global config documents to learn their shapes before W0-02 patches them.
// Reads: /api/global/configs/<type> for known config types.
//
// Run from an ephemeral container in shifts-manager_default:
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools/budibase-cli:/cli \
//     node:22-alpine node /cli/src/dump-configs.mjs
//
// SECURITY NOTE (CR-01 fix, 2026-05-18):
//   Some config types (smtp, google, oidc) may contain cleartext
//   credentials in their `config` body — e.g., SMTP password, OAuth
//   client secret. This script deep-walks the JSON response and replaces
//   values of any key matching SECRET_KEYS with the literal "[REDACTED]"
//   before emitting. DO NOT commit the output to the repo.

import { login } from './login.mjs';

// Keys that may carry secrets in a Budibase config doc. Match is by exact
// key name (case-insensitive). Used by redactSecrets() below.
const SECRET_KEYS = new Set(['password', 'apikey', 'auth', 'token', 'clientsecret', 'secret', 'privatekey']);

function redactSecrets(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactSecrets(v);
  }
  return out;
}

const WORKER = process.env.BB_WORKER || 'http://budibase-worker:4003';
const APP_ID = process.env.BB_APP_ID || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const APP    = process.env.BB_APP || 'http://budibase-app:4002';

const { cookieHeader } = await login();
const H = { Cookie: cookieHeader, 'x-budibase-app-id': APP_ID, 'Content-Type': 'application/json' };

const out = { capturedAt: new Date().toISOString(), workerConfigs: {}, automations: null, users: null };

// 1) Probe global configs by type
for (const type of ['settings', 'account', 'google', 'oidc', 'password', 'company']) {
  try {
    const r = await fetch(`${WORKER}/api/global/configs/${type}`, { headers: H });
    if (r.status === 200) {
      const j = await r.json();
      out.workerConfigs[type] = j;
    } else {
      out.workerConfigs[type] = { _status: r.status, _text: (await r.text()).slice(0, 200) };
    }
  } catch (e) {
    out.workerConfigs[type] = { _error: e.message };
  }
}

// 2) Existing automations (per-app)
try {
  const r = await fetch(`${APP}/api/automations`, { headers: H });
  out.automations = r.status === 200 ? await r.json() : { _status: r.status, _text: (await r.text()).slice(0, 200) };
} catch (e) { out.automations = { _error: e.message }; }

// 3) Existing users — verify the admin record
try {
  const r = await fetch(`${WORKER}/api/global/users`, { headers: H });
  if (r.status === 200) {
    const users = await r.json();
    // Only return summary shape — DO NOT log password hashes / private fields
    out.users = users.map(u => ({
      _id: u._id, email: u.email,
      builder: u.builder, admin: u.admin, tenantId: u.tenantId,
      allKeys: Object.keys(u).sort(),
    }));
  } else {
    out.users = { _status: r.status, _text: (await r.text()).slice(0, 200) };
  }
} catch (e) { out.users = { _error: e.message }; }

// CR-01 fix: deep-redact secret-shaped keys before emitting. The users
// summary projection above already strips secrets per-user; redactSecrets
// is a defense-in-depth pass that also covers workerConfigs (smtp/google/
// oidc) and any future config types added to the probe loop.
console.log(JSON.stringify(redactSecrets(out), null, 2));
