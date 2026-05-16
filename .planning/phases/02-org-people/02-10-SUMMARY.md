---
phase: 02-org-people
plan: 10
subsystem: testing
tags: [e2e, unit-tests, csv-fixtures, playwright, validation, b1-fix, w1-fix]
dependency_graph:
  requires: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08]
  provides: [phase-2-verification-surface]
  affects: []
tech_stack:
  added: []
  patterns:
    - node:test with --experimental-strip-types for .spec.ts unit tests
    - skip-on-stack-down pattern for all Playwright e2e specs (try/catch + test.skip)
    - {TENANT_A_TEAM_UUID} token substitution in CSV fixtures (runtime-injectable)
    - W1 split-timing budgets for ROST-13 SLO re-interpretation (dbCommitWall / firstBatchWall / totalWall)
key_files:
  created:
    - tests/playwright.config.ts
    - tests/unit/canonicalize.spec.ts
    - tests/unit/color-palette.spec.ts
    - tests/unit/role-tag-canonical.spec.ts
    - tests/e2e/roster-csv-import.spec.ts
    - tests/e2e/soldier-crud.spec.ts
    - tests/e2e/tenant-isolation.spec.ts
    - tests/fixtures/csv/clean.csv
    - tests/fixtures/csv/smart-quote.csv
    - tests/fixtures/csv/dup-email.csv
    - tests/fixtures/csv/bidi-mark.csv
    - tests/fixtures/csv/perf-50.csv
    - tests/fixtures/db/seed-phase2.sql
  modified:
    - tests/e2e/_fixtures/seed-tenants.ts (extended TenantFixture with teamId + role_tag rows)
    - package.json (added test:unit script + type:module)
decisions:
  - "B1: tests/unit/*.spec.ts files are a SEPARATE test surface from plugin-colocated tests; duplication is intentional per VALIDATION Wave 0 checklist"
  - "W1: ROST-13 SLO re-interpreted as three split-timing budgets (dbCommitWall<2000ms, firstBatchWall<8000ms, totalWall<35000ms) — literal <10s impossible at Resend 2 req/s"
  - "Test runner: node:test with --experimental-strip-types handles .spec.ts on Node 22 without tsx dependency"
  - "perf-50.csv ships as static fixture (not inline-generated) for grep-discoverability and reproducibility"
  - "Task 4 (manual smoke + hpg5 phase-gate) is a checkpoint:human-action — deferred to human executor"
metrics:
  duration: ~15
  completed_date: "2026-05-14"
  tasks_completed: 3
  tasks_total: 4
  files_created: 13
  files_modified: 2
---

# Phase 02 Plan 10: Verification surface (tests, fixtures, unit specs) Summary

Phase 2 verification surface closed — 3 E2E specs + 3 unit specs (B1) + 5 CSV fixtures (W1) + 1 seed SQL + playwright.config.ts committed. Task 4 (manual hpg5 phase-gate smoke) is a `checkpoint:human-action` that requires a running Lowdefy stack and is returned to the human.

## What Was Built

### Task 1: Validation infrastructure (commit e9fb3b2)

- **tests/playwright.config.ts**: Playwright 1.x config (was missing from repo; Wave 0 requirement). Configured for `tests/e2e/` test directory, `workers: 1`, skip-retry in local mode, Chromium project.
- **5 CSV fixtures** at `tests/fixtures/csv/`:
  - `clean.csv`: 5 valid rows (happy-path D-09)
  - `smart-quote.csv`: 1 row with literal U+2019 (RIGHT SINGLE QUOTATION MARK) in display_name — kibbutz canary verified with xxd (bytes E2 80 99)
  - `dup-email.csv`: 2 rows sharing admin-a@example.test (D-11/ROST-10)
  - `bidi-mark.csv`: 3 rows with literal U+200E (LRM, E2 80 8E), U+200F (RLM, E2 80 8F), U+202E (RLO, E2 80 AE) byte-prefixed — all verified
  - `perf-50.csv`: 50 rows (perf row-1..perf row-50) for W1 at-scale SLO exercise (ROST-13)
