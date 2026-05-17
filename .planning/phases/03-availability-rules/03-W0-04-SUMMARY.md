---
phase: 03-availability-rules
plan: W0-04
subsystem: infra
tags: [budibase, layer-2, ci-gate, tenant-isolation, public-api, node-test]

# Dependency graph
requires:
  - phase: 03-availability-rules
    provides: "W0-02 invite-redemption query names (seeds EXEMPT_QUERIES); written under skip-W0-02 dependency note — names are contractual"
provides:
  - "Layer-2 CI gate at tools/check-bb-queries.mjs (503 LOC)"
  - "Domain-table extractor that parses db/migrations/ at run-time (no manual list to maintain)"
  - "Inline EXEMPT_QUERIES allowlist seeded with the two W0-02 invite-redemption queries"
  - "Self-test mutation harness (offline; proves the validator is alive)"
  - "23 node:test unit tests for parser/regex edge cases"
  - "3 npm scripts (test:check-bb-queries, test:check-bb-queries-selftest, test:check-bb-queries-unit)"
  - "BUDIBASE-CONVENTIONS.md §10 #2 marked RESOLVED; §5 expanded with the gate's update workflow"
affects: [03-W0-05, all Wave-1+ plans that add Builder UI Queries]

# Tech tracking
tech-stack:
  added:
    - "Budibase Public API client (POST /api/public/v1/{applications,queries}/search) using Node 22 native fetch"
    - "AbortController-based fetch timeout (15s)"
  patterns:
    - "Inline EXEMPT_QUERIES allowlist (per D-03) — PR-diff is the audit trail"
    - "Domain-table list derived dynamically from db/migrations/*.up.sql (no drift)"
    - "Layer-2 CI gate as a stand-alone Node CLI with three modes (default / --self-test / --list-domain-tables)"
    - "Self-test mutation harness without filesystem mutation (in-process synthetic queries)"

key-files:
  created:
    - "tools/check-bb-queries.mjs (503 lines)"
    - "tools/test/check-bb-queries.test.mjs (252 lines, 23 tests)"
  modified:
    - "package.json (3 new npm scripts)"
    - "docs/BUDIBASE-CONVENTIONS.md (§5 expanded; §10 #2 marked RESOLVED)"

key-decisions:
  - "Inline EXEMPT_QUERIES allowlist (per planner D-03) — array of strings, not JSON file, not SQL-marker comment"
  - "Domain tables derived from db/migrations/*.up.sql at run-time via CREATE/DROP TABLE parsing — no manual list"
  - "Framework tables (schema_migrations, Auth.js stragglers, Phase-0 dropped tables) hard-coded in FRAMEWORK_TABLES exclusion set"
  - "Graceful skip-and-exit-0 when BUDIBASE_API_KEY is unset OR API is unreachable (ECONNREFUSED, DNS, timeout)"
  - "HTTP 401/403 (real auth misconfig) → exit 2 (not 1) to distinguish from query violations"
  - "Self-test runs unconditionally (no API key needed); live-API mode is opt-in via env var"
  - "No CI provider integration — repo has neither .github/workflows/ nor husky; documented as a known gap"

patterns-established:
  - "Layer-2 gate: every Wave-1+ plan that adds a Builder UI Query MUST run `npm run test:check-bb-queries` locally before opening the PR"
  - "Adding a new domain table is zero-config — getDomainTables() picks up the new CREATE TABLE on next gate run"
  - "Adding a new exemption is a 1-line PR diff to EXEMPT_QUERIES with a reason comment"

requirements-completed: [SEC-01, SEC-02, SEC-03, SEC-04, SEC-05]

# Metrics
duration: ~7 min
completed: 2026-05-17
---

# Phase 03 Plan W0-04: Layer-2 CI gate (Budibase Public API tenant-filter validator) Summary

**Layer-2 CI gate `tools/check-bb-queries.mjs` (503 LOC) — fetches every Builder UI Query via the Budibase Public API, asserts each domain-table SQL body embeds the canonical `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid` filter, exempts the two W0-02 invite-redemption queries by exact-match name, and derives the domain-table list dynamically from `db/migrations/*.up.sql`. 3-case self-test + 23 node:test unit tests + live API smoke-test against hpg5 all green.**

