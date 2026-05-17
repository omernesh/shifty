// Dump current app state as JSON. Useful for inspection + as the basis
// for future apply.mjs (diff JSON-on-disk vs JSON-in-Builder-UI).
//
// Usage (from a node:22-alpine container in shifts-manager_default):
//   docker run --rm --network shifts-manager_default \
//     -e BB_EMAIL=... -e BB_PASSWORD=... \
//     -v $(pwd)/tools/budibase-cli:/cli \
//     node:22-alpine node /cli/src/dump.mjs <appId> > snapshot.json

import { BudibaseClient } from './client.mjs';

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

console.log(JSON.stringify({ appId: APP_ID, capturedAt: new Date().toISOString(), ...dump }, null, 2));