- **tests/fixtures/db/seed-phase2.sql**: Deterministic offline seed (fixed UUIDs, idempotent ON CONFLICT DO NOTHING, two tenants each with root org_unit + leaf team + 3 role_tags)
- **tests/e2e/_fixtures/seed-tenants.ts** extended: `TenantFixture` gained `teamId`, `roleTagDriving/Comms/Medic`; `seedOne()` now INSERTs a leaf org_unit and 3 role_tag rows per tenant; `getTenantBIds()` includes `teamId` in orgUnits list
- **package.json**: Added `test:unit` script (`node --test --experimental-strip-types app/plugins/shifty-roster/tests/*.test.mjs ... tests/unit/*.spec.ts`) + `"type": "module"` to eliminate ES module reparsing warning

### Task 2: B1 fix — three tests/unit/*.spec.ts files (commit c9b2e2f)

All three files import from `app/plugins/shifty-roster/src/helpers/*` and provide a SEPARATE test surface from the plugin-colocated `.test.mjs` files. Duplication is intentional: Validation gate gets an independent surface.

- **tests/unit/canonicalize.spec.ts** (7 assertions):
  - Kibbutz canary: `canonicalizeText('נועם ג'לאל') === 'נועם גלאל'` (U+2019 stripped)
  - All 7 bidi codepoints (U+200E, U+200F, U+202A–U+202E) stripped in loop
  - Hebrew gershayim U+05F4 preserved (not a quote mark)
  - ASCII apostrophe U+0027 preserved
  - null/undefined → empty string
  - Whitespace collapse + trim

- **tests/unit/color-palette.spec.ts** (6 assertions):
  - PALETTE has 24 unique entries
  - **W1 canary: `pickNextColor(0) === 2`** (step-by-2 stride)
  - `pickNextColor(22) === 0` (wraparound)
  - Sentinel -1, null, undefined → 0

- **tests/unit/role-tag-canonical.spec.ts** (8 assertions):
  - `canonicalizeRoleTag('Driving') === 'driving'` (lowercase kebab proof)
  - Spaces → dashes, multi-dash collapse, trim leading/trailing
  - Smart-quote (U+2019) stripped through canonicalizeText chain → `'medics'`
  - null/empty → empty string
  - DB CHECK regex `^[a-z][a-z0-9-]*$` compliance gate for all non-empty outputs

**Runtime**: All 21 assertions pass under `node --test --experimental-strip-types` in ~166ms.

### Task 3: Three E2E specs (commit 4736506)

**tests/e2e/roster-csv-import.spec.ts** (6 tests, ROST-08..13):
- Test A: `clean.csv` 5-row happy path with psql COUNT verification
- **Test A2 (W1)**: `perf-50.csv` 50-row import with split-timing assertions:
  - `dbCommitWall < 35_000ms` (handler-return budget)
  - `dbCommitWall < 2_000ms` (when handler returns quickly — DB-only path)
  - `commitRes.firstBatchMs < 8_000ms` (opportunistic, if server instruments it)
  - ROST-13 re-interpretation docstring in file header + test body
  - DB: `SELECT COUNT(*) FROM soldier WHERE display_name LIKE 'perf row-%'` returns 50
- Test B: smart-quote kibbutz canary — byte-equal `'נועם גלאל'` assertion in psql (no U+2019)
- Test C: duplicate-email skip (dup-email.csv) + soldier count unchanged
- Test D: bidi-mark stripping at write time — psql loop asserts no bidi mark bytes survive
- Test E: `roster_import_log` live-schema column check: `imported_by IS NOT NULL`, `source='csv'`, `rows_created >= 0`, `error_details` is valid JSON (Pitfall P12)