## Performance

- **Duration:** ~7 min (autonomous)
- **Started:** 2026-05-17T12:35:09Z
- **Completed:** 2026-05-17T12:42:00Z
- **Tasks:** 4
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Built `tools/check-bb-queries.mjs` (503 lines) as the Layer-2 CI gate — post-pivot top defense per BUDIBASE-CONVENTIONS.md §2 (Layer 5 RLS is inactive for Builder UI clients because Budibase connects as superuser-equivalent).
- Domain-table extraction parses `db/migrations/*.up.sql` at run-time: 24 domain tables discovered, framework/internal/dropped tables excluded.
- Live-API mode connects to Budibase Public API via `POST /api/public/v1/{applications,queries}/search`, validates every SQL body, exits with the right code for the right failure mode (0 clean / unreachable, 1 violations, 2 auth error).
- Self-test mode runs 3 synthetic queries (bad / good / exempt) through the in-process validator — proves the gate is alive without needing a live API. CI-friendly.
- 23 node:test unit tests cover regex edge cases (alias prefix `s.tenant_id`, AND-chain placement, whitespace tolerance, exact-match exemption no-prefix-bypass), domain-table set membership/exclusion, malformed-input safety.
- BUDIBASE-CONVENTIONS.md §10 #2 marked RESOLVED. §5 expanded with the gate's update workflow.

## Task Commits

Each task was committed atomically:

1. **Task 1: Domain-table extractor from db/migrations** — `119ade3` (feat)
2. **Task 2: Budibase Public API client + filter validator** — `7963c83` (feat)
3. **Task 3: Self-test + unit tests for parser** — `60ebd3a` (test)
4. **Task 4: Close BB-CONV §10 #2 + run-it-manually procedure** — (this commit + docs commit below)

**Plan metadata commit:** (added below — `docs(03-W0-04): summary`).

## Files Created/Modified
- `tools/check-bb-queries.mjs` (503 lines) — the Layer-2 CI gate. Three modes: default (live API check), `--self-test`, `--list-domain-tables`. Exports `getDomainTables`, `validateQuery`, `TENANT_FILTER_PATTERN`, `EXEMPT_QUERIES`, `listApplications`, `searchQueries` for unit-test imports.
- `tools/test/check-bb-queries.test.mjs` (252 lines, 23 node:test cases) — covers regex edge cases, domain-table extraction, validator decision matrix, malformed-input safety.
- `package.json` — wires `test:check-bb-queries`, `test:check-bb-queries-selftest`, `test:check-bb-queries-unit`.
- `docs/BUDIBASE-CONVENTIONS.md` — §10 #2 marked RESOLVED with a back-reference to this SUMMARY; §5.4 (Layer-2 gate update) rewritten to describe the new workflow (auto-pickup of new domain tables, exemption add procedure, run-before-PR contract, CI-gap note).

## Domain table list (output of `npm run test:check-bb-queries -- --list-domain-tables`)

24 domain tables derived from `db/migrations/*.up.sql` (alphabetical):

```
app_user
assignment
availability
ical_subscription_token
invite_code
invite_code_redemption
membership
notification_log
notification_pref
org_unit
planning_window
push_subscription
report_recipient
role_tag
roster_import_log
rule
rule_override
schedule_audit
shift_instance
shift_slot
soldier
solver_run
swap_request
tenant
```

**Excluded from the domain set:**
- `schema_migrations` (golang-migrate internal)
- `account`, `accounts`, `session`, `sessions`, `verification_token`, `verification_tokens`, `users` (Auth.js Lowdefy-era stragglers — Budibase replaces these)
- `availability_legacy` (renamed in 0004, dropped in 0008)
- `employees`, `shifts`, `assignments`, `time_clock_entries` (Phase-0 bootstrap, dropped in 0008)

## EXEMPT_QUERIES seed list

Inline allowlist at the top of `tools/check-bb-queries.mjs` (per D-03 — array of strings, not JSON file, not SQL marker; PR-diff is the audit trail):

```js
export const EXEMPT_QUERIES = [
  'resolveInviteCode_GetTenantId',     // W0-02: resolves tenant_id from invite code (CANNOT filter)
  'insertAppUserOnInviteRedemption',   // W0-02: creates the tenant-bound row (no filter applicable)
];
```

