# Phase 02 UAT Findings — 2026-05-14

Authored at the end of a session that attempted to drive Plan 10 Task 4 (live UAT) to green and close the milestone. Stopped autonomously when the scope became clearly larger than a UAT fix-cycle. This document is the source of truth for what was discovered; it supersedes the optimistic framing in `.continue-here.md` and the "READY-WITH-CAVEATS" line in `02-VERIFICATION.md`.

## TL;DR

Phase 02 was deployed but never runtime-verified. Live UAT surfaced three layers of issues, in increasing severity:

1. **Test bugs** (fixed in this session, commits `1808deb` + later from agent). Cookie format + cookie name + schema drift.
2. **Layer 5 (Postgres RLS) of the four-layer tenant defense is design-only** across two components (role demotion + per-request context setter). Fixable but invasive — partially scaffolded in commits `dc661a4` through `66e7e57` but not active in production paths.
3. **Custom request types from local plugins (`shifty-roster`, `shifty-audit-writer`, `shifty-auth`) are never registered with Lowdefy's runtime.** This is a fundamental architecture gap in how plugins were structured. It affects 9 request types used across 11 page YAMLs (34 occurrences). It has been latent since these types were authored — every Phase 02 feature that depends on a custom request type has been silently non-functional in production. The static verifier did not catch this.

Phase 02 cannot legitimately close until #3 is fixed and UAT re-runs green.

## Concrete state of the repo

### Commits on `main` since the session started

| Hash | Author | What it does | Verdict |
|------|--------|--------------|---------|
| `1808deb` | me | Fix two test bugs (signInAs cookie, soldier-crud.email column) + initial migration 0013 attempt | Test fixes are good; migration was wrong (see `43afd51`). |
| `43afd51` | me | Revert migration 0013 (bootstrap-user constraint blocked ALTER ROLE) | Correct revert. |
| `dc661a4` | agent | Migration 0013 redo — creates `shifty_app` role, FORCE RLS, ALTER ROLE shifts SET role | Migration is applied on hpg5. Layer 5 SQL infrastructure live but inactive in production paths. |
| `4750a16` | agent | `KnexRawTenant` resolver + `withTenantTx` helper in shifty-auth | Code is sound but resolver is **not registered with Lowdefy runtime** (see Finding 3). |
| `439070e` | agent | YAML: switch 26 KnexRaw → KnexRawTenant across 11 pages | Currently fails at runtime because KnexRawTenant isn't registered. |
| `bc1e261` | agent | `SET ROLE NONE` (not `RESET ROLE`) in test fixtures | Correct; required because migration 0013 sets a default role. |
| `54cde4d` | agent | ShiftySessionCallback uses SET ROLE NONE for pre-tenant lookups | Necessary correctness fix. |
| `66e7e57` | agent | Test fixtures use `__Secure-next-auth.session-token` cookie name | Necessary fix — Auth.js uses `__Secure-` prefix when NEXTAUTH_URL is HTTPS. |

All commits are pushed to `origin/main`. hpg5 is synced to HEAD `66e7e57` and the container is healthy (start of session) but the runtime is in a half-fixed state: migration applied, YAMLs reference unregistered request types.

### Migration state

- `schema_migrations.version = 13`, `dirty = false`.
- Migration `db/migrations/0013_layer5_rls_app_role.up.sql` is applied. To roll back: drop `shifty_app` role (after `REASSIGN OWNED BY shifty_app TO migrator`), reset `ALTER ROLE shifts RESET role` + `ALTER ROLE shifts RESET app.current_tenant`, remove FORCE ROW LEVEL SECURITY, set `schema_migrations.version = 12`.

### hpg5 side-effects from the session (cleaned up at end)

- Temporary `pg-tunnel` socat container (alpine/socat:latest) was started to expose docker postgres on hpg5:5433 → cleaned (auto-stopped or removed before session end).
- Windows Firewall rule `shifty-pg-tunnel-5433` for inbound TCP 5433 → **deleted** at session end.
- `alpine/socat:latest` image cached in the Docker store on hpg5 → left in place (small, harmless).

## Findings in detail

### 1. Test bugs (resolved)

| Bug | Where | Resolution |
|-----|-------|-----------|
| `signInAs()` returned a `cookies` string including SET-COOKIE response attributes (`Path=/; HttpOnly`) inside what tests then sent as a Cookie request header. Lowdefy's cookie parser silently failed, leaving `session.user.roles = []`, and `authorizeRequest` masked the failure as `Request "<X>" does not exist`. This is the root cause of every "500 / does not exist" error in the first e2e run. | `tests/e2e/_fixtures/seed-tenants.ts` | Commit `1808deb`: emit bare `next-auth.session-token=<token>`. Commit `66e7e57`: rename to `__Secure-next-auth.session-token` (Auth.js HTTPS-mode cookie name — required because NEXTAUTH_URL is `https://apps.nesher.co`). |
| `soldier-crud.spec.ts` `beforeAll` `INSERT INTO soldier (... email ...)` — `soldier` has no `email` column (identity is via `soldier.user_id → app_user.email`). | `tests/e2e/soldier-crud.spec.ts:71` | Commit `1808deb`: drop the email column from the INSERT. |
| Direct-pg seeding INSERTs hit FORCE RLS after migration 0013 since `shifts` no longer auto-bypasses RLS (it auto-`SET ROLE shifty_app`). | `tests/e2e/_fixtures/seed-tenants.ts:seedTwoTenants` | Commit `bc1e261`: do `SET ROLE NONE` after connect — that drops to `session_user = shifts` which IS still SUPERUSER (bootstrap rule) and so bypasses RLS for seeding. `RESET ROLE` would NOT work because it resets to the ALTER ROLE default (shifty_app). |

