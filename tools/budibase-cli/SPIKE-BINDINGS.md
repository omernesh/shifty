# Spike — Budibase binding resolution surfaces

**Date:** 2026-05-18
**Trigger:** Phase 3 W0-02 surfaced that `POST /api/queries/<id>` returns null for all `{{ Current User.* }}` bindings, blocking end-to-end verification of Layer-2 query filters.
**Status:** **CONFIRMED BLOCKER** for headless binding verification. Bindings only resolve inside a published-app browser runtime.

## What was tested

Six HTTP probe paths against the live hpg5 stack, all with cookie auth + `x-budibase-app-id` header:

| # | Endpoint | Binding result | Notes |
|---|----------|---------------|-------|
| 1 | `POST /api/queries/<id>` (v1 builder execute) | `null` for all bindings | Original W0-02 finding |
| 2 | `POST /api/queries/preview` (Builder "Test query" button) | `null` for all bindings | Reverse-engineered from Builder UI bundle |
| 3 | `POST /api/v2/queries/<id>` (published-app runtime endpoint) | `null` for all bindings | Tried with dev AND published app IDs |
| 4 | Same as #3 but with the dev app **published** to prod first (`POST /api/applications/<id>/publish` → 200) | `null` for all bindings | Publish succeeded; binding context still empty |
| 5 | Same as #2 with `csrfToken` header (5 variant names: `x-csrf-token`, `x-budibase-csrf-token`, `csrf-token`, `X-CSRF-Token`, `csrfToken`) | `null` for all bindings | CSRF not the gate |
| 6 | `GET /api/self` on the apps service / `GET /api/global/self` on the worker | **Full user object returned** with `shiftyTenantId: "00000000-...-0001"`, `tenantId: "default"`, `email`, `csrfToken`, `roleId`, etc. | The data IS reachable, just not through query bindings |

Bindings tested in queries 1-5: `email`, `_id`, `tenantId`, `shiftyTenantId`, `firstName`, `userId`, `admin.global`, `roleId`, `globalId`. All return null.

## Diagnostic chain

1. **`/api/self` proves the data is there.** The admin's `shiftyTenantId` (set via `/api/global/users` PATCH in W0-02 Task 2) round-trips and appears on `/api/self`. So persistence works.
2. **The query endpoints process the request successfully** (HTTP 200, rows returned). They just see an empty `Current User` context.
3. **CSRF is not the gate** — sending `csrfToken` from `/api/self` under five different header names made no difference.
4. **Publishing the app didn't help.** Once published, `/api/client/applications` returns `{apps: []}` despite the appUrl response. Cookie auth from outside a real browser session isn't enough to make the query endpoint see the user.

**Inference:** the binding resolver in `pinpointFinalSQL()` (or equivalent in the apps server) reads `Current User` from request-local context populated by middleware that ONLY fires for requests originating from inside a published-app's loaded JS bundle. The bundle handshakes with the backend in a way that's distinct from raw cookie auth — possibly a different cookie scope, an app-specific bearer token, or runtime state injected into the bundle at /app/<slug> load time. We did not get to the bottom of which mechanism.

## What this DOES NOT block

- **The Layer-2 CI gate.** `tools/check-bb-queries.mjs` validates SQL text patterns. It doesn't care whether bindings resolve — only that the canonical filter literal is present. The gate is fully functional.
- **The Internal API config-as-code path.** Queries, automations, screens can be CREATED via the Internal API (proven by `tools/budibase-cli/src/smoke-roundtrip.mjs`). The deliverables of W0-02 Tasks 3-4 (build the invite-redemption Automation + snapshot) can still ship — just without an end-to-end binding test on the same code path.
- **Building screens via the Internal API.** The Builder UI uses `POST /api/screens` (same endpoint as anywhere else) — we can build screens headless. Same auth model.

## What it DOES block

- **API-only verification that `{{ Current User.shiftyTenantId }}` resolves to the correct UUID.** The first verification opportunity is the first published screen viewed by a logged-in user in a browser.
- **CI smoke tests for Layer 2 enforcement.** We can't write a Node test that says "given user U with shiftyTenantId T, a Builder UI Query Q against `WHERE tenant_id = '{{ Current User.shiftyTenantId }}'::uuid` returns only rows where `tenant_id = T`." Such a test would need to drive a browser.

## Forward paths (priority-ranked)

### A. **Accept and proceed to W1 — the first screen IS the verification** ⭐ Recommended
Build the first W1 screen (`shift_slot` CRUD list view) with a Layer-2-filtered query. Test by logging in as the admin in a browser and verifying the screen shows the admin's tenant data. If it works → bindings resolve as expected and we move on. If it doesn't → we open a focused debug spike then, with concrete failing repro.
**Pros:** unblocks real work immediately; verification cost is amortized into the first screen build.
**Cons:** if bindings DON'T resolve, we discover it during W1 with sunk cost.

### B. **Browser MCP-driven verification spike** (~1-2h)
Use `chrome-devtools` or `playwright` MCP to:
1. Navigate to `https://apps.nesher.co/app/<slug>` (the published app's URL)
2. Log in as the admin via the login form
3. Watch the Network panel as a query fires
4. Capture the exact request headers + cookies + payload — that's the runtime-context shape
5. Replay the captured shape from Node to get headless verification working

**Pros:** definitive answer; potentially unlocks headless CI tests for bindings if we can replay the shape.
**Cons:** requires building a dummy screen first (chicken-and-egg — but a 1-component screen with a single query binding is ~10 min in the Builder UI or via `POST /api/screens`).

### C. **Switch first-consumer model — let the FastAPI solver verify tenant filtering**
Phase 4's solver service connects to Postgres as a non-superuser (Layer-5 RLS IS active there) and runs its own queries with explicit `SET LOCAL app.current_tenant = <UUID>`. This sidesteps the Budibase binding question entirely for the first real tenant-filter test.
**Pros:** decouples critical path from the unsolved Budibase mystery; uses a verification surface we fully control.
**Cons:** delays Phase 3 user-facing work; doesn't actually solve the Builder UI question, just defers it.

## Tied loose end

The published app is now in prod state on hpg5 (we ran `POST /api/applications/<id>/publish` during the spike). The app is empty (0 screens, 0 automations). The publish operation is reversible via `POST /api/applications/<id>/unpublish` (per the bundle's `buildAppEndpoints`). Leaving it published is harmless (no public surface — the app has no screens to serve), but document the state so future work knows it isn't pristine.

## Files added this spike

- `tools/budibase-cli/SPIKE-BINDINGS.md` (this file)

No other code changes — all probes were ephemeral.
