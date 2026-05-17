# Budibase Internal API spike — findings

**Date:** 2026-05-17
**Trigger:** User pushed back on Phase 03 plan W0-02 being marked `autonomous: false` ("requires Builder UI click-through"). Spike proved the claim wrong.
**Status:** Tier-2 path (cookie auth + Internal API) PROVEN end-to-end on hpg5 Budibase 3.38.4 CE.

## TL;DR

Budibase has TWO HTTP surfaces:
1. **Public API** (`/api/public/v1/*`, `x-budibase-api-key` header) — CRUD for tables/rows/queries/users/views/workspaces. **No** endpoints for screens, automations, datasources. Officially documented.
2. **Internal API** (`/api/screens`, `/api/automations`, `/api/datasources`, `/api/queries`, `/api/tables`, `/api/global/configs/*`, etc.) — cookie auth, undocumented but reachable. Full CRUD for everything the Builder UI itself does.

The earlier assumption that "config-as-code is impossible on Budibase CE" was based on testing only the Public API. The Internal API covers the gap.

## Service topology (verified by `netstat -tln` inside containers)

| Container | Internal port | Hostname on docker network |
|-----------|--------------|---------------------------|
| `shifty-budibase-worker` | **4003** | `budibase-worker` |
| `shifty-budibase-app`    | **4002** | `budibase-app` |
| `shifty-budibase-proxy`  | 10000 → host 8080 | `budibase-proxy` |

*Note: `docker compose ps` reports `TargetPort=4001` for both worker and app — that's wrong (or stale). The real listening ports are 4003 and 4002.*

The docker network is `shifts-manager_default`. An ephemeral node container joins it via:
```bash
docker run --rm --network shifts-manager_default node:22-alpine ...
```
The image is already cached on hpg5 from W0-05's snapshot work — no PsExec needed.

## Auth — what actually works

### Login endpoint

`POST http://budibase-worker:4003/api/global/auth/default/login`

```json
{"username": "<email>", "password": "<pw>"}
```

⚠️ The field name is `username`, not `email`. The Builder UI calls it "email" in its login form but the backend schema validation requires `username`. With `email`: HTTP 400 `{"message":"Invalid body - \"username\" is required","status":400}`.

### Cookie capture

On 200, the response sets two cookies that downstream calls MUST send:
- `budibase:auth`
- `budibase:auth.sig`

In Node's `fetch`, capture via `response.headers.getSetCookie()` (NOT `response.headers.get('Set-Cookie')` — multiple cookies get folded into a single string and JS's fetch then mangles them).

