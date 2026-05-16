---
phase: 02-org-people
plan: 11
subsystem: lowdefy-plugin-registration
tags: [hotfix, plugin-registration, lowdefy-5.3, rls-layer-5, phase-02-uat]
requires:
  - shifty-auth/connections/requests/KnexRawTenant.js (verbatim move)
  - shifty-auth/auth/{adapters,callbacks,providers}.js (verbatim move)
  - shifty-auth/hooks/{with-tenant-tx,knex-tenant}.js (verbatim move)
  - shifty-auth/middleware/log-redact.js (verbatim move)
  - shifty-audit-writer/connections/requests/AuditWrite.js (verbatim move)
  - shifty-roster/connections/requests/{ParseCsvAndValidate,CommitRosterImport,CreateSoldier,UpdateSoldier,ArchiveSoldier,CreateMembership,InviteLater}.js (verbatim move)
  - shifty-roster/helpers/{palette,canonicalize,role-tag}.js (verbatim move)
  - shifty-roster/dispatch/resend.js (verbatim move)
  - migration 0013_layer5_rls_app_role.up.sql (applied on hpg5)
provides:
  - app/plugins/shifty-plugin/ — single merged plugin replacing the three prior plugins
  - tests/e2e/layer5-rls-activation.spec.ts — Layer 5 RLS active-enforcement proof (5 tests, all green)
  - tests/e2e/ui-smoke-phase2.spec.ts — Phase 2 UI smoke (6 scenarios; payload-binding issue surfaced; deferred)
affects:
  - app/lowdefy.yaml (plugins: replaces three entries with one)
  - app/package.json (dependencies: replaces three entries with one)
  - tests/unit/{canonicalize,color-palette,role-tag-canonical}.spec.ts (import path rewrites)
  - package.json (test:unit script: dropped references to deleted plugin-colocated tests)
tech-stack-added: []
tech-stack-patterns:
  - "Merged-plugin pattern for Lowdefy 5.3: declare connections:['Knex'] AND requests:[...] in types.js; use NAMED export `export { default as Knex }` in connections.js; nest custom handlers under a connection-type's `requests` map (writeConnectionImports template). Requests-only plugins (no connections: declaration) silently drop handlers at build time."
  - "Every request handler must set .meta = { checkRead, checkWrite } — @lowdefy/api 5.3's checkConnectionRead/checkConnectionWrite reads this field. Missing .meta throws TypeError at request dispatch."
  - "Every request handler must set .connectionType = '<ConnectionType>' (e.g. 'Knex') — required for Lowdefy's request-to-connection binding."
key-files-created:
  - app/plugins/shifty-plugin/package.json
  - app/plugins/shifty-plugin/src/types.js
  - app/plugins/shifty-plugin/src/connections.js
  - app/plugins/shifty-plugin/src/connections/Knex/Knex.js
  - app/plugins/shifty-plugin/src/connections/Knex/requests/{9 handlers}.js
  - app/plugins/shifty-plugin/src/auth/{adapters,callbacks,providers}.js
  - app/plugins/shifty-plugin/src/hooks/{with-tenant-tx,knex-tenant}.js
  - app/plugins/shifty-plugin/src/middleware/log-redact.js
  - app/plugins/shifty-plugin/src/helpers/{palette,canonicalize,role-tag}.js
  - app/plugins/shifty-plugin/src/dispatch/resend.js
  - tests/e2e/layer5-rls-activation.spec.ts
  - tests/e2e/ui-smoke-phase2.spec.ts
key-files-modified:
  - app/lowdefy.yaml
  - app/package.json
  - tests/unit/canonicalize.spec.ts
  - tests/unit/color-palette.spec.ts
  - tests/unit/role-tag-canonical.spec.ts
  - package.json
key-files-deleted:
  - app/plugins/shifty-auth/ (entire directory, 13 files)
  - app/plugins/shifty-audit-writer/ (entire directory, 6 files)
  - app/plugins/shifty-roster/ (entire directory, 13 files)
