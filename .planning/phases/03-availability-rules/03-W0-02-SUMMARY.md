# Phase 3 W0-02 — Partial execution summary

**Date:** 2026-05-18
**Status:** PARTIAL — Task 1 + 2 (with caveats) executed. Tasks 3-4 deferred pending binding-resolution investigation.
**Commits:** see commit log for `tools/budibase-cli/src/{dump-configs,apply-tenantid,diagnose-binding}.mjs` + rename commit.

## What landed

### Task 1 — Probe (DONE)
- Wrote `tools/budibase-cli/src/dump-configs.mjs`.
- Empirical findings against live hpg5 stack (Budibase CE 3.38.4):
  - Valid `/api/global/configs/<type>` types are exactly: `settings, account, smtp, google, oidc, logos_oidc, scim, ai, recaptcha, translations`. **There is NO `customUserSchema` config type** — the assumed mechanism in the original W0-02 plan does not exist.
  - The `settings` config doc has just 4 fields: `platformUrl`, `analyticsEnabled`, `uniqueTenantId`, `createdVersion`. No user-schema customization key.
  - Probed 6 candidate endpoints for custom-user-schema mutation (`/api/global/users/customAttributes`, `/api/global/users/schema`, `/api/global/users/customSchema`, `/api/global/configs/customUserSchema`, `/api/admin/customUserSchema`, `/api/global/customUserSchema`) — all returned 404 or 400 (invalid type).
- 0 existing automations in the app.
- 1 existing user: the admin (`omernesher@gmail.com`, `us_b0812d2ac54044e0b1e258bd046fe5fc`) — `builder.global=true`, `admin.global=true`. Built-in `tenantId` field on the user doc holds the literal string `"default"` (Budibase's WORKSPACE tenant, not a domain UUID).

### Task 2 — PATCH admin user with shiftyTenantId (DONE, with caveat)
- Wrote `tools/budibase-cli/src/apply-tenantid.mjs`.
- Successfully PATCHed admin user with `shiftyTenantId = '00000000-0000-0000-0000-000000000001'` (sentinel UUID).
- GET round-trip CONFIRMED the field persists. New `_rev=3-43500b5542dbc1e11172c82d62e8c2bd`.
- **However**, the binding-resolution test at the end of `apply-tenantid.mjs` FAILED — a query body of `SELECT '{{ Current User.shiftyTenantId }}'::uuid` rejected with `invalid input syntax for type uuid: ""` when executed via `POST /api/queries/<id>` (the Builder API).
- Follow-up diagnostic (`diagnose-binding.mjs`) confirmed: **ALL `{{ Current User.* }}` bindings resolve to `null` via the Builder API execute path** — including built-in fields like `email` and `_id`. This is not a `shiftyTenantId`-specific issue; the Builder API simply doesn't pass user context to the binding resolver.
- The field-level write WORKED. The Builder API verification surface was the wrong test.

## Pre-existing claim invalidated

**Researcher's hypothesis** ("user docs are schemaless; PUT writes any field and bindings resolve it") is correct at the persistence layer but WRONG at the Builder API binding-resolution layer. The verification needs to use the published-app runtime, not the Builder API. That investigation hasn't been completed in this session.

## Renames committed (collateral from the design-issue surface)

The dump-configs probe surfaced that Budibase populates `tenantId` on user docs natively. To avoid collision with Budibase's own routing field, the Shifty domain tenant field was renamed everywhere from `tenantId` → `shiftyTenantId`:
- `tools/check-bb-queries.mjs` — `TENANT_FILTER_PATTERN` updated to match `Current User.shiftyTenantId`
- `tools/test/check-bb-queries.test.mjs` — 10 fixture references updated; 23/23 unit tests + 3/3 self-test still pass
- `docs/BUDIBASE-CONVENTIONS.md` — §2 layer table, §3 procedure rewritten (schemaless-fact noted)
- `docs/PRD.md` — 2 references
- `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/phases/03-availability-rules/03-CONTEXT.md` — all updated
- `.planning/phases/03-availability-rules/03-W0-02-PLAN.md` — 12 references

Commit: `feat(layer-2): rename Current User.tenantId → shiftyTenantId across gate + tests + docs + plans`.

## Tasks deferred (not done this session)

### Task 3 — Build invite-redemption Automation
Not started. Three reasons:
1. Wait until binding resolution is understood — the Automation's queries reference `{{ Current User.shiftyTenantId }}` too, so the same null-resolution might bite at Automation execution time.
2. Verify `invite_code` table exists in Postgres (not yet confirmed empirically).
3. Once binding works, the Automation should be straightforward via `POST /api/automations`.

### Task 4 — Snapshot + close BUDIBASE-CONVENTIONS.md §10 #3
Not started. Depends on Task 3 producing the Automation; the snapshot would otherwise just capture the shiftyTenantId-on-admin state, which is true post-Task-2 but minor without the Automation.

## Open questions for next session

1. **Where does Builder UI's "Edit user-schema" page POST to?** That's where customUserSchema declarations would live. Best investigated by browser DevTools watching the Builder UI's network panel while clicking the affordance. The 6 probe paths above were all wrong.
2. **What endpoint executes a query AS a specific user** (so bindings resolve)? Candidates: `/api/queries/preview` (untested); `/api/{appPath}/queries/<id>` published-app endpoint (untested); inside a Budibase "preview" mode.
3. **Does the published-app runtime resolve `{{ Current User.shiftyTenantId }}`?** This is the load-bearing question. Phase 3 W1+ work is on hold until answered. Recommended path: build a tiny test screen in the Builder UI that displays `{{ Current User.shiftyTenantId }}`, view it as the logged-in admin via the dev preview URL.

## Recommendation

This is a real complication, not a fatal one. The Internal API spike's headline claim ("config-as-code is viable") still holds — we proved CRUD on queries works end-to-end. The narrower question of binding-resolution-during-execution needs a focused follow-up spike. Suggested next move:

- **Open a focused spike** (or reopen `gsd-spike`) on "Budibase binding resolution surfaces" — investigate the published-app endpoint, the preview endpoint, and what the Builder UI's "Run as user" affordance calls. Should be 1-2 hours.
- **Re-open W0-02 Task 3 + 4** after the spike resolves how to verify bindings.
- **Defer Phase 3 W1+ planning** until the binding question is settled — it's load-bearing for every Layer-2 query in those waves.

## Files added (committed)

- `tools/budibase-cli/src/dump-configs.mjs`
- `tools/budibase-cli/src/apply-tenantid.mjs`
- `tools/budibase-cli/src/diagnose-binding.mjs`
- This SUMMARY