**tests/e2e/soldier-crud.spec.ts** (6 tests, ROST-01..05):
- Tests A/B/C: admin create / edit-with-notes / archive happy path with psql verification
- Test D: team_manager edits soldier in own managed team → 200 (is_manager_or_admin)
- Test E: team_manager cross-tenant forge (tenant-B soldier_id) → 0 rows or 403 (T-02-06)
- Test F: display_name byte-equal after rename; soldier UUID stable

**tests/e2e/tenant-isolation.spec.ts** (5 tests, SEC):
- Test A: CSV with tenant-B email is NOT flagged is_duplicate in tenant-A parse scope
- Test B: UpdateSoldier forge with tenant-B soldier_id → 0 rows or 403 (T-02-01)
- Test C: team_detail with tenant-B team-id renders no tenant-B members (page content check)
- Test D: roster_import_log RLS scope — tenant-A context returns only tenant-A rows
- Test E: collectPhase2PageIds() smoke — confirms cross-tenant-leak.spec.ts will auto-discover Phase-2 pages

All specs use the `skip-on-stack-down` pattern (try/catch → `test.skip` on connect failure or 502/503) so they gracefully no-op when the Lowdefy stack is not running locally.

### Task 4: Manual phase-gate (CHECKPOINT:HUMAN-ACTION — not executed)

Task 4 requires the hpg5 Lowdefy stack to be up and rebuilds to complete. It is a `checkpoint:human-action` gate that returns to the human for execution. See `02-10-PLAN.md §Task 4` for the full checklist (unit run + check-queries + Playwright e2e + 6 manual UI scenarios + RTL email smoke).

## Deviations from Plan

### Auto-additions (Rule 2 — Missing critical functionality)

**1. [Rule 2 - Missing] playwright.config.ts was absent from repository**
- **Found during**: Task 1 setup
- **Issue**: VALIDATION.md Wave 0 requires `tests/playwright.config.ts`; file was not present despite being listed in plan frontmatter `files_modified`
- **Fix**: Created `tests/playwright.config.ts` with correct `testDir: './e2e'`, single-worker config, and Chromium project
- **Commit**: e9fb3b2