### 2. Layer 5 RLS is design-only

This was specified in PRD §8.3 and documented in `db/migrations/0009_rls_policies.up.sql` (line 20: "Pre-flight assertion (run manually before applying): `SELECT rolsuper FROM pg_roles WHERE rolname='shifts'` — must return false"). The assertion was never enforced; postgres:16 docker image's POSTGRES_USER becomes the bootstrap superuser by default, and no migration demoted it.

**Postgres bootstrap-user constraint:** `shifts` is the postgres bootstrap user (the role created by `initdb` from `POSTGRES_USER` env var). Postgres refuses to remove SUPERUSER from a bootstrap user with `"permission denied to alter role / the bootstrap user must have the SUPERUSER attribute"`. So `shifts` stays SUPERUSER permanently; you can't simply demote it.

**Per-request context setter never wired:** `setTenantOnConnection` at `app/plugins/shifty-auth/src/hooks/knex-tenant.js` is defined and unit-tested, but it has **zero callers in production code**. The YAML comment in `app/connections/shifts_db.yaml` claims it's "registered at server startup by the shifty-auth plugin", but the registration line doesn't exist. So `app.current_tenant` is never set per-request in production; queries that rely on it (via the RLS policy `tenant_id = current_setting('app.current_tenant', true)::uuid`) would return zero rows if RLS were enforced.

**The agent's attempted fix:** Migration `0013_layer5_rls_app_role.up.sql` (commit `dc661a4`) creates `shifty_app` (NOSUPERUSER NOBYPASSRLS NOLOGIN), grants DML, sets `ALTER ROLE shifts SET role = shifty_app` so new shifts connections automatically operate as shifty_app, sets a default sentinel `app.current_tenant = '00000000-0000-0000-0000-000000000000'`, and FORCE ROW LEVEL SECURITY on every RLS-enabled table. This part **works at the SQL level** — verified that `shifty_app` exists and the sentinel is set.

For Layer 5 to ACTIVELY enforce, the app must set `app.current_tenant` per-request from `session.user.tenant_id`. The agent's `KnexRawTenant` resolver (`app/plugins/shifty-auth/src/connections/requests/KnexRawTenant.js`) wraps each Knex `raw()` in a transaction with `SET LOCAL app.current_tenant = ?` from the request payload. **The resolver is correct** — but it is not registered (Finding 3).

### 3. Custom request types are never registered with Lowdefy runtime

**This is the load-bearing finding.** Phase 02's plugin pattern doesn't actually register custom request handlers with Lowdefy 5.3's runtime. The features that use them have been silently broken since they were authored.

#### Evidence

- Inside the container at `/build/.lowdefy/server/build/plugins/connections.js` (the BUILD-EMITTED plugin connections file), the entire content is:

  ```js
  import { Knex as Knex } from '@lowdefy/connection-knex/connections';
  export default { Knex };
  ```

  Nothing is imported from `shifty-auth`, `shifty-roster`, or `shifty-audit-writer`.

- At runtime, `@lowdefy/api/dist/routes/request/getRequestResolver.js` does:

  ```js
  const requestResolver = connection.requests[requestConfig.type];
  if (!requestResolver) throw new ConfigError(`Request type "..." can not be found.`);
  ```

  So for `type: ParseCsvAndValidate`, `type: CreateSoldier`, `type: AuditWrite`, `type: KnexRawTenant` etc. — all 9 affected types — `connection.requests[type]` returns `undefined` and the request fails.

#### Why

`@lowdefy/build/dist/build/writePluginImports/` has writers for blocks/actions/agents/auth/connections/icons/operators — but **no `writeRequestImports`**. The `components.types.requests` collected from each plugin's `types.js` is tracked (used for schema validation) but **never emitted into any build artifact at runtime**. Custom request types must therefore be inside a connection type's `requests` map, registered through `writeConnectionImports`.

Our plugins declare `requests: [...]` in their `types.js` files but do NOT declare `connections: [...]`. Compare with the upstream `@lowdefy/connection-knex` `types.js`:

```js
export default {
  connections: ['Knex'],
  requests: ['KnexBuilder', 'KnexRaw'],
};
```

The upstream declares both. Its `connections.js` then exports a NAMED `Knex` export whose value contains the request handlers in its `requests` field:

```js
// upstream connection-knex/dist/connections.js
export { default as Knex } from './connections/Knex/Knex.js';
// where Knex.js's default export is { schema, requests: { KnexBuilder, KnexRaw } }
```

Our plugins' `connections.js` files use `export default { AuditWrite, ... }` — a default-exported object. Even if a plugin DID declare `connections: ['AuditWrite']`, the build would generate `import { AuditWrite as AuditWrite } from 'shifty-audit-writer/connections'` — which would resolve to `undefined` because there's no NAMED export `AuditWrite`.

#### Scope of the fix

To make Phase 02's custom request types work:

1. ONE plugin must own the merged `Knex` connection type. Multiple plugins exporting `connections: ['Knex']` is a last-wins overwrite per `buildTypeClass`'s `store[typeName] = ...`.
2. That plugin's `connections.js` must use NAMED exports: `export { default as Knex }` where the Knex value is `{ schema: upstream.schema, requests: { ...upstream.requests, KnexRawTenant, AuditWrite, ParseCsvAndValidate, CommitRosterImport, CreateSoldier, UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater } }`.
3. The plugin must `import` each request handler. Today `shifty-roster` depends on `shifty-auth` (file:../shifty-auth) — if `shifty-auth` were to own the merged Knex, it'd have to import from `shifty-roster`, creating a dependency cycle. **The cycle must be broken before this fix can land.**
4. Each plugin's `types.js` should declare ONLY the types it owns. The owning aggregator declares `connections: ['Knex']` AND `requests: [<all custom request type names>]`. Non-owning plugins declare just their request type names if they want schema validation (but the request handlers must be imported BY the owning plugin).

#### Estimated effort

Plugin refactor: 2-4 hours, depending on how the dependency cycle is resolved (introduce a third `shifty-common` package; or invert the dep so `shifty-roster` doesn't reference `shifty-auth`; or merge all three into one). Then rebuild lowdefy on hpg5, restart, re-run UAT.

## Outstanding test failures (post-agent-work)

Last UAT run: 20 passed / 16 failed / 4 skipped across the 5 Phase 2 specs (per agent report). All 16 failures trace back to either Finding 3 (request not registered → "Request does not exist" / 500) or to test-side state leakage from a previous failed run.

Phase 1 specs: 10 passed / 7 failed. Phase 1 failures (audit-writer, role-gate, auth-cookies page tests) ALSO trace back to Finding 3 — those tests fire custom requests (AuditWrite) or check pages whose page-level requests fail.

## What needs to happen next session

In rough order:

1. **Decide the plugin refactor strategy** (aggregator-as-third-plugin vs. dep-inversion vs. merge). This is the load-bearing decision.
2. **Implement the merged-Knex aggregator** with all 9 custom request handlers.
3. **Update plugin types.js** declarations + package.json exports per the new structure.
4. **Rebuild lowdefy on hpg5** via PsExec.
5. **Re-run UAT** — should drop failures significantly. The Layer 5 SQL infrastructure is already in place, so once `KnexRawTenant` is registered, RLS Layer 5 should activate.
6. **Run the 6 manual UI smoke scenarios** + RTL email smoke (originally Plan 10 Task 4).
7. **Update Plan 10 SUMMARY** + ROADMAP + tag v0.2.0-phase2.
8. **Either revisit** `setTenantOnConnection` (the unit-tested but unwired hook) — it's superseded by `KnexRawTenant` if that registers correctly, so it can be deleted, OR it could be the in-built fallback.

## Recommended issue-tracking entries

To track in PRD §15 / project backlog:

- **P02-HF-01 (blocker for milestone close):** Plugin-registration architecture — custom request handlers must be inside a connection type's `requests` map. Requires plugin refactor.
- **P02-HF-02:** Once P02-HF-01 lands, re-run live UAT (Plan 10 Task 4) and validate the 6 UI smoke scenarios + RTL email smoke.
- **P02-HF-03 (low priority once HF-01 lands):** Delete `setTenantOnConnection` if `KnexRawTenant` is the live path, OR document why it's kept.
- **P02-HF-04:** Migration 0013 commentary in `db/migrations/0009_rls_policies.up.sql` line 20 ("pre-flight assertion: shifts NOSUPERUSER must be true") is misleading — the migration itself never enforced this, and the bootstrap-user constraint means it can't be enforced. Either remove the comment or replace it with a reference to 0013.

## Time accounting (rough)

- Initial UAT run + diagnosis: ~30 min
- Test-bug fixes (cookie, soldier.email) + push + sync: ~20 min
- Layer 5 migration v1 attempt + bootstrap-user discovery + revert: ~30 min
- Layer 5 deep investigation (Postgres role model, RLS semantics, Knex hook surface): ~30 min
- Agent run (Layer 5 wireup attempt): ~80 min (was running while I waited)
- Post-agent investigation (build pipeline, plugin loading, getRequestResolver): ~30 min
- Status doc: this file

Total session: ~3.5 hours. Outcome: Phase 02 does not close this session, but the surface area is now fully understood and the test bug fixes + migration 0013 SQL infrastructure are in place.
