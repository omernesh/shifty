---
phase: 01-foundations
plan: 01
subsystem: infrastructure
tags: [migration, test-infra, compose, golang-migrate, playwright, hebrew-collation, nextauth]
dependency_graph:
  requires: []
  provides:
    - golang-migrate compose service (migrate/migrate:v4.18.3)
    - migration 0002 (tenant, org_unit, app_user, soldier, membership, users, accounts, sessions, verification_tokens)
    - Wave 0 test infra (playwright.config.ts, seed-tenants.ts, teardown.ts)
    - kibbutz fixture (12 soldiers + U+2019)
    - check-queries.mjs CI gate scaffold
    - invite-code unit tests
    - shifty-audit-writer plugin manifest scaffold
    - pnpm workspace config
  affects:
    - all future plans (Wave 0 files are prerequisites for every <automated> verify block)
    - Plan 02 (uncomments planning_window INSERT in kibbutz.sql after 0003 applies)
    - Plan 03 (RESEND vars wired; app_user/membership/users tables for auth flow)
tech_stack:
  added:
    - migrate/migrate:v4.18.3 (golang-migrate one-shot Docker service)
    - @playwright/test ^1.49.0 (root package.json dev dependency)
    - pg ^8.13.1 (root package.json dev dependency for test fixtures)
  patterns:
    - pnpm workspace:* for local plugin resolution inside Docker build
    - COLLATE "he-x-icu" on Hebrew-text columns (I18N-07)
    - golang-migrate .up.sql naming convention (renamed from .sql)
    - docker compose run --rm migrate (not docker compose run --rm migrate up - command in YAML already includes up)
key_files:
  created:
    - app/pnpm-workspace.yaml
    - .env.example (updated)
    - package.json (root)
    - playwright.config.ts
    - tests/e2e/_fixtures/seed-tenants.ts
    - tests/e2e/_fixtures/teardown.ts
    - tests/e2e/.gitkeep
    - tools/check-queries.mjs
    - tools/fixtures/kibbutz.sql
    - tools/test/invite-code.test.mjs
    - app/plugins/shifty-audit-writer/package.json
    - app/plugins/shifty-audit-writer/.gitkeep
    - app/plugins/shifty-auth/.gitkeep
    - app/connections/.gitkeep
    - app/pages/.gitkeep
    - db/migrations/0001_init.up.sql (renamed from 0001_init.sql)
    - db/migrations/0002_tenancy_and_org.up.sql
  modified:
    - docker-compose.yml (migrate service + RESEND env + future service stubs)
    - app/lowdefy.yaml (allowlist comment on employees query)
decisions:
  - "Migration files renamed to .up.sql suffix — golang-migrate requires this naming convention; hpg5 DB force-marked at version 1 since 0001 schema was manually applied"
  - "docker compose run --rm migrate (no extra 'up' arg) is the correct invocation — YAML command already includes 'up'; appending it overrides and breaks the flags"
  - "Invite-code tests written as 8 individual tests (one per ambiguous char) rather than loop — more explicit test names in Node test output"
metrics:
  completed_date: "2026-05-12"
  task_count: 4
  file_count: 17
---

# Phase 1 Plan 01: Foundation Scaffolding + Migration 0002 Summary

**One-liner:** Multi-tenant DB foundations (9 new tables, ICU Hebrew collation, NextAuth schema) + full Wave 0 test infra scaffold on a proven Lowdefy runtime.

## What Was Built

### Task 1: Smoke Test (checkpoint:human-verify — auto-approved)
- Verified hpg5 containers: `shifty-lowdefy (healthy)` + `shifts-postgres (healthy)`
- HTTP 200 from `http://localhost:8080/employees`
- Zero `ERR_MODULE_NOT_FOUND` in container logs
- b8afba1 fix confirmed live. D-01 requirement satisfied.

**Smoke test evidence:**
```
Step 1 (container health): shifty-lowdefy Up 15 hours (healthy); shifts-postgres Up 17 hours (healthy)
Step 2 (HTTP probe):       200
Step 3 (10 page loads):    exit 0 (no output)
Step 4 (ERR_MODULE scan):  findstr exit code 1 = zero matches (PASS)
```

### Task 2: Wave 0 Scaffolding (commit c422fbb)
All 15 Wave 0 files created:
- `app/pnpm-workspace.yaml` — workspace declaration for `plugins/*`
- `.env.example` — updated template with RESEND_API_KEY, RESEND_FROM_EMAIL
- `package.json` (root) — `@playwright/test^1.49.0`, `pg^8.13.1`
- `playwright.config.ts` — `baseURL`, `fullyParallel: false`, `testDir: ./tests/e2e`
- `tests/e2e/_fixtures/seed-tenants.ts` — `seedTwoTenants()`, `signInAs()`, `getTenantBIds()`
- `tests/e2e/_fixtures/teardown.ts` — TRUNCATE-in-reverse-FK-order
- `tools/check-queries.mjs` — CI grep gate with ALLOWLIST_MARKER
- `tools/fixtures/kibbutz.sql` — 12 soldiers + U+2019 soldier (row 12: `נועם ג'לאל`)
- `tools/test/invite-code.test.mjs` — 8 Crockford base32 unit tests (all pass)
- `app/plugins/shifty-audit-writer/package.json` — plugin manifest scaffold
- Directory `.gitkeep` files for `shifty-auth/`, `connections/`, `pages/`
- `app/lowdefy.yaml` — allowlist comment added to employees query