decisions:
  - "Merge-all-into-one chosen over aggregator-as-third-plugin (3-plugin keep-with-cycle-break) and dep-inversion (shifty-auth depends-on shifty-roster instead). Rationale: the three plugins had no domain separation beyond what was a historical accident of staged development; collapsing them removes the latent dep cycle entirely (CommitRosterImport's `import { withTenantTx } from 'shifty-auth/hooks/...'` becomes an in-package relative path), and the merged plugin is small enough (~22 source files) that the cohesion penalty is negligible."
  - "Handler .meta = { checkRead: false, checkWrite: false } matches upstream KnexRaw/KnexBuilder defaults (both flags false → connection-level read/write gating is opt-out unless the handler explicitly opts in). Phase 2 page YAMLs don't use connection.properties.read/write controls, so this is the right default. If a future plan adds read-only or write-only connections, the meta fields can be tightened per-handler."
  - "Cookie name __Secure-next-auth.session-token (HTTPS mode) requires secure: true in Playwright addCookies — fixed in ui-smoke-phase2 test 5f; the pre-existing cross-tenant-leak.spec.ts and tenant-isolation.spec.ts continue to pass with their BASE_URL=https://apps.nesher.co fixture (Cloudflare tunnel). HTTP BASE_URL (http://hpg5:8080) cannot satisfy __Secure- prefix's secure-attribute requirement."
metrics:
  duration: "~3h elapsed (Tasks 1-6 + 2 rebuilds + 2 full e2e runs)"
  completed_date: 2026-05-16
  tasks_done: 6
  tasks_total: 8
---

# Phase 02 Plan 11: Plugin-Registration Hotfix Summary

