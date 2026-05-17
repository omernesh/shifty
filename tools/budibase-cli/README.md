# `tools/budibase-cli/`

Minimal client for the Budibase **Internal** API — the same JSON HTTP surface the Builder UI itself uses. Lets headless agents enumerate, create, and modify apps without clicking anything.

> **Why this exists:** Before this scaffold, the project's working assumption was "Builder UI is the only way to author Budibase apps" (see CLAUDE.md / BUDIBASE-CONVENTIONS.md, soon updated). The 2026-05-17 spike proved that assumption wrong. See [`SPIKE-FINDINGS.md`](./SPIKE-FINDINGS.md) for the full reverse-engineering record.

## Status

- ✅ Cookie-auth login → proven
- ✅ Enumerate datasources / screens / automations / queries / tables / roles → proven
- ✅ Query CRUD + execute roundtrip → proven (`npm run smoke`)
- ⏳ Screen / automation / datasource CRUD → endpoints reachable, payload shapes not yet documented here
- ⏳ User-schema custom-field mutation → endpoints reachable, not yet exercised
- ⏳ `apply.mjs` for git-tracked JSON → next iteration

## Quick start

Requires the live hpg5 stack and access to the `shifts-manager_default` Docker network (any node:22-alpine container joins it).

```bash
# Smoke test — proves the full roundtrip works end-to-end against the live stack
docker run --rm --network shifts-manager_default \
  -e BB_EMAIL=<email> -e BB_PASSWORD=<pw> \
  -v "$(pwd)/tools/budibase-cli:/cli" \
  node:22-alpine node /cli/src/smoke-roundtrip.mjs \
  app_dev_169e766804934fd18f2e20200d8fd22d \
  datasource_plus_e5b3191da9eb4cb8854252f16a15367a
# → SPIKE ROUNDTRIP: PASS

# Dump current app state as JSON
docker run --rm --network shifts-manager_default \
  -e BB_EMAIL=<email> -e BB_PASSWORD=<pw> \
  -v "$(pwd)/tools/budibase-cli:/cli" \
  node:22-alpine node /cli/src/dump.mjs app_dev_169e766804934fd18f2e20200d8fd22d \
  > current-state.json
```

## Files

```
src/
  login.mjs            Cookie-auth against /api/global/auth/default/login
  client.mjs           BudibaseClient class — list/createQuery/executeQuery/deleteQuery
  dump.mjs             CLI: enumerate one app's resources as JSON
  smoke-roundtrip.mjs  CLI: create→list→execute→delete a disposable test query
package.json           Minimal — no deps, Node 22 fetch + getSetCookie
SPIKE-FINDINGS.md      Full reverse-engineering record from 2026-05-17
```

## Credentials

This scaffold reads `BB_EMAIL` and `BB_PASSWORD` from env vars. Never written to the repo. For production / CI use:
- hpg5 `.env` is the canonical home for service secrets — analogous to `BUDIBASE_API_KEY` which is already there.
- For local development, `export BB_EMAIL=... BB_PASSWORD=...` before invoking `docker run -e ...`.