```js
const r = await fetch(`${WORKER}/api/global/auth/default/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.BB_EMAIL, password: process.env.BB_PASSWORD }),
});
const cookieHeader = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
```

### Required header on all downstream calls

Every Internal API call against an app's resources also needs `x-budibase-app-id: app_dev_<id>`. The Builder UI sets this from its current workspace context. The `app_dev_*` prefix is for development workspaces; published apps use `app_*`. Use `GET /api/applications?status=all` to enumerate.

## CRUD roundtrip — proven for queries

Demonstrated end-to-end in this commit's `src/smoke-roundtrip.mjs`:

| Step | Method + Path | Result |
|------|--------------|--------|
| Login | `POST /api/global/auth/default/login` | 200 + 2 cookies |
| List queries | `GET /api/queries` | 200, array of `{_id, name, datasourceId, fields, queryVerb, ...}` |
| Create query | `POST /api/queries` (body = query JSON) | 200, returns `{_id, _rev, ...}` |
| Execute query | `POST /api/queries/<_id>` (body = `{parameters: {}}`) | 200, returns row array `[{msg: 'spike works', ts: '2026-05-17 13:58:31.799183+00'}]` |
| Delete query | `DELETE /api/queries/<_id>/<_rev>` | 200, `{"message":"Query deleted."}` |

Verified runtime — the create executes the actual SQL against the live Shifty Postgres, returning the live `now()` and our literal `msg`. This is not a stub; it's the real query path.

## Query payload shape (full)

From the existing "Baseline" query:

```json
{
  "_id": "query_<datasourceId>_<random_hex>",
  "_rev": "1-<rev_hash>",
  "name": "Baseline",
  "transformer": "return data",
  "schema": {
    "val": { "type": "string", "name": "val" }
  },
  "datasourceId": "datasource_plus_e5b3191da9eb4cb8854252f16a15367a",
  "parameters": [],
  "fields": {
    "sql": "SELECT current_setting('app.current_tenant', true) AS val;"
  },
  "queryVerb": "read",
  "nestedSchemaFields": {},
  "nullDefaultSupport": true,
  "createdAt": "2026-05-16T23:11:54.295Z",
  "updatedAt": "2026-05-16T23:11:54.295Z",
  "readable": true
}
```

On create, you omit `_id`, `_rev`, `createdAt`, `updatedAt` (server assigns). You MUST include `name`, `datasourceId`, `fields.sql`, `queryVerb`. The other fields default sensibly.

## What's reachable (snapshot of one app, 2026-05-17 13:58)

App `app_dev_169e766804934fd18f2e20200d8fd22d` (Default workspace):
- **Datasources:** 2 — `bb_internal` (Budibase DB) + `datasource_plus_e5b3191da9eb4cb8854252f16a15367a` (PostgreSQL, our Shifty schema)
- **Tables:** 30 — Budibase auto-introspected the entire Shifty schema (`accounts`, `app_user`, `availability`, `shift_slot`, etc., plus the Budibase internal `Users`/`ta_users`)
- **Queries:** 1 — `Baseline`
- **Screens:** 0
- **Automations:** 0
- **Roles:** 3 — `ADMIN`, `BASIC`, `PUBLIC`

The Builder UI is essentially blank — only the data layer is wired. This is the actual scope of post-pivot Phase 3 W1+ work.

## Implications

### For W0-02 (the trigger)

W0-02 should be flipped to `autonomous: true`. The plan to "add `tenantId` custom field on Users schema + build invite-redemption Automation" can be done via:

1. `GET /api/global/configs/<id>` to inspect the current Users schema config doc shape
2. `POST /api/global/configs` to patch it with a `customUserSchema.tenantId` entry
3. `POST /api/automations` to create the invite-redemption Automation

Alternatively, the researcher's even-simpler finding stands: user docs are schemaless. A simple `PUT /api/public/v1/users/<userId>` with a `tenantId` key persists it. The "custom field" UI declaration is only needed if you want form-rendering hints inside the Builder. The Layer-2 CI gate (W0-04) doesn't care whether the field is "declared" — it validates SQL text.

The right choice depends on whether downstream Phase 3 W3 availability UI needs the Builder UI to RENDER the tenantId field on user-edit forms. If not (likely — soldiers don't edit their tenantId), skip the declaration step entirely.

### For CLAUDE.md + BUDIBASE-CONVENTIONS.md

Two load-bearing claims are now wrong:

1. **CLAUDE.md** "Treat the Builder UI as the source of truth for screens/queries"
2. **BUDIBASE-CONVENTIONS.md §1** "PRs cannot show diffs for UI work; they describe it in prose with screenshot/wireframe references."

The corrected stance: **Builder UI is the canonical AUTHORING surface, but Builder UI artifacts ARE serializable to git-tracked JSON via the Internal API.** A future Phase-3-W0 tightening would add a `tools/budibase-cli/apply.mjs` that diffs JSON-on-disk vs JSON-from-Builder-UI and either:
- Pushes git changes into the Builder UI (`apply` direction)
- Pulls Builder UI changes into git (`extract` direction)

Both directions are now technically feasible.

### For Phase 3 W1+ planning

The W1–W4 plans currently assume Builder-UI-prose-description shape (per BUDIBASE-CONVENTIONS.md §5 "new plan shape"). They CAN remain that shape — the Internal API path is opt-in, not mandatory. But for repeat-by-construction (e.g., a CI test that asserts the right screens exist), config-as-code via this CLI is the canonical path.

## Watch-outs

- **Internal API has no OpenAPI spec.** Endpoint shapes are reverse-engineered. Pin Budibase version (3.38.4 already pinned in `docker-compose.yml`); audit when bumping.
- **No CSRF token.** The cookie itself is the credential. Don't expose Builder UI to untrusted networks.
- **PsExec gating on registry pulls** still applies (per CLAUDE.md). `node:22-alpine` is already cached; if a new image is needed, wrap the `docker pull` with PsExec.
- **Cookie expiry**: cookies returned without explicit max-age — relying on session lifetime. Re-login on 401/403 from any subsequent call.

## Files in this scaffold

| Path | Purpose |
|------|---------|
| `src/login.mjs` | Cookie-auth login. CLI smoke mode prints cookie names returned. |
| `src/client.mjs` | `BudibaseClient` wrapping cookie + app-id headers. Currently exposes `list/createQuery/executeQuery/deleteQuery`. |
| `src/dump.mjs` | Enumerate one app's datasources/screens/automations/queries/tables/roles as JSON. |
| `src/smoke-roundtrip.mjs` | End-to-end CRUD proof: create disposable query → list → execute → delete → verify clean. |
| `package.json` | npm scripts `dump` + `smoke`. ESM, Node 22. |

## Running it

From the repo root, against the running hpg5 stack:

```bash
# Dump app state
docker run --rm --network shifts-manager_default \
  -e BB_EMAIL=<email> -e BB_PASSWORD=<pw> \
  -v "$(pwd)/tools/budibase-cli:/cli" \
  node:22-alpine node /cli/src/dump.mjs app_dev_169e766804934fd18f2e20200d8fd22d

# Smoke roundtrip
docker run --rm --network shifts-manager_default \
  -e BB_EMAIL=<email> -e BB_PASSWORD=<pw> \
  -v "$(pwd)/tools/budibase-cli:/cli" \
  node:22-alpine node /cli/src/smoke-roundtrip.mjs \
  app_dev_169e766804934fd18f2e20200d8fd22d \
  datasource_plus_e5b3191da9eb4cb8854252f16a15367a
```

For CI / scripted use, credentials live in env vars only — never written to `.env` in this repo. On hpg5 a future provisioning step may add `BUDIBASE_ADMIN_EMAIL` / `BUDIBASE_ADMIN_PASSWORD` to `.env` (analogous to `BUDIBASE_API_KEY` which is already there).
