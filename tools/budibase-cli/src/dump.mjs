// Dump current app state as JSON. Useful for inspection + as the basis
// for future apply.mjs (diff JSON-on-disk vs JSON-in-Builder-UI).
//
// Usage (from a node:22-alpine container in shifts-manager_default):
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools/budibase-cli:/cli \
//     node:22-alpine node /cli/src/dump.mjs <appId> > snapshot.json
//
// SECURITY NOTE (CR-01 fix, 2026-05-18):
//   The Internal API returns datasource `config` objects with cleartext
//   credentials (e.g., the Postgres datasource includes the `password`
//   used to connect to Shifty's business-data DB — i.e., `POSTGRES_PASSWORD`
//   from hpg5's .env). This script redacts known-secret keys from
//   `datasources[*].config` before stringifying so the resulting snapshot
//   never contains cleartext credentials. Even so, DO NOT commit
//   `snapshot.json` to the repo — the README pattern for these scripts
//   includes the file in a developer's working tree and `.gitignore`
//   should keep it out of version control.

import { BudibaseClient } from './client.mjs';

// Keys that may contain secrets in a datasource `config` object. Replace
// any matching value with the literal sentinel "[REDACTED]" so the JSON
// shape stays valid for downstream tooling (diff, schema introspection).
const SECRET_CONFIG_KEYS = new Set(['password', 'apiKey', 'auth', 'token']);

function redactDatasourceConfig(ds) {
  if (!ds || typeof ds !== 'object' || !ds.config || typeof ds.config !== 'object') return ds;
  const redactedConfig = {};
  for (const [k, v] of Object.entries(ds.config)) {
    redactedConfig[k] = SECRET_CONFIG_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return { ...ds, config: redactedConfig };
}

const APP_ID = process.argv[2];
if (!APP_ID) { console.error('Usage: dump.mjs <appId>'); process.exit(1); }

const c = await BudibaseClient.connect({ appId: APP_ID });

const dump = {};
for (const resource of ['datasources', 'screens', 'automations', 'queries', 'tables', 'roles']) {
  try {
    dump[resource] = await c.list(resource);
  } catch (e) {
    dump[resource] = { error: e.message };
  }
}

// Scrub secret fields from datasource configs before emitting. See SECURITY
// NOTE at the top of this file.
if (Array.isArray(dump.datasources)) {
  dump.datasources = dump.datasources.map(redactDatasourceConfig);
}

// WR-02 (2026-05-18): if any resource fetch failed, surface a clear stderr
// warning and exit non-zero. The dump JSON is still emitted to stdout so
// operators can inspect what survived, but `set -e` callers see the
// failure rather than silently treating a partial dump as success.
const errored = Object.entries(dump).filter(
  ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.error === 'string'
);

console.log(JSON.stringify({ appId: APP_ID, capturedAt: new Date().toISOString(), ...dump }, null, 2));

if (errored.length > 0) {
  console.error(`dump.mjs: ${errored.length} resource(s) failed: ${errored.map(([k]) => k).join(', ')}`);
  process.exit(3);
}