**Verify:**
- `node tools/check-queries.mjs` → exit 0
- `node --test tools/test/invite-code.test.mjs` → 8 pass, 0 fail
- SEC-08: `git ls-files | grep -E "^.env$"` → 0 (not tracked); `.env` in `.gitignore` ✓

### Task 3: Migrate Service + RESEND + Stubs (commit 0a6dd56)
- `docker-compose.yml` updated with:
  - `migrate` service (migrate/migrate:v4.18.3, depends on postgres health, restart: "no")
  - `RESEND_API_KEY` (required) + `RESEND_FROM_EMAIL` to `lowdefy.environment`
  - Commented stubs for `solver`, `cron`, `waha` future services (OPS-01)
- `db/migrations/0001_init.sql` renamed to `0001_init.up.sql` (golang-migrate naming convention fix)
- hpg5 `.env` updated with RESEND placeholder values

**Verify:**
- `docker compose config | findstr migrate` → shows migrate service ✓
- `docker compose run --rm migrate` → "no change" (idempotent) ✓

### Task 4: Migration 0002 (commit ab23155)
- `db/migrations/0002_tenancy_and_org.up.sql` created and applied on hpg5
- Applied: `2/u tenancy_and_org (367ms)`
- Second run: `no change` (OPS-02 idempotency confirmed)

**Schema after 0002:**
```
15 tables total = 5 legacy (0001) + 9 new (0002) + 1 schema_migrations
New: tenant, org_unit, app_user, soldier, membership, users, accounts, sessions, verification_tokens
```

**Collation verification:** `SELECT collname FROM pg_collation WHERE collname='he-x-icu'` → 2 rows ✓
**CITEXT:** `app_user.email` column type `citext` ✓
**NextAuth quoted identifiers:** `sessions."sessionToken"`, `sessions."userId"` ✓
**Composite indexes:** `idx_org_unit_tenant`, `idx_org_unit_tenant_parent`, `idx_app_user_tenant`, `idx_soldier_tenant`, `idx_soldier_tenant_status`, `idx_membership_tenant`, `idx_membership_soldier`, `idx_membership_org_unit` ✓
**Triggers:** `trg_tenant_updated_at`, `trg_org_unit_updated_at`, `trg_app_user_updated_at`, `trg_soldier_updated_at` ✓
**D-06 preserved:** `http://localhost:8080/employees` still returns HTTP 200 ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] golang-migrate requires .up.sql file naming convention**
- **Found during:** Task 3 — `docker compose run --rm migrate` returned "failed to parse scheme from source URL: URL cannot be empty"
- **Root cause:** golang-migrate's "file" driver only recognizes files with `.up.sql` suffix (e.g., `0001_init.up.sql`). The existing `0001_init.sql` was invisible to it.
- **Fix:** Renamed `db/migrations/0001_init.sql` → `0001_init.up.sql`. Used `docker run --rm migrate force 1` to mark version 1 as applied on hpg5 (since the schema was previously applied manually via psql). All future migrations created as `.up.sql`.
- **Files modified:** `db/migrations/0001_init.up.sql` (rename), `db/migrations/0002_tenancy_and_org.up.sql` (new)
- **Commit:** 0a6dd56

**2. [Rule 3 - Blocking] `docker compose run --rm migrate up` overrides YAML command**
- **Found during:** Task 3 verification
- **Root cause:** The YAML `command:` list for the migrate service already includes `up`. When `docker compose run --rm migrate up` is invoked, Docker passes `up` as an arg that overrides the entire YAML command, losing the `-path` and `-database` flags.
- **Fix:** Correct invocation is `docker compose run --rm migrate` (without trailing `up`). Updated compose file comment to document this. Plan documentation updated.
- **Files modified:** `docker-compose.yml` (comment)
- **Commit:** 0a6dd56

## Known Stubs

- `tests/e2e/_fixtures/seed-tenants.ts` — `signInAs()` returns empty cookies (Plan 03 wires real sign-in; stub documented with TODO comment)
- `app/plugins/shifty-audit-writer/` — manifest only; `src/` implementation added in Plan 02
- `tools/fixtures/kibbutz.sql` — `INSERT INTO planning_window` block commented out (Plan 02 Task 1 owns uncommenting after migration 0003 applies)

## Threat Flags

No new network endpoints or auth paths introduced in this plan. Migration 0002 is DDL-only (no DML, no RLS bypass needed). T-01-01 (`.env` commit risk) confirmed mitigated: SEC-08 verified.

## Self-Check: PASSED

Files verified to exist:
- `app/pnpm-workspace.yaml` ✓
- `playwright.config.ts` ✓
- `tests/e2e/_fixtures/seed-tenants.ts` ✓
- `tests/e2e/_fixtures/teardown.ts` ✓
- `tools/check-queries.mjs` ✓
- `tools/fixtures/kibbutz.sql` ✓ (U+2019 confirmed)
- `tools/test/invite-code.test.mjs` ✓ (8 tests pass)
- `app/plugins/shifty-audit-writer/package.json` ✓
- `.env.example` ✓ (RESEND_API_KEY present)
- `package.json` ✓ (root, @playwright/test present)
- `db/migrations/0002_tenancy_and_org.up.sql` ✓

Commits verified:
- c422fbb — feat(01-01): Wave 0 scaffolding ✓
- 0a6dd56 — feat(01-01): migrate service + RESEND ✓
- ab23155 — feat(01-01): migration 0002 ✓