**2. [Rule 2 - Missing] test:unit npm script absent from package.json**
- **Found during**: Task 1
- **Issue**: No mechanism to run the new tests/unit/*.spec.ts files
- **Fix**: Added `"test:unit": "node --test --experimental-strip-types ..."` + `"type": "module"` to root package.json
- **Commit**: e9fb3b2 (script), c9b2e2f (type:module)

**3. [Rule 2 - Missing] seed-phase2.sql not in original plan task list but required by VALIDATION Wave 0**
- **Found during**: Task 1
- **Issue**: VALIDATION.md Wave 0 lists `tests/fixtures/db/seed-phase2.sql` as required
- **Fix**: Created deterministic seed SQL with fixed UUIDs, two tenants, leaf teams, role_tags
- **Commit**: e9fb3b2

## Known Stubs

None. All CSV fixtures contain real byte content verified by automated assertions. The E2E specs skip gracefully when the stack is not reachable but do not stub any assertions — they are real tests that require a live stack for Test A2's perf numbers and the psql DB verification steps.

## Threat Flags

None. This plan creates test infrastructure only — no new network endpoints, no new auth paths, no schema changes, no trust boundary mutations.

## Self-Check

Files verified:
- FOUND: tests/playwright.config.ts
- FOUND: tests/unit/canonicalize.spec.ts
- FOUND: tests/unit/color-palette.spec.ts
- FOUND: tests/unit/role-tag-canonical.spec.ts
- FOUND: tests/e2e/roster-csv-import.spec.ts
- FOUND: tests/e2e/soldier-crud.spec.ts
- FOUND: tests/e2e/tenant-isolation.spec.ts
- FOUND: tests/fixtures/csv/clean.csv
- FOUND: tests/fixtures/csv/smart-quote.csv (U+2019 byte verified)
- FOUND: tests/fixtures/csv/dup-email.csv
- FOUND: tests/fixtures/csv/bidi-mark.csv (U+200E/U+200F/U+202E bytes verified)
- FOUND: tests/fixtures/csv/perf-50.csv (50 rows verified)
- FOUND: tests/fixtures/db/seed-phase2.sql

Commits verified:
- e9fb3b2: chore(02-10): Task 1
- c9b2e2f: feat(02-10): Task 2 — B1 fix
- 4736506: feat(02-10): Task 3 — E2E specs

Unit tests: 21/21 passing under node --test --experimental-strip-types (~166ms)

## Self-Check: PASSED

## Phase 2 Retrospective Feed

**What worked:**
TDD on the three helper modules (canonicalize, palette, role-tag) in Plan 02-02 paid forward — the helpers had clean, named exports that the tests/unit/*.spec.ts files imported directly with zero shim code. The patterns map (02-PATTERNS.md) was the single most useful artifact: having the exact shape of org-unit-crud.spec.ts as an analog made authoring soldier-crud.spec.ts a matter of substitution rather than invention. The four-layer tenant defense pattern (session → query filter → page auth → Layer-4 SQL scope) is now verified at three independent test surfaces (cross-tenant-leak auto-discovery, tenant-isolation forge tests, soldier-crud Test E). The upstream Auth.js hashToken spike (B3 gate, Plan 06) eliminated an entire class of invite-token uncertainty.

**What didn't:**
The VALIDATION.md Wave 0 checklist initially said "Vitest" (`tests/unit/vitest.config.ts`) but the project actually uses `node:test` — the B1 fix reconciled this by using `node --test --experimental-strip-types` which works natively on Node 22 for .spec.ts files. The ROST-13 SLO (10s for 50 rows) was unreachable at Resend 2 req/s and required the W1 re-interpretation documented in both the test and PLAN.md.

**Patterns established for Phase 3:**
- The SELECT-driven safe INSERT for membership (FROM soldier s, org_unit ou with dual tenant_id cross-check) is the canonical mutation shape for any cross-table write in the Phase 2+ codebase
- The Layer-4 in-SQL scope check (`WHERE id = :id AND tenant_id = session.tenant_id`) returns ZERO rows as the access-denied signal — never a 403 from the SQL layer itself
- The canonicalize-at-write rule (two-stage: parse preview + commit handler both run canonicalizeText) is the belt-and-braces contract for any user-supplied text field
- skip-on-stack-down is the canonical pattern for all e2e specs: `try { res = await request.post(...) } catch { test.skip(true, 'stack not reachable') }`

---

## Task 4 — RESOLVED via 02-11-PLAN.md hotfix

**Plan 02-11 executed 2026-05-16.** This section closes the original "Task 4 live UAT deferred (checkpoint:human-action)" hold by documenting what the hotfix landed and the residual deferral.

### Plugin-registration root cause (one-sentence summary)

`@lowdefy/build`'s `writePluginImports/` directory has writers for blocks/actions/agents/auth/connections/icons/operators but **no `writeRequestImports`** — so the three prior plugins' `requests: [9 names]` declarations in their `types.js` files were tracked for schema validation but never emitted into any runtime artifact, leaving every Phase-2 custom request type (`ParseCsvAndValidate`, `CreateSoldier`, `AuditWrite`, `KnexRawTenant`, …) unregistered with Lowdefy 5.3's runtime. See `02-UAT-FINDINGS.md` §3 for the original discovery and `02-11-SUMMARY.md` "Load-bearing structural change" for the fix.

### Test outcomes (post-hotfix, hpg5)

| Suite | Pre-Plan-02-11 | Post-Plan-02-11 |
|-------|----------------|-----------------|
| `tests/e2e/layer5-rls-activation.spec.ts` (NEW) | — | **5/5 green** ✅ |
| `tests/e2e/cross-tenant-leak.spec.ts` | broken (resolver-not-found) | **17/17 green** ✅ |
| Phase-1 specs (audit, auth-cookies, hebrew, invite, log-redact, role-gate, rls, session, tenant-bootstrap) | broken (resolver-not-found) | **all green** ✅ |
| Phase-2 mutation specs (soldier-crud, roster-csv-import, org-unit-crud, tenant-isolation, ui-smoke-phase2) | broken (resolver-not-found) | **21 failures DEFERRED to Phase 03** — see below |
| `tests/unit/invite-email-rtl.spec.ts` (Task 7, NEW) | — | **12/12 green** ✅ |
| Full unit suite (3 helper specs + RTL spec) | 21/21 | **33/33 green** ✅ |

### Plugin-registration fix verified end-to-end

- BUILD-EMITTED `/build/.lowdefy/server/build/plugins/connections.js` (inside the running hpg5 container) post-rebuild reads:
  ```js
  import { Knex as Knex } from 'shifty-plugin/connections';
  export default { Knex };
  ```
  Pre-fix it read `from '@lowdefy/connection-knex/connections'` only — proving the merged plugin's Knex displaces the upstream one (last-wins via `buildTypeClass`'s `store[typeName] = ...`), and the upstream's `KnexBuilder`/`KnexRaw` handlers are preserved because we spread `upstream.Knex.requests` into the merged map.
- Runtime error class changed from `Request type "X" can not be found.` (resolver missing) to `Request "X" required property "Y" is missing.` (schema validator firing AFTER the resolver is found) — proves the resolver chain is now intact.
- Layer 5 RLS: tenantA session executing a `SELECT` against a tenantB row returns ZERO rows at the DB level (forge test, `runAsTenant` helper simulates exactly what the registered `KnexRawTenant` resolver does at runtime).

### Task 7 RTL email smoke outcome

**Automated unit spec.** `tests/unit/invite-email-rtl.spec.ts` (12 tests) asserts the RTL markers on the OUTPUT of `buildInviteHtml` and `buildInviteText` (newly named-exported from `app/plugins/shifty-plugin/src/dispatch/resend.js`). Resend test-mode webhook inspection of rendered HTML would require a publicly-reachable webhook listener — beyond unit-test scope. The unit assertions cover:

- `<html dir="rtl" lang="he">` on root (Hebrew locale)
- Inline `direction:rtl; text-align:right` on the wrapping container (Outlook-variant defense)
- Hebrew subject + greeting + CTA copy round-trip
- Magic-link URL embedded verbatim
- English (`en`) locale flips to `dir="ltr" lang="en"` + `text-align:left`
- Plaintext fallback prefixes lines with U+200F RLM (PRD §"Outlook RTL email + plaintext U+200F prefix")
- Display-name-optional bare-greeting paths (he html + plaintext)
- Locale fallback to `he` when undefined

12/12 pass locally (`node --test --experimental-strip-types tests/unit/invite-email-rtl.spec.ts`).

### Residual deferral — 21 mutation-path e2e specs

The 21 failures across `soldier-crud.spec.ts`, `roster-csv-import.spec.ts`, `org-unit-crud.spec.ts`, `tenant-isolation.spec.ts`, and `ui-smoke-phase2.spec.ts` are a **pre-existing test-harness design issue**, not a Plan-02-11 regression. Every failing test POSTs raw `{ payload: { ... } }` directly to the Lowdefy request endpoint, but every Phase-2 page YAML resolves its `payload:` block via UI `_state:` operators (e.g., `display_name: { _state: new_soldier_form.display_name }`). Direct API callers don't have UI state → `_state.<form>.<field>` resolves to `undefined` → handler's schema validator rejects.

Three alternatives the user/orchestrator considered:
1. **Accept the deferred gap** (chosen). Layer 5 RLS + cross-tenant-leak + Phase-1 specs all green; tag `v0.2.0-phase2` based on those; open Phase-3 follow-up plan.
2. Rewrite as Playwright UI flows (`page.fill` + `page.click`). 3–5h.
3. Add a dual-source operator (`_payload_first: ['form_input', { _state: ... }]`) to every Phase-2 page YAML. More invasive.

**Tracked as P02-HF-05 in project backlog.** First Phase 03 plan to address.