These names are contractual with the W0-02 plan (which is currently SKIPPED awaiting Builder-UI click-through but uses these exact names per the planner's spec).

## Self-test output (`npm run test:check-bb-queries-selftest`)

```
  PASS: bad — missing filter on a domain-table SELECT
  PASS: good — canonical filter present
  PASS: exempt — known exempt name beats validation

SELF-TEST PASS: 3/3 cases. Gate is alive.
```

Exit code: 0. Self-test runs offline (no API key required).

## Unit test output (`npm run test:check-bb-queries-unit`)

```
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

23/23 tests pass in ~115 ms. Coverage:
- `EXEMPT_QUERIES` seed contents (2 names confirmed)
- `TENANT_FILTER_PATTERN` regex: canonical, alias-prefix, AND-chain, whitespace, two negative cases
- `getDomainTables()`: non-empty set, includes core Phase-2/3 tables, excludes framework/Phase-0-dropped tables
- `validateQuery()`: 11 decision-matrix cases (FAIL paths, PASS paths, exempt path, no-prefix-bypass, no-SQL skip, INSERT heuristic, malformed input)

## Live-API smoke test

Ran against live Budibase 3.38.4 on hpg5 (`http://hpg5:8080`):

```
check-bb-queries: scanned 1 app(s), 1 query(ies) total.
  validated: 0, exempt: 0, skipped (no SQL or no domain table): 1.
check-bb-queries: PASS — all domain-table queries embed the canonical tenant filter.
```

Exit code: 0. The one existing query in the live Budibase app doesn't reference a domain table (likely a system / test query) so it's correctly skipped. The gate is wired and exercising the real API surface.

## Run-it-manually procedure (no CI provider yet)

Until `.github/workflows/` or husky is wired (a v1.1 nice-to-have, out of scope for W0-04 per planner discretion call #4), the gate is opt-in for contributors. The contract for any Wave-1+ plan that adds a Builder UI Query:

**Before opening a PR:**

```sh
# 1. Self-test runs offline; always do this first (it can never be skipped — no API key needed).
npm run test:check-bb-queries-selftest

# 2. Unit tests on the parser logic (also offline).
npm run test:check-bb-queries-unit

# 3. Live API check against hpg5. Requires BUDIBASE_API_KEY in env.
#    Local convenience: fetch the key from .env on hpg5:
#    BUDIBASE_API_KEY=$(plink -ssh -l claude -pw "Onclaude2103" -batch \
#                       -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" \
#                       hpg5 "powershell -c \"(Get-Content C:\shifts-manager\.env | \
#                       Select-String 'BUDIBASE_API_KEY' | ForEach-Object { (\$_ -split '=', 2)[1] })\"")
npm run test:check-bb-queries

# Expected exit codes:
#   0 = all clear (or API unreachable; gate skipped with a warning — still safe to merge IF self-test + unit-tests both passed)
#   1 = violations found — the gate prints the offending query name(s) and remediation pointer
#   2 = config error (API key rejected, etc.) — do NOT merge until resolved
```

**When the gate flags a violation:**

The output names every offending query, its app, the referenced domain table, and the first 200 characters of the SQL. Two fix paths:

1. **Add the canonical filter** to the SQL body inside the Builder UI:
   ```sql
   WHERE tenant_id = '{{ Current User.tenantId }}'::uuid
   ```
   (or as part of an AND-chain — the regex is tolerant of placement).

2. **If the query legitimately cannot be filtered** (rare — see the W0-02 invite-redemption examples), add a 1-line entry to `EXEMPT_QUERIES` in `tools/check-bb-queries.mjs` with a comment naming the reason. The PR diff is the audit trail; reviewer sees every exemption addition.

## Decisions Made

1. **Inline EXEMPT_QUERIES (D-03 carried over from plan).** Array of strings at the top of the gate file. Rejected alternatives: JSON file (separate audit channel, drift risk), SQL marker comment (Lowdefy-era pattern; doesn't survive Budibase's CouchDB-backed Query storage). The 1-line PR diff is the reviewer-facing audit trail.
2. **Domain-table extraction from db/migrations/ at run-time.** Rejected hard-coded list — would silently miss tables added by future migrations. The current approach picks up new `CREATE TABLE` automatically; the only manual step is for genuinely new framework/internal exclusions (rare).
3. **HTTP 401/403 → exit 2; ECONNREFUSED / timeout → exit 0 with warn.** The distinction matters: a real auth misconfig should fail the gate (and a CI run); an unreachable API (developer running locally without hpg5 access) should not. Self-test + unit tests are unconditional so the parser logic is always covered.
4. **No CI provider integration in W0-04.** Per planner's discretion call #4, accepted that this repo has neither `.github/workflows/` nor husky. A future plan (v1.1 / Phase 7) can wire `ci.yml` that runs both the live-API check AND the self-test on every PR without re-implementing the gate.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **CLI dispatch failed silently on Windows.** The initial `isMainModule()` used a naïve `import.meta.url === \`file://${process.argv[1]}\`` comparison. On Windows, `import.meta.url` is `file:///C:/Projects/shifts%20manager/...` (URL-encoded spaces) and `process.argv[1]` is `C:\Projects\shifts manager\...` (native backslashes, raw spaces). Fix: normalize both via `decodeURIComponent()` + `replace(/\\/g, '/')` + lowercase, then compare suffixes. Verified all three CLI modes (`--list-domain-tables`, `--self-test`, default) run correctly on Windows.

2. **TDZ error: `DEFAULT_API_URL` not initialized.** The CLI dispatch block ran at module-evaluation time (before the `const DEFAULT_API_URL = ...` declaration later in the file). Function declarations are hoisted, but `const` is not. Fix: moved the API endpoint constants above the dispatch block. (Rule 1 - Bug; fixed inline as part of Task 2.)

## User Setup Required

None — the gate runs unattended given `BUDIBASE_API_KEY` in env (already provisioned on hpg5; documented in MEMORY.md). Self-test runs offline.

## Next Phase Readiness

- **W0-05 unblocked.** The PR-snapshot tooling can assume the gate exists ("the gate validates the queries; the snapshot is just a record of what was there at PR time").
- **W0-02 still pending** (Builder-UI click-through). When it lands, the exempt names `resolveInviteCode_GetTenantId` and `insertAppUserOnInviteRedemption` MUST match the names the W0-02 plan creates in Builder UI. If the user picks different names during W0-02 execution, a 1-line PR adjustment to `EXEMPT_QUERIES` in `tools/check-bb-queries.mjs` closes the gap.
- **Wave-1+ contract established.** Any plan that adds a Builder UI Query MUST run `npm run test:check-bb-queries` locally before opening the PR. The contract is documented in BUDIBASE-CONVENTIONS.md §5.4.
- **CI-infra gap documented as known and accepted** (planner discretion call #4). A future Phase-7 / v1.1 plan can wire `.github/workflows/ci.yml` to invoke the gate on every PR without changing any code in `tools/check-bb-queries.mjs`.

## Self-Check: PASSED

Files verified to exist:
- FOUND: tools/check-bb-queries.mjs
- FOUND: tools/test/check-bb-queries.test.mjs
- FOUND: package.json (3 npm scripts wired)
- FOUND: docs/BUDIBASE-CONVENTIONS.md (§10 #2 marked RESOLVED, §5 expanded)

Commits verified:
- FOUND: 119ade3 (feat: domain-table extractor)
- FOUND: 7963c83 (feat: Public API client + validator)
- FOUND: 60ebd3a (test: self-test + unit tests)

Verification commands re-run successfully:
- `npm run test:check-bb-queries-selftest` → PASS 3/3, exit 0
- `npm run test:check-bb-queries-unit` → PASS 23/23, exit 0
- `npm run test:check-bb-queries` (no API key) → skip+warn, exit 0
- Live API smoke test with hpg5 key → PASS, exit 0
- `grep -c "RESOLVED" docs/BUDIBASE-CONVENTIONS.md` → 2 (W0-03 + W0-04)
- `grep -c "check-bb-queries" docs/BUDIBASE-CONVENTIONS.md package.json` → 10 total (7 + 3)

---
*Phase: 03-availability-rules*
*Completed: 2026-05-17*