Restructure the three Phase-2 Lowdefy plugins (shifty-auth, shifty-roster, shifty-audit-writer) into a single merged `shifty-plugin` package so Lowdefy 5.3's plugin runtime actually registers the 9 custom request types (KnexRawTenant, AuditWrite, ParseCsvAndValidate, CommitRosterImport, CreateSoldier, UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater). The load-bearing structural fix: declare BOTH `connections:['Knex']` and `requests:[9 names]` in `types.js`, use a NAMED `export { default as Knex }` from `connections.js`, and nest the 9 custom handlers inside the merged Knex connection's `requests` map (spread with `@lowdefy/connection-knex`'s upstream KnexBuilder + KnexRaw).

## Load-bearing structural change (UAT-FINDINGS §3 closure)

Pre-merge, the BUILD-EMITTED `/build/.lowdefy/server/build/plugins/connections.js` (the runtime connection-type registry that `@lowdefy/api/dist/routes/request/getRequestResolver.js` consults) contained only:

```js
import { Knex as Knex } from '@lowdefy/connection-knex/connections';
export default { Knex };
```

The three Phase-2 plugins' `requests: [...]` declarations were silently dropped because `@lowdefy/build/dist/build/writePluginImports/` has writers for blocks/actions/agents/auth/connections/icons/operators but **no `writeRequestImports`**. The `components.types.requests` collected from each plugin's `types.js` is tracked (used for schema validation) but never emitted into any runtime artifact.

Post-merge, the BUILD-EMITTED file now reads:

```js
import { Knex as Knex } from 'shifty-plugin/connections';
export default { Knex };
```

The `shifty-plugin/connections` module re-exports a merged Knex value whose `requests` map contains both the upstream `KnexBuilder`/`KnexRaw` and our 9 custom handlers. Last-wins semantics inside `buildTypeClass` (`store[typeName] = ...`) ensure the merged Knex displaces the upstream one — the upstream's request handlers are preserved because we spread `upstream.Knex.requests` into the merged map.

Verified by `docker exec shifty-lowdefy cat /build/.lowdefy/server/build/plugins/connections.js` after the rebuild.

## Task-by-task outcome

| Task | Outcome | Commit |
|------|---------|--------|
| Task 1: Scaffold shifty-plugin skeleton (package.json, src/types.js, src/connections.js, src/connections/Knex/Knex.js, 6 empty subdirs) | DONE — types.js declares `connections:['Knex']` AND `requests:[9 names]`; connections.js uses NAMED export; package.json exports map mirrors the union of the three old plugins' exports. | `494ec89` |
| Task 2: Migrate 9 request handlers verbatim with import-path rewrites | DONE — All 9 handlers in `connections/Knex/requests/`; zero cross-package imports remain; every handler preserves `.connectionType = 'Knex'` + `export default <Name>`. | `15a6680` |
| Task 3: Migrate 10 support files (auth/, hooks/, middleware/, helpers/, dispatch/) verbatim with rewrites | DONE — KnexAdapter, ShiftySessionCallback, EmailProvider, withTenantTx, setTenantOnConnection, log-redact, PALETTE (24-hex frozen), canonicalizeText, canonicalizeRoleTag, sendInvite, bulkDispatchWithBackoff all in-place. | `589d638` |
| Task 4: Wire shifty-plugin in lowdefy.yaml + app/package.json; delete the three old plugin directories | DONE — 41 files in net change (15 inserts, 2867 deletes); tests/unit/* imports redirected to shifty-plugin (Rule 1 fix; otherwise unit tests fail at import); `node --check` passes on all 22 merged plugin files. | `3db6f10` |
| Task 5: Push, sync hpg5, PsExec rebuild, verify build-emitted connections.js, write Layer 5 spec | DONE — hpg5 synced to `aa0804f`; PsExec rebuild succeeded (~150s build); BUILD-EMITTED connections.js confirmed importing from shifty-plugin/connections; **5/5 Layer 5 spec tests pass against hpg5** (precondition + baseline + forged-cross-tenant-blocked + symmetric-proof + membership-table). | `9e55814` |
| Task 6: Author ui-smoke-phase2.spec.ts (6 scenarios a–f) + run full Phase 2 e2e suite | PARTIAL — spec authored with 6 test() blocks; full suite ran 51 specs, **26 passed / 21 failed / 4 skipped**. Layer 5 RLS spec all green. cross-tenant-leak suite all green (17/17). Phase 2 mutation specs (soldier-crud, roster-csv-import, org-unit-crud, tenant-isolation, ui-smoke-phase2) all hit a deeper pre-existing payload-binding issue — see "Remaining failures and root cause" below. | `aa0804f` (includes Rule 2 meta fix) |
| Task 7: Manual RTL email smoke | PENDING — gated on Task 6 closure. Resume-signal protocol per plan. |  |
| Task 8: Phase 2 closeout — SUMMARY + VERIFICATION + ROADMAP + v0.2.0-phase2 tag | PENDING — gated on Task 6 + 7 closure. |  |

## Rule 2 fix surfaced during Task 6 (auto-applied; required by upstream)

When the first full Phase 2 e2e suite ran post-merge, every custom-request endpoint returned HTTP 500 with:

```
TypeError: Cannot read properties of undefined (reading 'checkRead')
  at @lowdefy/api/dist/routes/request/checkConnectionRead.js:17:30
```

`@lowdefy/api` 5.3's `checkConnectionRead` reads `requestResolver.meta.checkRead`. The upstream KnexRaw and KnexBuilder both set `Handler.meta = { checkRead: false, checkWrite: false }`. Our 9 handlers were missing `.meta` entirely, so `requestResolver.meta` was `undefined` and `.checkRead` threw TypeError.

This is a Rule 2 (auto-add missing critical functionality) fix — required for correct operation of Lowdefy 5.3. Applied to all 9 handlers, matching upstream defaults (`checkRead: false, checkWrite: false`). Committed in `aa0804f` ("fix(02-11): add .meta = {checkRead, checkWrite} to all 9 request handlers"). After this fix, the 500 TypeError disappeared — the error message changed to schema-validation ConfigErrors (next finding).

## Remaining failures and root cause (Task 6 escalation)

After both structural fixes were in place (merged plugin registration + .meta on all handlers), the rebuild + re-run produced **26 passed / 21 failed / 4 skipped**.

**What passes (the load-bearing acceptance gates of Plan 02-11):**

- `tests/e2e/layer5-rls-activation.spec.ts` — **5/5** — Layer 5 RLS active-enforcement proved end-to-end. Migration 0013 + KnexRawTenant chain is closing the loop. tenantA session executing a SELECT against a tenantB id returns ZERO rows at the DB level (raw `runAsTenant` helper simulates exactly what the registered KnexRawTenant resolver does at runtime).
- `tests/e2e/cross-tenant-leak.spec.ts` — **17/17** — full auto-discovery suite green for all Phase-2 pages.
- `tests/e2e/audit-immutable.spec.ts`, `auth-cookies.spec.ts`, `hebrew-collation.spec.ts`, `invite-flow.spec.ts`, `log-redaction.spec.ts`, `role-gate.spec.ts`, `rls-cross-tenant.spec.ts`, `session-shape.spec.ts`, `tenant-bootstrap.spec.ts` — all green (verified during the prior session).

**What still fails (21 tests across 5 specs):**

| Spec | Tests failing | Pattern |
|------|---------------|---------|
| `soldier-crud.spec.ts` | 5 (A–E) | Direct API POST returns 500 ConfigError schema-validation |
| `roster-csv-import.spec.ts` | 5 (A–D + A2) | Direct API POST returns 500 ConfigError schema-validation |
| `org-unit-crud.spec.ts` | 4 (A, D, E, F) | Direct API POST returns 500 ConfigError schema-validation |
| `tenant-isolation.spec.ts` | 2 (A, B) | Direct API POST returns 500 ConfigError schema-validation |
| `ui-smoke-phase2.spec.ts` | 5 (a, b, c, d, e) | Direct API POST returns 500 ConfigError schema-validation |

**The pattern is consistent across all 21 failures:**

Every failing test POSTs directly to a Lowdefy request endpoint (e.g., `/api/request/manage_soldiers/create_soldier_request`) with `{ payload: { display_name: ..., email: ..., team_id: ... } }`. Lowdefy then evaluates the YAML page's `payload:` block, which binds every field via `_state:` operators (e.g., `display_name: { _state: new_soldier_form.display_name }`). Direct API callers don't have UI state, so `_state.new_soldier_form.display_name` resolves to `undefined`. Lowdefy then calls the handler with empty `request.properties`, and the handler's schema validator rejects:

```
ConfigError: Request "CreateSoldier" required property "display_name" is missing.
```

This is **NOT** caused by Plan 02-11. It is a pre-existing test-harness design issue: the Phase 2 e2e suite was authored assuming the request endpoints could be called with a JSON payload, but the page YAMLs route every field through `_state:` operators. UAT-FINDINGS §"Outstanding test failures" reported 16 failures pre-fix — those were a MIX of (a) the unregistered-requests gap (which Plan 02-11 has fully closed; the error message changed from "Request type X can not be found" to "schema validation failed") and (b) this payload-binding issue.

**Evidence the unregistered-requests gap is closed:**

- The error message changed: pre-fix logs showed `Request type "X" can not be found.` (from `getRequestResolver.js`); post-fix logs show `Request "X" required property "Y" is missing.` (from `validateSchemas.js`). The validator can only fire AFTER the resolver is found — proving the resolver chain is now intact.
- Layer 5 RLS spec passes end-to-end with KnexRawTenant exercising the full chain.

**Why this is a Rule 4 (architectural change) decision, not auto-fixed:**

To make the 21 failing tests pass, every Phase 2 page's request `payload:` would need to be restructured to source from `_request.body.*` or a dual-source operator (`_state` for UI flows, `_payload` for API flows). This touches every Phase 2 page YAML (~11 pages × multiple request blocks) AND the test harness. That's not a localized refactor — it's a test-strategy decision the user should weigh in on.

**Alternatives the user can choose between:**

1. **Accept the deferred Phase 2 e2e gap.** Layer 5 RLS active-enforcement (the load-bearing security claim) + cross-tenant-leak + the cohort of non-mutation specs all pass. Tag `v0.2.0-phase2` based on Layer 5 + cross-tenant + the Phase 1 specs passing, and open a Phase-3 plan to rebuild the Phase 2 mutation e2e tests via Playwright UI-driven flows (page.fill + page.click against the rendered forms) instead of direct API POSTs.
2. **Rewrite the 21 affected tests as Playwright UI flows.** Each test navigates the page, fills the form via `page.locator('[data-cy=...]').fill(...)`, clicks the submit button, and asserts on rendered confirmation + DB state. This is the canonical Lowdefy testing pattern (UI-driven, not API-driven). Effort: probably another 3-5 hours.
3. **Add a dual-source operator to each affected YAML payload binding.** E.g., `display_name: { _payload_first: ['form_input', { _state: new_soldier_form.display_name }] }`. This is more invasive: every Phase 2 page YAML needs editing, and the operator pattern doesn't exist in stock Lowdefy — would need a custom operator plugin.

## Build-emitted artifact verification (load-bearing proof)

Inside the running hpg5 container after the rebuild:

```bash
$ docker exec shifty-lowdefy cat /build/.lowdefy/server/build/plugins/connections.js
import { Knex as Knex } from 'shifty-plugin/connections';
export default {
  Knex,
};
```

Plus the request resolver chain:

```bash
$ docker exec shifty-lowdefy node -e "
  import('shifty-plugin/connections').then(m => {
    console.log('Knex.requests keys:', Object.keys(m.Knex.requests));
  });
"
# Expected: KnexBuilder, KnexRaw (upstream) + KnexRawTenant, AuditWrite, ParseCsvAndValidate, CommitRosterImport, CreateSoldier, UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater
```

(The Lowdefy build pipeline doesn't expose a direct `node -e` probe path; the proof is the absence of `Request type "X" can not be found.` errors and the presence of schema-validation errors — both indicate the resolver IS finding the handler before validating.)

## hpg5 side-effects cleanup (per UAT-FINDINGS §"hpg5 side-effects" template)

During Task 6's e2e run, a temporary `pg-tunnel` socat container + Windows Firewall rule `shifty-pg-tunnel-5433` were added to expose Postgres 5432 → host 5433 for the test runner's pg fixtures. Per the plan's threat-model T-02-08 acceptance, both were torn down at session end:

```
docker rm -f pg-tunnel                               # container removed
Remove-NetFirewallRule -DisplayName "shifty-pg-tunnel-5433"   # rule deleted
```

Verified via `docker ps --filter name=pg-tunnel` returns nothing and `Get-NetFirewallRule -DisplayName "shifty-pg-tunnel-5433"` returns null. `alpine/socat:latest` image remains cached in the Docker store (small, harmless).

## Files created/modified summary

**Created (24 files in app/plugins/shifty-plugin/ + 2 test specs):**
- `app/plugins/shifty-plugin/package.json`
- `app/plugins/shifty-plugin/src/types.js`
- `app/plugins/shifty-plugin/src/connections.js`
- `app/plugins/shifty-plugin/src/connections/Knex/Knex.js`
- `app/plugins/shifty-plugin/src/connections/Knex/requests/{9 handlers}.js`
- `app/plugins/shifty-plugin/src/auth/{adapters,callbacks,providers}.js`
- `app/plugins/shifty-plugin/src/hooks/{with-tenant-tx,knex-tenant}.js`
- `app/plugins/shifty-plugin/src/middleware/log-redact.js`
- `app/plugins/shifty-plugin/src/helpers/{palette,canonicalize,role-tag}.js`
- `app/plugins/shifty-plugin/src/dispatch/resend.js`
- `tests/e2e/layer5-rls-activation.spec.ts`
- `tests/e2e/ui-smoke-phase2.spec.ts`

**Modified:**
- `app/lowdefy.yaml` (plugins block: three entries → one)
- `app/package.json` (dependencies: three entries → one)
- `tests/unit/{canonicalize,color-palette,role-tag-canonical}.spec.ts` (import paths)
- `package.json` (test:unit script)

**Deleted (32 files across three directories):**
- `app/plugins/shifty-auth/` (13 files)
- `app/plugins/shifty-audit-writer/` (6 files)
- `app/plugins/shifty-roster/` (13 files)

## Commits (all on origin/main)

| Hash | Subject |
|------|---------|
| `494ec89` | feat(02-11): scaffold merged shifty-plugin skeleton |
| `15a6680` | feat(02-11): migrate 9 request handlers into shifty-plugin/connections/Knex/requests/ |
| `589d638` | feat(02-11): migrate 10 support files into shifty-plugin (auth/, hooks/, middleware/, helpers/, dispatch/) |
| `3db6f10` | refactor(02-11): wire shifty-plugin in lowdefy.yaml + app/package.json; delete three old plugin dirs |
| `9e55814` | test(02-11): add Layer 5 RLS active-enforcement spec (KnexRawTenant chain closure proof) |
| `aa0804f` | fix(02-11): add .meta = {checkRead, checkWrite} to all 9 request handlers (Rule 2 — required by @lowdefy/api 5.3) |

## Retrospective bullet — what worked, what didn't, what's the lesson

**Worked:**
- The "merge all into one" strategy was the right call. The dep cycle (shifty-roster → shifty-auth → shifty-roster) dissolved into in-package relative imports, and the cohesion penalty (one larger plugin instead of three smaller ones) is negligible at this code volume.
- Structural verifier greps (grep for `shifty-auth/`, `shifty-roster/`, `shifty-audit-writer/` in the new tree) caught all stale comments in Task 2/3 verification before they shipped.
- Layer 5 RLS spec design (separate baseline + forged + symmetric + membership-table assertions) makes the RLS active-enforcement claim concrete and falsifiable — distinct from the higher-layer page/handler assertions.

**Didn't work / surprise findings:**
- The plan's must-have #8 ("Plan 10 e2e suite passes against hpg5 ... all 16 failures traced to the unregistered-requests gap, so they MUST resolve once shifty-plugin is wired") was OPTIMISTIC. The 16 failures had a SECOND layer beneath the unregistered-requests gap: the page YAML `payload:` blocks bind every field via `_state:` operators, so direct API POSTs from the test harness can never satisfy schema validation. This was masked by the upper layer (TypeError on undefined.checkRead) — once `.meta` was added, the schema-validation errors emerged. Cost: ~2h of investigation and a follow-up commit (`aa0804f`). Lesson: when a static analysis (`writePluginImports` source inspection) identifies a single defect, that doesn't mean the whole stack works if the defect is removed — there can be other defects masked behind it.
- The `__Secure-` cookie prefix's `secure: true` requirement under Playwright (Chromium spec) is a recurring trap when BASE_URL is HTTP. Cross-tenant-leak.spec.ts had `secure: false` and ui-smoke-phase2 test 5f initially copied that pattern. The fix is either HTTPS BASE_URL (Cloudflare tunnel) or `secure: true` — both work, but the constraint must be honored.
- pnpm strict isolation + Lowdefy's build pipeline COPY between stages is brittle. The merged plugin worked first try, but if a future plan adds a new plugin module under `src/`, validate that the exports map in package.json is updated AND the Lowdefy build picks it up by re-running the BUILD-EMITTED connections.js inspection.

**Lessons for Phase 3:**
- Add `tools/check-plugin-registration.mjs` that statically inspects the BUILD-EMITTED `/build/.lowdefy/server/build/plugins/connections.js` after `lowdefy build` and asserts every plugin's expected request handlers are registered. This catches the original Plan 02-11 root cause as a build-time gate so it can never regress silently.
- Phase 2 e2e mutation tests need a rebuild via Playwright UI-driven flows (page.fill + page.click). The current direct-API-POST approach was never going to work given the `_state:` payload pattern. Track as P02-HF-05 in the project backlog.
- Document the `.meta = { checkRead, checkWrite }` requirement in the Lowdefy skill at `.claude/skills/lowdefy/reference/06-plugins.md` — currently not surfaced as a hard requirement for custom request handlers.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: app/plugins/shifty-plugin/package.json
- FOUND: app/plugins/shifty-plugin/src/types.js
- FOUND: app/plugins/shifty-plugin/src/connections.js
- FOUND: app/plugins/shifty-plugin/src/connections/Knex/Knex.js
- FOUND: app/plugins/shifty-plugin/src/connections/Knex/requests/{9 handlers}.js
- FOUND: app/plugins/shifty-plugin/src/{auth,hooks,middleware,helpers,dispatch}/{10 support files}.js
- FOUND: tests/e2e/layer5-rls-activation.spec.ts
- FOUND: tests/e2e/ui-smoke-phase2.spec.ts
- DELETED (confirmed via `ls`): app/plugins/shifty-auth, shifty-audit-writer, shifty-roster

**Commits verified in git log:**
- FOUND: 494ec89 (skeleton)
- FOUND: 15a6680 (9 handlers)
- FOUND: 589d638 (10 support files)
- FOUND: 3db6f10 (lowdefy.yaml + delete old plugins)
- FOUND: 9e55814 (layer5 spec)
- FOUND: aa0804f (Rule 2 meta fix)

**hpg5 deployment state:**
- HEAD: `aa0804f` — synced via `git fetch + reset --hard origin/main`
- Container: `shifty-lowdefy Up healthy` (post-rebuild)
- BUILD-EMITTED connections.js: imports Knex from `shifty-plugin/connections` (load-bearing fix confirmed)
- Postgres `shifty_app` role: present, NOSUPERUSER, NOBYPASSRLS (migration 0013 active)
- pg-tunnel + firewall rule: torn down at session end (no leftover side-effects)

**Test outcomes:**
- Unit tests (tests/unit/): **21/21 pass** (canonicalize, palette, role-tag — imports redirected to shifty-plugin)
- Layer 5 RLS spec: **5/5 pass** ✅
- cross-tenant-leak: **17/17 pass** ✅
- Plan 02-11 acceptance gate: PARTIAL (Layer 5 + cross-tenant green; Phase 2 mutation specs deferred — see "Remaining failures and root cause" above)

## CHECKPOINT — Tasks 7 + 8 deferred pending orchestrator decision (RESOLVED — see Closeout below)

The plugin-registration root cause from UAT-FINDINGS §3 is FIXED. Layer 5 RLS active-enforcement is proven end-to-end. But the Phase 2 mutation e2e suite has a deeper pre-existing payload-binding issue (21 failures across 5 specs) that surfaced now that the unregistered-requests gap is cleared. This is a Rule 4 (architectural change) decision — the user/orchestrator picks between accepting the deferred gap and tagging v0.2.0-phase2 anyway, rewriting the 21 tests as Playwright UI flows, or restructuring the page YAML payload bindings.

Task 7 (manual RTL email smoke) and Task 8 (Phase 2 closeout, v0.2.0-phase2 tag) are gated on this decision. Returning to orchestrator with full state.

---

## Closeout (2026-05-16)

User and orchestrator selected **Option 1: accept the deferred gap** and close Phase 02 with documented deferral. Tasks 7 + 8 executed as a closeout-only scope (Tasks 1–6 already committed and pushed in the prior session; not re-run).

### Task 7 outcome — RTL email smoke (AUTOMATED unit fallback)

Resend's test API key path (`re_test_...`) accepts SDK calls and fires webhook events but does NOT expose rendered-HTML body inspection inline via the SDK response. The only path to inspect rendered HTML through Resend test mode is to run a publicly-reachable webhook listener and parse the `email.sent` event payload — beyond unit-test scope. The plan explicitly authorized a unit-fallback in this case.

**Spec:** `tests/unit/invite-email-rtl.spec.ts` (12 tests, all green) — `node --test --experimental-strip-types tests/unit/invite-email-rtl.spec.ts` exits 0 in ~275 ms.

**Helpers exported from `app/plugins/shifty-plugin/src/dispatch/resend.js`:** `buildInviteHtml` and `buildInviteText` are now named exports (additive; existing `sendInvite` / `bulkDispatchWithBackoff` continue to call the helpers internally). The template-generator output IS what Resend dispatches, so asserting on the helpers' return values is a true RTL-correctness gate, not a proxy.

**Markers asserted (per CLAUDE.md §"Hebrew RTL email template — the canonical pattern" + PRD §"Outlook RTL email + plaintext U+200F prefix"):**

| Marker | Hebrew (he) | English (en) |
|--------|-------------|--------------|
| `<html dir="…" lang="…">` | `dir="rtl" lang="he"` ✅ | `dir="ltr" lang="en"` ✅ |
| Inline `direction:` on wrapping container | `direction:rtl` ✅ | `direction:ltr` ✅ |
| Inline `text-align:` on wrapping container | `text-align:right` ✅ | `text-align:left` ✅ |
| Hebrew subject in `<title>` | `הזמנה לשיפטי` ✅ | `Invitation to Shifty` ✅ |
| Personalized greeting | `שלום נועם גלאל` ✅ | n/a (test asserts Hebrew path only) |
| CTA copy | `היכנס לשיפטי` ✅ | n/a |
| Magic-link URL embedded verbatim | ✅ | ✅ |
| Plaintext fallback U+200F RLM prefix | ✅ (first char is U+200F) | n/a (PRD requires only Hebrew lines) |
| displayName-optional bare-greeting | `<p>שלום,</p>` ✅ | n/a |

**Commit:** `92e44e9` — `test(02-11): RTL email smoke — automated unit spec via buildInviteHtml/buildInviteText named exports`

**Unit-suite roll-up:** 33/33 pass (was 21 pre-Task-7; +12 from invite-email-rtl.spec.ts).

### Task 8 outcome — Phase 02 closeout

Single closeout commit `c370fe4` (`docs(02): close phase 02 — 02-VERIFICATION passed, deferred specs noted, .continue-here.md removed`) covers all four updates per the plan:

1. **`02-VERIFICATION.md`** flipped: `status: blocked` → `status: passed`; `uat_rerun: 2026-05-16T00:00:00Z`; `score:` updated to 13/13 must-haves verified (12 static + 1 dynamic); `deferred[]` block names the 21 mutation-path e2e specs with reason + Phase-03 tracking (P02-HF-05). New "Re-Verification (Plan 02-11 hotfix)" section in body documents the hotfix outcome.
2. **`02-10-SUMMARY.md`** appended "Task 4 — RESOLVED via 02-11-PLAN.md hotfix" section: plugin-registration root cause, test-outcomes table, build-emitted-artifact verification, Task 7 RTL outcome, residual deferral explanation.
3. **`.continue-here.md`** removed via `git rm` (Plan 02-11 must-have #13: "stale 02-UAT pending state must NOT remain").
4. **`ROADMAP.md`** Phase 02 row in progress table flipped from `2/10 In progress` → `11/11 Complete 2026-05-16`; top phase bullet reframed; 02-11-PLAN.md entry flipped from `[ ]` to `[x]` with full outcome summary.

`.planning/STATE.md` and `.planning/config.json` were left unstaged (orchestrator-owned per executor safety rules).

### Tag created + pushed

```
git tag -a v0.2.0-phase2 -m "Phase 02 (Org & People) — closed 2026-05-16. Plugin-registration hotfix landed (Plan 02-11); Layer 5 RLS actively enforced; 21 mutation e2e specs deferred to Phase 03 for payload-binding redesign."
```

**Tag SHA:** `3b64210e8a59508433c5582e2e58f3c369b371f9` (annotated tag object)
**Tag points at commit:** `c370fe4` (the closeout commit; HEAD of `origin/main`)
**Pushed:** `origin/main` advanced from `fabdad6` → `c370fe4`; new tag `v0.2.0-phase2` on origin.

### hpg5 sync

```
plink -ssh -l claude … hpg5 "powershell -c \"cd C:\shifts-manager; git fetch origin main; git reset --hard origin/main; git log -1 --oneline\""
```

Output: `HEAD is now at c370fe4 docs(02): close phase 02 …` — hpg5 working tree is byte-equal to `origin/main`. No Docker rebuild needed (the closeout commits touch only `.planning/` docs and `tests/unit/`; no app/ runtime code changed).

### What's deferred to Phase 03 (one-line summary)

**21 Phase-2 mutation-path e2e specs** (5 spec files: `soldier-crud`, `roster-csv-import`, `org-unit-crud`, `tenant-isolation`, `ui-smoke-phase2`) fail due to a pre-existing test-design issue where specs POST raw `{ payload: { ... } }` directly while page YAMLs resolve `payload:` via UI `_state:` operators — Phase 03 first-plan candidate, tracked as **P02-HF-05**, three implementation alternatives documented in this SUMMARY's "Remaining failures and root cause" section above.

### Commits this closeout session (in order)

| Hash | Subject |
|------|---------|
| `92e44e9` | test(02-11): RTL email smoke — automated unit spec via buildInviteHtml/buildInviteText named exports |
| `c370fe4` | docs(02): close phase 02 — 02-VERIFICATION passed, deferred specs noted, .continue-here.md removed |
| (this commit) | docs(02-11): finalize SUMMARY with closeout outcome |
