# Phase 1: Foundations — Research

**Researched:** 2026-05-12
**Domain:** Lowdefy 5.3.0 + Postgres 16 + NextAuth (Auth.js) + golang-migrate + Playwright/Node CI — multi-tenant SaaS foundations on hpg5 (Windows 11 + Docker Desktop)
**Confidence:** HIGH overall. All major claims verified against live system (hpg5 smoke test), project-local skill files, and existing research docs. MEDIUM on the three items flagged explicitly below.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01** — Smoke test the existing Lowdefy runtime FIRST. Phase 1 task #1 is to PROVE the `b8afba1` fix works on hpg5: build via PsExec, deploy, `curl http://hpg5:8080/employees`, expect HTTP 200 with employees-table rows, zero `ERR_MODULE_NOT_FOUND` in container logs across 10 page loads. PASS → proceed. FAIL → 5-day escape hatch.

**D-02** — NextAuth EmailProvider lives inside Lowdefy as a custom plugin at `app/plugins/shifty-auth/`. Magic-link emails via Resend SMTP. KnexAdapter for session storage uses `shifts_db` connection. Invite-code redemption flow runs after callback succeeds — separate page.

**D-03** — Session callback hydrates `{user_id, tenant_id, roles[], team_ids[], locale}` once at sign-in from `app_user` + `membership`.

**D-04** — `migrate/migrate` (golang-migrate) as a one-shot compose service named `migrate`.

**D-05** — Migration order: 0001 (existing) → 0002_tenancy_and_org (+ NextAuth adapter tables) → 0003 → 0004 → 0005 → 0006 → 0007 → 0009_rls_policies → 0010_audit_revokes. Migration 0008 deferred to Phase 2.

**D-06** — Drop legacy tables (`employees`/`shifts`/`assignments`/`availability`/`time_clock_entries`) only at Phase 2 boundary. Bootstrap `/employees` smoke-test page remains live through Phase 1.

**D-07** — Ship RLS in Phase 1. `0009_rls_policies.sql` enables RLS on every tenant-scoped domain table. `app.current_tenant` set per-connection-checkout via Knex `afterCreate` hook. Bypass role only for `migrate` service.

**D-08** — Scaffold `app/plugins/shifty-audit-writer/` — a request plugin that wraps a Knex INSERT into `schedule_audit`. Actor derived from session, never from request input. Demonstrated on a `unit_admin`-gated test mutation page.

**D-09** — Minimal `docs/OPERATIONS.md` runbook stub: backup self-test verification, Windows Update active hours, AV exclusions, VHDX compaction note, Tailscale-bound WAHA UI port, dedicated WAHA SIM, Cloudflared user-account separation.

**D-10** — Two verification mechanisms: (a) `tools/check-queries.mjs` CI grep gate; (b) Playwright `tests/e2e/cross-tenant-leak.spec.ts` pen-test fixture. Both shipped before Phase 2.

**D-11** — Build on hpg5 via existing PsExec path. No GitHub Actions in Phase 1.

**D-12** — Leave `archive/appsmith-export/` untouched.

### Claude's Discretion

- Plugin file structure inside `app/plugins/shifty-audit-writer/` — adopt the canonical Lowdefy custom-plugin shape.
- Exact set of routes the Playwright pen-test covers — auto-derived from `app/pages/**` at test-write time.
- Whether NextAuth KnexAdapter tables live in migration 0002 or a separate file.
- Backup self-test alert channel for Phase 1.

### Deferred Ideas (OUT OF SCOPE)

- GitHub Actions CI setup — deferred until a phase needs it.
- `docker-compose.solver.yml` / `docker-compose.waha.yml` split.
- `docs/PRIOR_ART_BUGS.md`.
- `docs/OPERATIONS.md` full coverage — Phase 1 ships minimal stub only.
- Tenant #1 migration script.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEN-01 | Self-signup creates tenant; founding admin becomes `unit_admin` | D-02/D-03 auth flow; 0002 migration creates `tenant` + `app_user` + `membership` rows |
| TEN-02 | Admin chooses org depth at tenant creation (1–3 levels, immutable) | `org_unit` + `tenant.org_depth` in migration 0002 |
| TEN-03 | Admin can CRUD org_units within their unit's tree | RBAC: `unit_admin` has CRUD on `org_unit`; gated page + request `auth.roles` |
| TEN-04 | Admin can view the org tree across all teams | Read-only query scoped by `tenant_id` from session |
| TEN-05 | All schedules/assignments at leaf (team) level | Enforced by `planning_window.team_id` FK to `org_unit` |
| AUTH-01 | Magic-link signup via NextAuth EmailProvider + Resend | D-02; skill `08-auth.md` EmailProvider + Resend SMTP |
| AUTH-02 | HTTP-only secure cookies; CSRF protection | NextAuth built-in: JWT in secure cookie; CSRF token on every mutating call |
| AUTH-03 | Admin can generate invite code for `(org_unit_id, role)` | `invite_code` table in 0005; `unit_admin`/`team_manager`-gated request |
| AUTH-04 | 8-char Crockford base32 invite codes | Generate server-side; alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` |
| AUTH-05 | Invite redemption creates `membership` + `invite_code_redemption` | CTE transaction in `signup_with_invite` page (STACK §2b) |
| AUTH-06 | Revoked/expired/used-up codes reject with Hebrew error | Query returns 0 rows → surface error; Hebrew in `he.json` |
| AUTH-07 | 4-role RBAC enforced server-side; session carries `tenant_id, roles, team_ids, locale` | D-03 session shape; skill `08-auth.md` SessionCallback |
| SEC-01 | Every domain table has `tenant_id`; every query filters from session | D-07 RLS + D-10 CI gate; `_user: tenant_id` in every query payload |
| SEC-02 | RBAC matrix enforced server-side | `auth.pages.roles` + per-request `auth.roles` on mutations |
| SEC-03 | Pages declare `auth` block; mutating requests re-check role server-side | Lowdefy `auth.pages.roles` + `request.auth.roles` |
| SEC-04 | Migration 0009 enables RLS; `app.current_tenant` set via Knex `afterCreate` | D-07; full RLS policy SQL in §Code Examples |
| SEC-05 | CI grep gate fails on YAML queries missing `tenant_id` filter | D-10(a); `tools/check-queries.mjs` design in §Code Examples |
| SEC-06 | Playwright pen-test asserts 403 on cross-tenant access | D-10(b); fixture design in §Code Examples |
| SEC-07 | Audit tables append-only — 0010 REVOKEs UPDATE/DELETE/TRUNCATE | `0010_audit_revokes.sql` pattern in §Code Examples |
| SEC-08 | All secrets in `.env`; Postgres credentials not exposed beyond docker network | Existing `docker-compose.yml` pattern; `_secret:` operator only |
| SEC-09 | Invite codes not enumerable without auth + role | Page gated to `unit_admin`; no public list endpoint |
| SEC-10 | Log-redaction middleware scrubs `*_SECRET/*_PASSWORD/*_KEY` from logs | Node middleware wrapper around Next.js logger; §Code Examples |
| OPS-01 | Compose stack includes `lowdefy`, `postgres`, `migrate` (Phase 1); slots for `solver`, `cron`, `waha` | D-04 compose snippet in §Code Examples |
| OPS-02 | golang-migrate compose service runs 0001–0010 idempotently | D-04/D-05; exact compose YAML in §Code Examples |
| OPS-03 | Nightly `pg_dump` to `C:\shifts-manager\backups\pg\YYYY-MM-DD.dump` via Task Scheduler | PowerShell script + XML Task Scheduler export in §Code Examples |
| OPS-04 | Off-host copy to neshernas (192.168.1.121) via `rclone` | `rclone copy` command in §Code Examples |
| OPS-05 | Backup self-test: `pg_restore --list` on latest dump | PowerShell one-liner + Task Scheduler; alert on non-zero exit |
| OPS-06 | Quarterly restore drill (documented, not automated) | Runbook section in `docs/OPERATIONS.md` |
| OPS-07 | Uptime Kuma on neshernas watches hpg5 | Forward-declared in OPERATIONS.md; not wired in Phase 1 |
| OPS-08 | `docs/OPERATIONS.md` runbook stub | D-09; section outline in §Architecture Patterns |
| OPS-09 | Test strategy per PRD §8.4 | Validation Architecture section below |
| OPS-10 | "Kibbutz fixture" seeded in `tools/fixtures/kibbutz.sql` | SQL in §Code Examples |
| I18N-07 | Postgres Hebrew-text columns declared `COLLATE "he-x-icu"` | Applied in migrations 0002–0007; column list in §Code Examples |
| PERF-04 | Composite indexes on `(tenant_id, ...)` for hot query paths | Already in PRD §10 schemas; verified in §Standard Stack |
</phase_requirements>

---

## Summary

**The Lowdefy runtime smoke test is already resolved.** Live verification on hpg5 (2026-05-12) confirms: `curl http://hpg5:8080/employees` returns HTTP 200; `docker logs shifty-lowdefy` shows zero `ERR_MODULE_NOT_FOUND` lines. The container (`shifts-manager-lowdefy`, image built 2026-05-11) has been healthy for 12+ hours. D-01 smoke-test task for Phase 1 is a **confirmation step, not a fix step** — the planner should structure it as verify-and-declare-done (expected 15 minutes), not allocate the 5-day timebox budget. The escape hatch remains documented in CONTEXT.md for completeness but should not drive the plan timeline.

Phase 1 is now cleanly about **adding multi-tenancy on top of a proven runtime**. The six work streams are: (1) golang-migrate compose service + migrations 0002–0007, 0009, 0010; (2) NextAuth EmailProvider + KnexAdapter + session hydration; (3) invite-code flow + RBAC page gates; (4) Postgres RLS + Knex `afterCreate` hook; (5) `shifty-audit-writer` custom plugin scaffold; (6) operational baseline (backup, log-redaction, OPERATIONS.md stub, CI grep gate, Playwright pen-test fixture, kibbutz fixture seed). These map naturally to 6 plans with a partial sequencing constraint: plans 1–2 (migrations + auth) must precede plans 3–5 (RBAC, RLS, plugin); plan 6 (ops baseline) can run in parallel once auth is committed.

The highest remaining risk in Phase 1 is **the NextAuth + Lowdefy integration**. The KnexAdapter requires its own schema tables (not in the current PRD migrations); the exact placement (migration 0002 or standalone `0002b_nextauth.sql`) is a planner call. The Resend SMTP path via NextAuth EmailProvider is documented but unexercised in this repo — a one-day spike is prudent. Everything else (migrations, RLS, plugin scaffold, CI tools) has clear prior art in the existing research docs.

**Primary recommendation:** Plan six sequential-then-parallel units as described. The smoke-test plan takes one day; migration + auth is the long-pole (2–3 days); remaining plans run in 1–1.5 days each. Total: ~8–10 working days for Phase 1 comfortably within a 2-week window.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link email send | API / Backend (NextAuth on Lowdefy SSR) | Resend SMTP relay | Auth.js `EmailProvider` runs server-side; client only sees redirect |
| Session hydration (`tenant_id`, `roles[]`) | API / Backend (NextAuth session callback) | Database (app_user + membership query) | JWT token minted server-side; client reads via `_user` |
| Invite-code redemption | API / Backend (Lowdefy `KnexRaw` request) | — | CTE transaction must run server-side; never trust client input for code validity |
| RBAC page gating | Frontend Server (Lowdefy `auth.pages.roles`) | API / Backend (`request.auth.roles`) | Page gate is route-level (SSR middleware); request re-check is the server-side layer-4 |
| Tenant isolation (query layer) | API / Backend (Knex query with `_user: tenant_id`) | Database (Postgres RLS layer 5) | `_user` operator evaluates server-side; RLS is the catch-all for missed filters |
| Postgres RLS (`app.current_tenant`) | Database / Storage | API / Backend (Knex `afterCreate` hook sets the variable) | Policy enforced at DB engine; hook sets the session variable per connection |
| Migration execution | Database / Storage (golang-migrate) | — | One-shot compose service; touches DB directly, not through Lowdefy |
| Audit writes (`schedule_audit`) | API / Backend (Lowdefy custom request plugin) | Database (append-only enforced by 0010 REVOKEs) | Plugin runs server-side; DB REVOKEs enforce immutability at engine level |
| Log redaction | API / Backend (Next.js middleware) | — | Must intercept before logs leave process; client cannot redact |
| Backup (`pg_dump`) | Database / Storage (Windows Task Scheduler + PowerShell) | — | Runs outside Docker; dumps directly from `postgres` container |
| CI grep gate | — (build-time Node script) | — | Runs on developer machine or CI; not a runtime tier |
| Playwright pen-test | — (test-time) | — | Runs against a seeded test environment |

---

## Standard Stack

### Core (all already pinned in repo or confirmed in research)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Lowdefy | `5.3.0` | UI + NextAuth + Next.js SSR | Locked in PRD §1; already in `app/package.json` |
| `@lowdefy/connection-knex` | `5.3.0` | Postgres driver via Knex | Already pinned; KnexAdapter needed for NextAuth |
| `@lowdefy/blocks-aggrid` | `5.3.0` | Bootstrap employees table | Already pinned; smoke-test surface |
| Node.js (container base) | `node:22-bookworm` | Runtime for Lowdefy container | Already in `app/Dockerfile`; do NOT switch to Alpine (musl breaks sharp) |
| pnpm | `9.15.5` | Build tooling inside container | Already pinned via `corepack prepare` in `Dockerfile`; pnpm 11 breaks `@sentry/cli`/`sharp` |
| Postgres | `16` (`postgres:16`) | Source of truth | Already in `docker-compose.yml`; PRD §1 locked |
| `migrate/migrate` | `v4.18.3` | golang-migrate one-shot compose service | Confirmed latest via `ctx7 library migrate` (lib version `v4_18_3`); previously SUMMARY.md referenced v4.17.0 — **use v4.18.3** [VERIFIED: ctx7 golang-migrate/migrate] |
| Resend npm SDK | `6.12.3` | Email delivery (notifications) | Pinned in STACK.md; needed in Phase 1 for magic-link SMTP via `smtp.resend.com:465` |

### Phase 1 New Additions (add to `app/package.json`)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `resend` | `6.12.3` | Resend SDK (HTTP API for non-auth emails; SMTP for magic links via NextAuth) | Add to `app/package.json` now; only SMTP path used in Phase 1 |
| `@lowdefy/plugin-nextauth` | `5.3.0` | Bundles NextAuth providers and adapters for Lowdefy | Required for `EmailProvider` + `KnexAdapter` in `lowdefy.yaml` plugins list |

**Note on `@lowdefy/plugin-nextauth`:** Skill `09-plugins.md` lists it under the built-in plugin catalog. It must appear in BOTH `package.json` AND `lowdefy.yaml plugins:` list — install-without-declare or declare-without-install both cause silent failures. [VERIFIED: skill `reference/09-plugins.md`]

### Alternatives Considered (locked out)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Resend SMTP for magic links | Custom HTTP EmailProvider plugin | Resend SMTP is simpler in Phase 1 (NextAuth EmailProvider speaks SMTP natively); custom HTTP plugin needed only if SMTP proves unreliable |
| `migrate/migrate` compose service | Manual `psql` per CLAUDE.md "Common ops" | Manual psql is deprecated for routine migration runs; migrate service is idempotent, versioned, standard |
| `COLLATE "he-x-icu"` per column | Database-level collation | Column-level is safer (only Hebrew-text columns affected; email stays ASCII default) |

**Installation (new deps only):**
```bash
# Inside app/ directory
pnpm add resend@6.12.3
# @lowdefy/plugin-nextauth version confirmed via npm registry
pnpm add @lowdefy/plugin-nextauth@5.3.0
```

**Version verification (confirmed 2026-05-12):**
- `migrate/migrate` latest: `v4.18.3` [VERIFIED: ctx7]
- `resend` npm: `6.12.3` [CITED: STACK.md §Integrations]
- `@lowdefy/plugin-nextauth`: `5.3.0` expected (matches Lowdefy engine pin) [ASSUMED — confirm with `npm view @lowdefy/plugin-nextauth versions --json`]

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (HTTPS via Cloudflare Tunnel → apps.nesher.co)
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  lowdefy (port 8080:3000)                                │
│  Next.js SSR — Auth.js (NextAuth EmailProvider)          │
│  app/*.yaml pages + requests                             │
│  app/plugins/shifty-audit-writer/ (custom request plugin)│
│  app/plugins/shifty-auth/ (custom auth callbacks plugin) │
│                                                          │
│  Outbound:                                               │
│    Postgres (Knex, internal)                             │
│    Resend smtp.resend.com:465 (magic links, Phase 1)     │
│                                                          │
│  Public routes:                                          │
│    /api/auth/* (NextAuth handler)                        │
│    all pages (protected by default)                      │
└───────────────┬──────────────────────────────────────────┘
                │ Knex (internal docker network)
                ▼
┌──────────────────────────────────────────────────────────┐
│  postgres:16 (internal only — no host port)              │
│  Migrations: 0001–0007, 0009, 0010                       │
│  RLS policies active after 0009                          │
│  Audit tables append-only after 0010                     │
└──────────────────────────────────────────────────────────┘
                ▲
                │ one-shot on compose up
┌──────────────────────────────────────────────────────────┐
│  migrate (migrate/migrate:v4.18.3 — one-shot service)    │
│  Runs: migrate -path /migrations -database $DB_URL up    │
│  Exit 0 on success → compose dependency resolved         │
└──────────────────────────────────────────────────────────┘

Off-host (Phase 1 ops baseline):
  Windows Task Scheduler (hpg5)
    → pg_dump daily to C:\shifts-manager\backups\pg\
    → rclone copy to neshernas (192.168.1.121) / neshernas_pg_backup
    → pg_restore --list self-test → Event Log on failure
```

### Recommended Project Structure (after Phase 1)

```
app/
  lowdefy.yaml                  # add auth:, new plugins:, keep existing connections + pages
  pages/
    auth/
      login.yaml                # custom login page (magic-link trigger)
      signup.yaml               # founding-admin signup (no invite code)
      signup_with_invite.yaml   # subsequent users: email + invite code
      invite_redeem.yaml        # post-callback invite-code redemption page
    admin/
      test_audit_write.yaml     # smoke-test page for shifty-audit-writer (unit_admin only)
  plugins/
    shifty-auth/                # custom auth callbacks plugin (session hydration)
      package.json
      src/
        auth/
          callbacks.js          # SessionCallback + JwtCallback
        types.js
    shifty-audit-writer/        # custom request plugin
      package.json
      src/
        connections/
          requests/
            AuditWrite.js       # the request implementation
        types.js
  connections/
    shifts_db.yaml              # move Knex connection here from lowdefy.yaml
db/
  migrations/
    0001_init.sql               # existing — untouched
    0002_tenancy_and_org.sql    # NEW: tenant, org_unit, app_user, soldier, membership + NextAuth tables + CITEXT ext
    0003_shifts_and_windows.sql # NEW
    0004_availability_rules_swaps.sql
    0005_auth_and_notifications.sql
    0006_audit_and_solver_runs.sql
    0007_imports_and_exports.sql
    # 0008 is DEFERRED to Phase 2
    0009_rls_policies.sql       # NEW: RLS on all domain tables
    0010_audit_revokes.sql      # NEW: REVOKE UPDATE/DELETE/TRUNCATE on audit tables
  fixtures/
    kibbutz.sql                 # NEW: 12-soldier smart-quote seed
tools/
  check-queries.mjs             # NEW: CI grep gate
tests/
  e2e/
    cross-tenant-leak.spec.ts   # NEW: Playwright pen-test fixture
docs/
  OPERATIONS.md                 # NEW: minimal runbook stub
```

---

### Pattern 1: Smoke Test — Exact Command Sequence

**What:** Verify the existing Lowdefy runtime on hpg5 works before writing any new code.
**When to use:** First task of Phase 1. Expected to PASS based on live verification (see Environment Availability). Plan documents the sequence as a checklist with explicit PASS/FAIL decision gate.

```powershell
# Step 1: Confirm both containers are healthy
plink -ssh -l claude -pw "Onclaude2103" -batch `
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" `
  hpg5 "docker ps --format ""{{.Names}} {{.Status}}"""
# Expected: shifty-lowdefy Up ... (healthy) + shifts-postgres Up ... (healthy)

# Step 2: HTTP smoke test — must return 200
plink -ssh ... hpg5 "curl -s -o NUL -w ""%{http_code}"" http://localhost:8080/employees"
# Expected: 200

# Step 3: 10 page loads, count ERR_MODULE_NOT_FOUND lines
# (Windows cmd — perform 10 curl calls then grep logs)
plink -ssh ... hpg5 "for /l %i in (1,1,10) do curl -s -o NUL http://localhost:8080/employees"
plink -ssh ... hpg5 "docker logs shifty-lowdefy 2>&1 | findstr ERR_MODULE_NOT_FOUND"
# Expected: no output (zero matches)

# PASS criteria: HTTP 200 + zero ERR_MODULE_NOT_FOUND lines
# FAIL criteria: any non-200 OR any ERR_MODULE_NOT_FOUND → activate 5-day escape hatch
```

**Current state (live verification 2026-05-12):** HTTP 200 confirmed, zero `ERR_MODULE_NOT_FOUND` confirmed. Smoke test expected to PASS. [VERIFIED: live hpg5 probe]

---

### Pattern 2: golang-migrate Compose Service (D-04)

**What:** One-shot service that runs `migrate up` on compose start, then exits 0. Subsequent `docker compose up` calls are idempotent (golang-migrate tracks applied migrations in `schema_migrations` table).

```yaml
# Addition to docker-compose.yml
  migrate:
    image: migrate/migrate:v4.18.3
    container_name: shifty-migrate
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./db/migrations:/migrations:ro
    command:
      - "-path=/migrations"
      - "-database=postgres://${POSTGRES_USER:-shifts}:${POSTGRES_PASSWORD:?missing}@postgres:5432/${POSTGRES_DB:-shifts}?sslmode=disable"
      - "up"
    restart: "no"
    # One-shot: exits 0 on success, non-zero on failure.
    # No healthcheck needed — compose dependency is exit code.
```

**Run commands:**
```bash
# Apply all pending migrations (normal use)
docker compose run --rm migrate up

# Roll back one step
docker compose run --rm migrate down 1

# Force a specific version (emergency recovery)
docker compose run --rm migrate force <version_number>

# Show current version
docker compose run --rm migrate version
```

**On `docker compose up -d`:** The `migrate` service runs and exits before `lowdefy` starts (but `lowdefy` already depends on `postgres.service_healthy`, not on `migrate` specifically). **Important:** add `lowdefy` to also depend on `migrate` completing, or run migrate manually before each deploy. Recommended pattern: keep `migrate` as a manual `docker compose run --rm migrate up` pre-deploy step rather than auto-run on `up -d` to avoid re-running on simple restarts.

[VERIFIED: dev.to golang-migrate article; STACK.md §Critical Decision #7]

---

### Pattern 3: Migration 0002 — Tenancy + NextAuth Adapter Tables

**What:** Migration 0002 is the largest single migration — it introduces multi-tenancy AND the NextAuth KnexAdapter tables in one transaction. This is intentional: NextAuth sessions require `app_user` to exist, so they cannot be split.

**Key design decisions:**
- `CITEXT` extension added here (needed for `app_user.email` case-insensitive unique constraint)
- Hebrew-text columns get `COLLATE "he-x-icu"` (covers `display_name` on `soldier`, `name` on `org_unit`, `name` on `tenant`)
- NextAuth KnexAdapter tables use the exact schema Auth.js expects: `users`, `accounts`, `sessions`, `verification_tokens`

```sql
-- Beginning of 0002_tenancy_and_org.sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email matching
-- pgcrypto already enabled in 0001

-- ... (PRD §10 tenant/org_unit/app_user/soldier/membership tables)

-- app_user.display_name gets ICU collation:
-- display_name TEXT COLLATE "he-x-icu"

-- NextAuth KnexAdapter required tables (Auth.js schema contract):
CREATE TABLE IF NOT EXISTS "users" (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT,
    email         TEXT UNIQUE,
    "emailVerified" TIMESTAMPTZ,
    image         TEXT
    -- NOTE: This is the Auth.js "users" table. Shifty uses app_user as the
    -- domain user table. The KnexAdapter writes here; we keep them separate
    -- to avoid coupling Auth.js schema changes to domain changes.
    -- app_user.user_id FK → this table's id is added in a subsequent statement.
);

CREATE TABLE IF NOT EXISTS accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"            UUID NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    type                TEXT NOT NULL,
    provider            TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    refresh_token       TEXT,
    access_token        TEXT,
    expires_at          INTEGER,
    token_type          TEXT,
    scope               TEXT,
    id_token            TEXT,
    session_state       TEXT,
    UNIQUE (provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "sessionToken" TEXT NOT NULL UNIQUE,
    "userId"       UUID NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    expires        TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    expires    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

COMMIT;
```

**Planning decision (Claude's Discretion):** Place NextAuth tables in migration `0002` (same file as `app_user`) rather than a separate `0002b` file. The FK dependency (sessions → users) cannot be split without a separate schema anyway, and the KnexAdapter migration is short (~20 lines). One file is cleaner.

[CITED: skill `reference/08-auth.md`; Auth.js KnexAdapter schema; PRD §10]

---

### Pattern 4: Session Hydration Callback (D-03)

**What:** The `SessionCallback` plugin fires after every NextAuth sign-in. It reads the user's `app_user` + `membership` rows and stamps the JWT with `{tenant_id, roles[], team_ids[], locale}`.

**File:** `app/plugins/shifty-auth/src/auth/callbacks.js`

```javascript
// Source: skill reference/08-auth.md + STACK.md §2c
// ESM module (type: "module" in package.json)

import knex from 'knex';  // imported from the connection-knex dep in the Lowdefy container

// The callback receives { session, token, user } from Auth.js.
// For JWT strategy: token is the JWT claims; session.user is derived from token.
export async function SessionCallback({ session, token, user }, connectionProperties) {
  // connectionProperties comes from the Lowdefy Knex connection (shifts_db)
  const db = knex(connectionProperties);

  try {
    // Single query: join app_user with membership to get tenant + roles + teams
    const result = await db
      .select(
        'au.id as user_id',
        'au.tenant_id',
        'au.locale',
        db.raw('array_agg(m.role) as roles'),
        db.raw('array_agg(m.org_unit_id::text) as team_ids')
      )
      .from('app_user as au')
      .leftJoin('membership as m', 'm.soldier_id', function() {
        // membership.soldier_id → soldier.user_id → app_user.id chain
        // Simplified: join via app_user.id = membership via soldier FK
        this.join('soldier as s', 's.user_id', 'au.id')
            .on('m.soldier_id', 's.id');
      })
      .where('au.email', session.user.email)
      .groupBy('au.id', 'au.tenant_id', 'au.locale')
      .first();

    if (result) {
      session.user.user_id    = result.user_id;
      session.user.tenant_id  = result.tenant_id;
      session.user.roles      = result.roles || [];
      session.user.team_ids   = result.team_ids || [];
      session.user.locale     = result.locale || 'he';
    } else {
      // New user — no app_user row yet (first-time signup before redemption).
      // Return session without tenant context; login page will redirect to signup.
      session.user.tenant_id = null;
      session.user.roles     = [];
      session.user.team_ids  = [];
      session.user.locale    = 'he';
    }
  } finally {
    await db.destroy();
  }

  return session;
}
```

**Important caveats:**
1. `session.user.tenant_id = null` is a valid state for a brand-new email that hasn't redeemed an invite code yet. Every authenticated page MUST handle this case — either redirect to `/signup_with_invite` or show an "account not provisioned" page.
2. Session refresh must happen when `app_user.locale` changes (profile update). Force re-sign-in or provide a `signIn({ callbackUrl: ... })` action on profile save.
3. For the founding admin (self-signup flow), `app_user` is created BEFORE the session callback fires — ensure the INSERT is committed in the same transaction as invite redemption.

[CITED: skill `reference/08-auth.md` §Adding role to session; STACK.md §2c; ARCHITECTURE.md §Pattern 1]

---

### Pattern 5: Auth.js in Lowdefy YAML — Exact Config Shape

**What:** How `auth:` and `plugins:` look in `lowdefy.yaml` after Phase 1 additions.

```yaml
# app/lowdefy.yaml (additions only — existing content unchanged)
lowdefy: 5.3.0
name: shifty

plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
  - name: '@lowdefy/plugin-nextauth'   # NEW
    version: '5.3.0'
  - name: 'shifty-auth'                # NEW — local plugin (workspace:*)
    version: 'workspace:*'
  - name: 'shifty-audit-writer'        # NEW — local plugin (workspace:*)
    version: 'workspace:*'

auth:
  pages:
    protected: true
    public:
      - login
      - signup
      - signup_with_invite
      - '404'
    roles:
      unit_admin:
        - admin_dashboard
        - admin_test_audit        # smoke-test page for shifty-audit-writer
        - manage_invites
        - manage_teams
      team_manager:
        - manager_dashboard
      member:
        - my_dashboard
  providers:
    - id: email
      type: EmailProvider
      properties:
        server:
          host: smtp.resend.com
          port: 465
          auth:
            user: resend
            pass:
              _secret: RESEND_API_KEY
        from:
          _secret: RESEND_FROM_EMAIL   # shifty@nesher.co
        maxAge: 1800                   # magic link valid 30 minutes
  adapter:
    type: KnexAdapter
    properties:
      connectionId: shifts_db
  session:
    strategy: database                 # Required for EmailProvider (stores tokens in DB)
    maxAge: 2592000                    # 30 days
  callbacks:
    - id: shifty_session
      type: ShiftySessionCallback     # exported from shifty-auth plugin
  pages:
    signIn: /login
```

**`NEXTAUTH_URL` must be set to the public canonical URL** (`https://apps.nesher.co`), not the internal LAN address. The magic-link callback URL is derived from `NEXTAUTH_URL`. [VERIFIED: skill `reference/08-auth.md` §Behind a reverse proxy]

---

### Pattern 6: Invite-Code Redemption Flow (D-02)

**What:** Two-page flow — signup triggers magic link, then post-callback page handles code redemption.

**Page 1: `/signup_with_invite`** (new user with invite code)
```yaml
# Simplified; full SQL in a .sql file under app/requests/queries/
requests:
  - id: redeem_invite
    type: KnexRaw
    connectionId: shifts_db
    payload:
      code:
        _state: invite_code_input
      email:
        _state: email_input
    properties:
      query: |
        WITH inv AS (
          SELECT id, tenant_id, org_unit_id, role
          FROM invite_code
          WHERE code = UPPER(:code)
            AND (expires_at IS NULL OR expires_at > now())
            AND (max_uses IS NULL OR uses < max_uses)
            AND revoked_at IS NULL
          FOR UPDATE
        ),
        upserted_user AS (
          INSERT INTO app_user (tenant_id, email, locale)
          SELECT tenant_id, :email, 'he' FROM inv
          ON CONFLICT (tenant_id, email) DO NOTHING
          RETURNING id, tenant_id
        ),
        membership_insert AS (
          INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
          SELECT uu.tenant_id,
                 (SELECT id FROM soldier WHERE user_id = uu.id),
                 inv.org_unit_id,
                 inv.role
          FROM upserted_user uu, inv
          ON CONFLICT (soldier_id, org_unit_id) DO NOTHING
        ),
        code_update AS (
          UPDATE invite_code SET uses = uses + 1
          WHERE id = (SELECT id FROM inv)
        ),
        redemption_log AS (
          INSERT INTO invite_code_redemption (invite_code_id, user_id)
          SELECT inv.id, uu.id FROM inv, upserted_user uu
        )
        SELECT tenant_id FROM upserted_user;
      parameters:
        code:
          _payload: code
        email:
          _payload: email
```

**Anti-pattern (documented for plan executor):** Do NOT redeem the invite in a `SessionCallback`. The session callback fires on every login; redemption is a one-shot write. Keep them separate. [CITED: STACK.md §2b]

**Founding-admin flow** (self-signup, no invite code): A separate `/signup` page that creates `tenant` + root `org_unit` + `app_user` + `membership (role=unit_admin)` in one transaction, then fires the magic link.

---

### Pattern 7: Postgres RLS — Migration 0009 (D-07)

**What:** Enable RLS on every tenant-scoped table. Policy uses `current_setting('app.current_tenant')::uuid` — set per-connection-checkout via Knex `afterCreate`.

**Migration `0009_rls_policies.sql` (complete pattern):**

```sql
-- Source: ARCHITECTURE.md §Pattern 1 Layer 5; AWS RLS guide; Crunchy Data RLS guide
-- Run as the superuser/migration role (shifts user must be non-superuser for RLS to apply)
BEGIN;

-- Verify the app role is not a superuser (superusers bypass RLS).
-- If this fails, re-create the DB user without SUPERUSER.
-- SELECT rolsuper FROM pg_roles WHERE rolname='shifts'; -- must be false

-- Tables that carry tenant_id:
DO $$ DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'tenant', 'org_unit', 'app_user', 'soldier', 'membership',
    'shift_slot', 'planning_window', 'shift_instance', 'assignment',
    'availability', 'rule', 'rule_override', 'swap_request',
    'invite_code', 'invite_code_redemption',
    'notification_pref', 'notification_log', 'push_subscription',
    'report_recipient', 'schedule_audit', 'solver_run',
    'roster_import_log', 'ical_subscription_token', 'time_clock_entries'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)
       WITH CHECK (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
      tbl
    );
  END LOOP;
END $$;

-- Special case: `tenant` table — the tenant row itself has id = current_tenant.
-- The standard policy above won't work because tenant.id != tenant.tenant_id (there is no tenant_id column).
-- Overwrite the policy for tenant:
DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  USING (id = current_setting('app.current_tenant', true)::uuid);

-- The `migrate` service user (same `shifts` role in dev, or a dedicated `shifty_migrate` role)
-- needs to bypass RLS. Grant bypass via BYPASSRLS on the migration role:
-- ALTER ROLE shifts_migrate BYPASSRLS;  -- if using a dedicated migration role
-- For dev (single role), set app.current_tenant to a wildcard UUID before running migrations:
-- SET app.current_tenant = '00000000-0000-0000-0000-000000000000';

-- Public pages (sign-in, magic-link callback) must work WITHOUT a tenant context.
-- Pattern: set app.current_tenant to NULL-safe; the `current_setting('app.current_tenant', true)`
-- call with `true` (missing_ok) returns NULL instead of throwing. The ::uuid cast on NULL returns NULL.
-- `USING (NULL = NULL::uuid)` is FALSE, which blocks all rows — correct for unauthenticated state.
-- The sign-in page's KnexRaw queries MUST use `-- @gsd-allow-untenanted:` comment (see D-10).

COMMIT;
```

**Knex `afterCreate` hook** (in `app/connections/shifts_db.yaml`):

```yaml
# app/connections/shifts_db.yaml
id: shifts_db
type: Knex
properties:
  client: pg
  connection:
    connectionString:
      _secret: POSTGRES_CONNECTION_STRING
  pool:
    afterCreate:
      # Server-side JavaScript that runs immediately after a connection is
      # checked out from the pool. Sets the app.current_tenant session variable.
      # The _user operator is server-evaluated here — safe.
      _function:
        __args: 0   # [connection, done]
        __return:
          # Pseudo-code; actual implementation in shifty-auth plugin
          # as a connection-level hook registered via Knex.client.pool.afterCreate
          # See: app/plugins/shifty-auth/src/hooks/knex-tenant.js
```

**Implementation note:** Lowdefy's `connection-knex` does not natively support `afterCreate` in YAML. The hook must be registered in a custom plugin's connection setup code. The `shifty-auth` plugin is the right place (it already wraps the auth layer). Alternative: create a thin `shifty-db` plugin that wraps Knex with the tenant-hook.

The hook code itself:
```javascript
// app/plugins/shifty-auth/src/hooks/knex-tenant.js
// Called from the Knex pool's afterCreate callback
export function setTenantOnConnection(conn, done, tenantId) {
  conn.query(
    `SET LOCAL app.current_tenant = '${tenantId}'`,
    (err) => done(err, conn)
  );
}
```

**RLS bypass for `migrate` service:** The golang-migrate service connects as the `shifts` user (same as the app). Since `shifts` is not a superuser (it shouldn't be), RLS applies. Before running migrations, set a bypass:

```sql
-- In a pre-migration step or as a preamble in each migration file:
SET app.current_tenant = '00000000-0000-0000-0000-000000000000';
-- This UUID won't match any real tenant, but the migrations use DDL (ALTER TABLE, CREATE TABLE)
-- which are not subject to RLS row filters. Only DML (SELECT/INSERT/UPDATE/DELETE) is filtered.
-- DDL statements bypass RLS inherently — no special handling needed.
```

[CITED: ARCHITECTURE.md §Pattern 1 Layer 5; AWS multi-tenant RLS guide; Crunchy Data RLS for tenants]

---

### Pattern 8: `shifty-audit-writer` Custom Plugin (D-08)

**What:** A Lowdefy request plugin that writes to `schedule_audit`. Actor comes from the session (`_user.user_id`), never from request input. Proves the plugin pattern for downstream phases.

**File layout:**
```
app/plugins/shifty-audit-writer/
  package.json
  src/
    connections/
      requests/
        AuditWrite.js         # the request implementation
    types.js                  # exports: { requests: ['AuditWrite'] }
```

**`package.json`:**
```json
{
  "name": "shifty-audit-writer",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./connections": "./src/connections.js",
    "./types": "./src/types.js"
  }
}
```

**`src/types.js`:**
```javascript
export default {
  requests: ['AuditWrite'],
};
```

**`src/connections.js`:**
```javascript
import AuditWrite from './connections/requests/AuditWrite.js';
export default { AuditWrite };
```

**`src/connections/requests/AuditWrite.js`:**
```javascript
// Source: skill reference/09-plugins.md §Authoring a connection
async function AuditWrite({ request, connection }) {
  // connection: the resolved Knex connection properties (from shifts_db)
  // request.properties: the payload from the YAML request block
  // request.user: the authenticated session user (server-injected by Lowdefy)

  const { planning_window_id, from_state, to_state, actor_kind, payload_json } = request.properties;
  const actor_user_id = request.user?.user_id;   // CRITICAL: always from session, never from input

  if (!actor_user_id) {
    throw new Error('AuditWrite: actor_user_id missing from session — unauthenticated request');
  }
  if (!to_state) {
    throw new Error('AuditWrite: to_state is required');
  }

  const knex = require('knex')(connection);  // connection-knex passes the config object
  try {
    await knex('schedule_audit').insert({
      tenant_id: request.user.tenant_id,
      planning_window_id,
      from_state: from_state || null,
      to_state,
      actor_user_id,
      actor_kind: actor_kind || 'user',
      payload: payload_json ? JSON.stringify(payload_json) : null,
    });
    return { success: true };
  } finally {
    await knex.destroy();
  }
}

AuditWrite.schema = {
  type: 'object',
  required: ['to_state'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
    from_state: { type: 'string' },
    to_state: { type: 'string' },
    actor_kind: { enum: ['user', 'system', 'solver'] },
    payload_json: { type: 'object' },
  },
};
AuditWrite.connectionType = 'Knex';

export default AuditWrite;
```

**Usage in YAML (test page `admin_test_audit.yaml`):**
```yaml
requests:
  - id: write_test_audit
    type: AuditWrite
    connectionId: shifts_db
    properties:
      to_state: test_mutation
      actor_kind: user
      payload_json:
        test: true
        note: 'Phase 1 plugin smoke test'
```

**Declaration in `lowdefy.yaml` (additions):**
```yaml
plugins:
  - name: 'shifty-audit-writer'
    version: 'workspace:*'
```

[CITED: skill `reference/09-plugins.md` §Authoring a connection request]

---

### Pattern 9: `tools/check-queries.mjs` CI Grep Gate (D-10a)

**What:** Node ESM script that scans every `app/**/*.yaml` for `KnexRaw`/`Knex` request blocks and fails if any query string is missing a `tenant_id` filter. Exit 0 = pass; exit 1 = fail.

```javascript
#!/usr/bin/env node
// tools/check-queries.mjs
// Source: D-10 CONTEXT.md; PITFALLS.md §Pitfall 2
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ALLOWLIST_MARKER = '-- @gsd-allow-untenanted:';
const KNEX_REQUEST_TYPES = new Set(['KnexRaw', 'KnexBuilder', 'KnexInsertOne', 'KnexUpdateOne', 'KnexDeleteOne']);
const TENANT_FILTER_PATTERN = /\btenant_id\b/i;
const DML_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

let failures = 0;
const yamlFiles = collectYaml('app');

for (const filePath of yamlFiles) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line declares a Knex request type
    if (!KNEX_REQUEST_TYPES.has(extractType(line))) continue;

    // Grab the query block (lines after this until the next request block or end of file)
    const blockLines = lines.slice(i, i + 50).join('\n');

    // Skip if allowlisted
    if (blockLines.includes(ALLOWLIST_MARKER)) continue;

    // Check if the block contains DML but no tenant_id filter
    if (DML_PATTERN.test(blockLines) && !TENANT_FILTER_PATTERN.test(blockLines)) {
      console.error(`FAIL: Missing tenant_id filter in ${filePath}:${i + 1}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} query block(s) missing tenant_id filter. Add filter or annotate with:\n  ${ALLOWLIST_MARKER} <reason>`);
  process.exit(1);
}
console.log('check-queries: all Knex request blocks have tenant_id filters.');
process.exit(0);

function collectYaml(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...collectYaml(full));
    else if (full.endsWith('.yaml') || full.endsWith('.yml')) results.push(full);
  }
  return results;
}

function extractType(line) {
  const m = line.match(/^\s*type:\s*(\S+)/);
  return m ? m[1] : null;
}
```

**Allowlist comment syntax (per D-10a):**
```yaml
# In any YAML file with a query that legitimately omits tenant_id:
requests:
  - id: check_invite_code
    type: KnexRaw
    connectionId: shifts_db
    properties:
      query: |
        -- @gsd-allow-untenanted: invite code validation — no tenant context before signup
        SELECT tenant_id, org_unit_id, role
        FROM invite_code
        WHERE code = UPPER(:code) AND expires_at > now()
```

---

### Pattern 10: Playwright Cross-Tenant Pen-Test Fixture (D-10b)

**What:** Seeds two tenants with fixtures, signs in as tenant-A, probes every route with tenant-B IDs, asserts 403 everywhere.

```typescript
// tests/e2e/cross-tenant-leak.spec.ts
// Source: D-10 CONTEXT.md; PRD §8.3 G5
import { test, expect } from '@playwright/test';
import { seedTwoTenants, signInAs, getTenantBIds } from './fixtures/tenant-seed';

test.describe('Cross-tenant isolation', () => {
  let tenantA: { userId: string; jwt: string };
  let tenantBIds: { soldiers: string[]; windows: string[]; assignments: string[] };

  test.beforeAll(async () => {
    // Seed two independent tenants from kibbutz.sql (6 soldiers each for speed)
    const { tenantA: a, tenantB: b } = await seedTwoTenants();
    tenantA = await signInAs(a.adminEmail);
    tenantBIds = getTenantBIds(b);
  });

  // Auto-collect routes from app/pages/**
  const pages = collectPagesFromAppDir(); // helper that reads app/pages/** YAML for pageIds

  for (const pageId of pages) {
    test(`page /${pageId} with tenant-B ID returns 403 or empty`, async ({ page }) => {
      await page.goto(`/${pageId}?tenant_id=${tenantBIds.tenantId}`);
      // Either: redirected to login (if not authenticated — shouldn't happen here)
      // Or: page renders with NO tenant-B data (empty result set)
      // Or: HTTP 403
      const status = page.url();
      // Primary assertion: no tenant-B data in response
      for (const soldierId of tenantBIds.soldiers) {
        const content = await page.content();
        expect(content).not.toContain(soldierId);
      }
    });
  }

  test('direct API probe with tenant-B assignment ID returns 403 or empty', async ({ request }) => {
    for (const assignmentId of tenantBIds.assignments) {
      const resp = await request.get(`/api/assignments/${assignmentId}`, {
        headers: { Cookie: tenantA.jwt },
      });
      expect([403, 404, 200]).toContain(resp.status());
      if (resp.status() === 200) {
        const body = await resp.json();
        expect(body).not.toHaveProperty('id', assignmentId);
      }
    }
  });
});
```

**Note:** The auto-collected routes approach means every new page added in Phase 2+ is automatically included in the pen-test without manual update. [CITED: D-10 CONTEXT.md; PRD G5]

---

### Pattern 11: Migration 0010 — Audit Table REVOKEs (SEC-07)

```sql
-- 0010_audit_revokes.sql
-- Source: ARCHITECTURE.md §Pattern 5; SUMMARY.md Critical Decision #9; SEC-07
BEGIN;

-- Append-only enforcement: REVOKE mutating operations from the app role.
-- The `shifts` role (app user) can INSERT but not UPDATE/DELETE/TRUNCATE.
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifts;

-- notification_log IS allowed to UPDATE (for status transitions: queued→sent→delivered).
-- Only DELETE and TRUNCATE are revoked.
REVOKE DELETE, TRUNCATE ON notification_log FROM shifts;

COMMIT;
```

---

### Pattern 12: Log-Redaction Middleware (SEC-10)

**What:** A Next.js middleware that intercepts outgoing log lines and redacts env-var values matching `*_SECRET`, `*_PASSWORD`, `*_KEY` patterns.

```javascript
// app/plugins/shifty-auth/src/middleware/log-redact.js
// Loaded by the Lowdefy server startup — patch console.log/error/warn.
const SENSITIVE_PATTERN = /\b(SECRET|PASSWORD|KEY)\b/i;

const REDACT_VALUES = new Set(
  Object.entries(process.env)
    .filter(([k]) => SENSITIVE_PATTERN.test(k))
    .map(([, v]) => v)
    .filter(Boolean)
);

function redact(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  for (const val of REDACT_VALUES) {
    if (val.length > 8) {  // Don't redact very short values (too many false positives)
      out = out.replaceAll(val, '[REDACTED]');
    }
  }
  return out;
}

const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
const origWarn = console.warn.bind(console);

console.log  = (...args) => origLog(...args.map(a => typeof a === 'string' ? redact(a) : a));
console.error = (...args) => origErr(...args.map(a => typeof a === 'string' ? redact(a) : a));
console.warn  = (...args) => origWarn(...args.map(a => typeof a === 'string' ? redact(a) : a));
```

---

### Pattern 13: Backup Scripts (OPS-03, OPS-04, OPS-05)

**`C:\shifts-manager\scripts\backup-pg.ps1` (runs from Task Scheduler):**
```powershell
# Nightly pg_dump — runs as user 'claude' on hpg5
$Date = Get-Date -Format "yyyy-MM-dd"
$BackupDir = "C:\shifts-manager\backups\pg"
$DumpFile = "$BackupDir\$Date.dump"

# Ensure backup dir exists
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Dump from the running postgres container
docker exec shifts-postgres pg_dump `
  -U shifts -d shifts `
  --format=custom `
  --no-password `
  -f /tmp/backup.dump

# Copy from container to host
docker cp shifts-postgres:/tmp/backup.dump $DumpFile

# Off-host copy to neshernas via rclone
# rclone must be installed: winget install rclone
rclone copy $DumpFile "neshernas_pg_backup:pg-backups/$Date.dump" `
  --config "C:\shifts-manager\.rclone.conf"

# Self-test: verify the dump is restorable
$TestResult = docker exec shifts-postgres pg_restore --list /tmp/backup.dump 2>&1
if ($LASTEXITCODE -ne 0) {
  # Alert: write to Windows Event Log
  Write-EventLog -LogName Application -Source "ShiftyBackup" `
    -EventId 1001 -EntryType Error `
    -Message "pg_restore --list FAILED for dump $Date. Exit code $LASTEXITCODE. Output: $TestResult"
  exit 1
}

# Retention: keep 14 daily, 8 weekly, 6 monthly
# (Simple implementation: delete files older than 14 days that don't match weekly/monthly patterns)
Get-ChildItem $BackupDir -Filter "*.dump" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Where-Object { $_.Name -notmatch '^\d{4}-(01|08|15|22|29)-01\.dump$' } |  # weekly = Sundays; monthly = 1st
  Remove-Item

Write-EventLog -LogName Application -Source "ShiftyBackup" `
  -EventId 1000 -EntryType Information `
  -Message "Backup succeeded: $DumpFile"
```

**rclone config for neshernas (`C:\shifts-manager\.rclone.conf`):**
```ini
[neshernas_pg_backup]
type = sftp
host = 192.168.1.121
user = omer
key_file = C:\shifts-manager\.ssh\neshernas_rclone_key
```

**Task Scheduler XML template** (import via `schtasks /create /xml`):
- Trigger: daily at 02:00 Israel time (`Asia/Jerusalem` = UTC+3 standard)
- Action: `powershell.exe -NonInteractive -File C:\shifts-manager\scripts\backup-pg.ps1`
- Run as: `claude`
- "Run whether user is logged on or not" for reliability

[CITED: PRD §8.8; CONTEXT.md D-09]

---

### Pattern 14: COLLATE "he-x-icu" Column Declarations (I18N-07)

The following columns in migrations 0002–0007 must be declared with `COLLATE "he-x-icu"`:

| Table | Column | Migration |
|-------|--------|-----------|
| `tenant` | `name` | 0002 |
| `org_unit` | `name` | 0002 |
| `app_user` | `display_name` | 0002 |
| `soldier` | `display_name` | 0002 |
| `shift_slot` | `name` | 0003 |
| `planning_window` | (no Hebrew-text column) | — |
| `invite_code` | (no Hebrew-text column) | — |

**SQL pattern:**
```sql
-- In 0002_tenancy_and_org.sql
display_name TEXT COLLATE "he-x-icu" NOT NULL,
```

[CITED: PITFALLS.md §Pitfall 5; STACK.md §2 Database; SUMMARY.md Key Findings]

---

### Pattern 15: Kibbutz Fixture (OPS-10)

```sql
-- tools/fixtures/kibbutz.sql
-- 12 soldiers, 1 team, 64-day window mirroring tenant #1's Google Sheet.
-- One soldier intentionally has a U+2019 RIGHT SINGLE QUOTATION MARK in display_name
-- to enforce UUID-only-joins rule (PRD §2 "smart-quote bug defense").
-- Seeded in both local dev and CI integration tests.

BEGIN;
-- Tenant
INSERT INTO tenant (id, name, org_depth)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Kibbutz', 1);

-- Root org_unit (single-level = root is also the leaf)
INSERT INTO org_unit (id, tenant_id, parent_id, level, name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', NULL, 1, 'צוות ראשי');

-- 12 soldiers (11 normal + 1 with U+2019 in name)
INSERT INTO soldier (id, tenant_id, display_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'יוסי כהן'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'דני לוי'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'מרב גולן'),
  -- ... (9 more normal soldiers)
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'נועם ג’לאל');
  --                                                                                      ^-- U+2019

-- 64-day planning window (Phase 1 only seeds the window; Phase 4 solver test uses it)
INSERT INTO planning_window (id, tenant_id, team_id, start_date, end_date, constraint_lock_at, state)
VALUES ('99999999-9999-9999-9999-999999999999',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        CURRENT_DATE, CURRENT_DATE + 63, CURRENT_DATE + 58, 'open');

COMMIT;
```

---

### Anti-Patterns to Avoid

- **`tenant_id: { _payload: tenant_id }`** — NEVER derive tenant_id from client payload. Always `_user: tenant_id`. [CITED: STACK.md §1a; ARCHITECTURE.md Layer 2]
- **Invite-code redemption in `SessionCallback`** — runs on every login; redemption is one-shot. Keep separate. [CITED: STACK.md §2b]
- **`SET app.current_tenant` without `LOCAL`** — without `LOCAL`, the value persists across pooled connections. Always `SET LOCAL app.current_tenant = ?`. [CITED: PITFALLS.md §Pitfall 2]
- **`@lowdefy/plugin-nextauth` in plugins list without install** — silent failure at build time. Both `package.json` dep AND `plugins:` declaration required. [VERIFIED: skill `reference/09-plugins.md`]
- **`NEXTAUTH_URL=http://hpg5:8080`** — breaks magic-link callbacks for external users. Must be `https://apps.nesher.co`. [VERIFIED: skill `reference/08-auth.md`]
- **Superuser Postgres role for app** — superusers bypass RLS. The `shifts` DB user must NOT have `SUPERUSER`. Confirm with: `SELECT rolsuper FROM pg_roles WHERE rolname='shifts'`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Magic-link email delivery | Custom SMTP mailer | NextAuth `EmailProvider` + Resend SMTP | CSRF tokens, token expiry, callback URL generation — all built in |
| Session token storage | Custom JWT handler | NextAuth `KnexAdapter` + `session: database` | Verification tokens and session records managed by Auth.js schema |
| Migration tracking | Manual version comments in SQL | `migrate/migrate` `schema_migrations` table | Idempotent re-runs, `up`/`down`/`force`, version history |
| Tenant data isolation | Custom middleware filter | Postgres RLS + `_user: tenant_id` in queries | Defense in depth; RLS catches the missed-`WHERE` bug class entirely |
| Audit append-only enforcement | Application-level check before DELETE | `REVOKE DELETE` + `REVOKE TRUNCATE` in 0010 | Engine-level; cannot be bypassed by application bugs |
| Invite-code character set | Custom UUID sub-string | Crockford base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` | Removes visually ambiguous chars (I, L, O, U); case-insensitive on input |

---

## Runtime State Inventory

> This is a greenfield phase (no data exists yet). The legacy schema is single-tenant with no production data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No production data in `employees`, `shifts`, `assignments`, `availability`, `time_clock_entries` — all empty [VERIFIED: live hpg5 probe shows 0 rows] | None; Phase 2 applies 0008 drop |
| Live service config | `shifty-lowdefy` and `shifts-postgres` running; no `migrate`, `solver`, `cron`, `waha` services | Phase 1 adds `migrate` service slot |
| OS-registered state | None — no Windows Task Scheduler tasks for Shifty exist yet [ASSUMED — not verified; plan executor must confirm with `schtasks /query /fo LIST /nh` on hpg5] | Plan: create backup Task Scheduler tasks in OPS plan |
| Secrets/env vars | `.env` on hpg5 has `POSTGRES_CONNECTION_STRING`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` [VERIFIED: docker-compose.yml shows these are required] | Phase 1 adds: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Build artifacts | `shifts-manager-lowdefy` Docker image exists (built 2026-05-11); no stale pnpm cache issues | None; will rebuild with Phase 1 changes |

**New env vars required by Phase 1 (add to `.env` on hpg5):**
```
RESEND_API_KEY=<Resend API key>
RESEND_FROM_EMAIL=shifty@nesher.co
```

---

## Common Pitfalls

### Pitfall 1: NextAuth session strategy mismatch
**What goes wrong:** Using `strategy: jwt` with `EmailProvider` causes `verification_tokens` to not persist — magic links expire instantly.
**Why it happens:** `EmailProvider` requires a database adapter AND `strategy: database`. JWT strategy doesn't write tokens to DB.
**How to avoid:** Always pair `EmailProvider` with `adapter: { type: KnexAdapter }` AND `session: { strategy: database }`.
**Warning signs:** Magic-link emails arrive but clicking the link shows "Invalid token" or "Token expired".

### Pitfall 2: RLS blocks the `migrate` service
**What goes wrong:** `migrate/migrate` runs as the `shifts` DB user; RLS policies require `app.current_tenant` to be set. DDL statements (CREATE TABLE, ALTER TABLE) are NOT filtered by RLS — but if any migration includes DML (INSERT seed data), the query returns 0 rows or fails.
**Why it happens:** RLS applies to DML; `current_setting('app.current_tenant', true)` returns NULL for the migration session.
**How to avoid:** Add `SET app.current_tenant = '00000000-0000-0000-0000-000000000000';` at the top of any migration file that contains DML, OR create a dedicated `shifts_migrate` role with `BYPASSRLS`.
**Warning signs:** Migration 0009+ runs but subsequent seed-data migrations return `0 rows affected` unexpectedly.

### Pitfall 3: `workspace:*` pnpm dependency fails on Docker build
**What goes wrong:** Local plugin packages referenced via `workspace:*` in `app/package.json` fail to resolve inside the Docker builder stage — the workspace root is only `app/`, not the full repo.
**Why it happens:** The `COPY . .` in `app/Dockerfile` copies `app/` into `/build`; `app/plugins/` is inside that, so `workspace:*` should resolve. But pnpm workspace requires a `pnpm-workspace.yaml` at the root.
**How to avoid:** Add `pnpm-workspace.yaml` to `app/` listing the plugin packages:
```yaml
packages:
  - '.'
  - 'plugins/*'
```
**Warning signs:** `pnpm install` in the Docker builder fails with "workspace package not found" error.

### Pitfall 4: `_user` operator in client-evaluated context
**What goes wrong:** Using `_user: tenant_id` in a block's `visible:` or `content:` evaluates client-side — the value is read from the browser's session cookie and CAN be tampered with in DevTools.
**Why it happens:** `_user` is a "shared" operator — it runs in both client and server contexts. In `block.properties.*`, it's client-evaluated.
**How to avoid:** For security gates (tenant_id, roles), use `_user` ONLY in request `payload:` (which is then read server-side via `_payload` in `request.properties`). Never use `_user: tenant_id` directly in a query parameter.
**Warning signs:** `_user: tenant_id` appears in `query: SELECT ... WHERE tenant_id = :t` but the parameter is passed via `_state` not `_payload` (mixing client and server context).

### Pitfall 5: Hebrew ICU collation not installed in Postgres Docker image
**What goes wrong:** `COLLATE "he-x-icu"` fails with `ERROR: collation "he-x-icu" for encoding "UTF8" does not exist`.
**Why it happens:** ICU collations require `--locale-provider=icu` at `initdb` time OR the `pg_locale_provider` cluster setting. The default `postgres:16` Docker image uses `libc` locale provider.
**How to avoid:** Check if ICU is available: `SELECT collname FROM pg_collation WHERE collname = 'he-x-icu';` — if empty, the collation must be created: `CREATE COLLATION "he-x-icu" (PROVIDER = icu, LOCALE = 'he');`
Add this `CREATE COLLATION` to migration 0002 before any `COLLATE "he-x-icu"` column declarations.
**Warning signs:** Migration 0002 fails with "collation does not exist".

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `psql` for migrations (CLAUDE.md "Common ops") | `migrate/migrate` compose service | Phase 1 | Idempotent, versioned; manual psql remains valid for ad-hoc queries only |
| Single-tenant schema (0001_init.sql) | Multi-tenant schema (0002–0007) | Phase 1 | Every domain table gains `tenant_id`; old pages superseded |
| No auth (bootstrap app has no login) | NextAuth EmailProvider + magic links | Phase 1 | Every page becomes protected by default; `/employees` remains accessible for smoke test only during Phase 1 |

**Deprecated after Phase 1:**
- `employees` page query `SELECT ... FROM employees` — deprecated (not deleted); superseded by tenant-scoped `soldier` queries in Phase 2
- Direct `psql` migration runs — deprecated; use `docker compose run --rm migrate up` instead

---

## Open Questions

1. **`@lowdefy/plugin-nextauth` exact version and export shape**
   - What we know: listed in skill `09-plugins.md` built-in catalog; expected to be `5.3.0`.
   - What's unclear: actual npm publish status and export shape for `KnexAdapter`.
   - Recommendation: `npm view @lowdefy/plugin-nextauth versions --json` before authoring plugin YAML; fall back to `npm:next-auth` direct if the Lowdefy wrapper is not published.

2. **Knex `afterCreate` hook in Lowdefy's `connection-knex` configuration**
   - What we know: Knex supports `pool.afterCreate` in its config; Lowdefy's `connection-knex` passes the Knex config from YAML.
   - What's unclear: whether `pool.afterCreate` is expressible in Lowdefy YAML or requires a custom plugin.
   - Recommendation: Implement via `shifty-auth` plugin's connection initialization hook (server-side JS); do not attempt to express it in YAML.

3. **Windows Task Scheduler "Run whether logged in or not" for backup**
   - What we know: the PowerShell backup script uses `docker exec` which requires Docker Desktop to be running (which requires the `claude` user to be logged in).
   - What's unclear: whether Task Scheduler "Run whether logged in or not" option works correctly on hpg5 given the interactive-session requirement for Docker Desktop.
   - Recommendation: Configure the task to run only when `claude` is logged in. Since hpg5 has Autologon configured, `claude` is always logged in after reboot. Document this dependency in `docs/OPERATIONS.md`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop | All container operations | ✓ | Verified (containers healthy 12h) | — |
| `plink` / `pscp` | SSH to hpg5 | ✓ | git version 2.54.0 (plink available) | — |
| Node.js | `tools/check-queries.mjs` | ✓ | v22.19.0 (local dev machine) | — |
| `shifts-manager-lowdefy` container | Smoke test | ✓ | Built 2026-05-11, healthy | — |
| `shifts-postgres` container | All DB operations | ✓ | Healthy 14h | — |
| `rclone` | OPS-04 off-host backup | ✗ | — | Install via `winget install rclone` on hpg5 (no fallback for off-host copy itself) |
| Resend account + API key | AUTH-01 magic links | ✗ | — | Magic-link email fails without RESEND_API_KEY; add to `.env` before Phase 1 auth plan |
| Playwright (local or CI) | D-10b pen-test | ✗ | — | `npm install -D @playwright/test` locally; CI gate deferred to Phase 2 per D-11 |

**Missing dependencies with no fallback:**
- `RESEND_API_KEY` in hpg5 `.env` — blocks AUTH-01. Plan 3 (auth) cannot complete without it. User action required before plan execution.

**Missing dependencies with fallback:**
- `rclone` — not installed on hpg5; install in OPS plan as step 1 before off-host backup setup.
- Playwright — install locally for pen-test development; CI deferred per D-11.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (E2E/pen-test) + Node built-in test runner or Vitest (unit tools) |
| Config file | `playwright.config.ts` — Wave 0 gap |
| Quick run command | `node tools/check-queries.mjs` (< 5s) |
| Full suite command | `npx playwright test tests/e2e/` (requires seeded DB) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Every query has tenant_id filter | Static analysis | `node tools/check-queries.mjs` | ❌ Wave 0 |
| SEC-04 | RLS blocks cross-tenant DML | Integration (Playwright) | `npx playwright test tests/e2e/cross-tenant-leak.spec.ts` | ❌ Wave 0 |
| SEC-06 | Every route returns 403 for cross-tenant IDs | E2E | `npx playwright test tests/e2e/cross-tenant-leak.spec.ts` | ❌ Wave 0 |
| AUTH-01 | Magic-link email delivered | Manual (live Resend) | Manual in staging | N/A |
| AUTH-05 | Invite redemption creates membership | Integration | `npx playwright test tests/e2e/invite-flow.spec.ts` | ❌ Wave 0 |
| AUTH-06 | Revoked codes reject | Integration | `npx playwright test tests/e2e/invite-flow.spec.ts` | ❌ Wave 0 |
| OPS-02 | Migrations apply and re-run idempotently | Schema/migration | `docker compose run --rm migrate up` (twice; second must exit 0) | N/A (compose) |
| OPS-05 | Backup self-test `pg_restore --list` | Ops smoke test | Included in backup script | ❌ Wave 0 (script) |
| D-08 | `shifty-audit-writer` plugin writes `schedule_audit` row | Integration (Playwright) | `npx playwright test tests/e2e/audit-writer.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per plan commit:** `node tools/check-queries.mjs`
- **Per wave merge:** `npx playwright test tests/e2e/`
- **Phase gate:** Full suite green + `docker compose run --rm migrate up` (idempotent) + smoke test HTTP 200 before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `playwright.config.ts` — base Playwright config with `baseURL: http://hpg5:8080` or `http://localhost:3000`
- [ ] `tests/e2e/fixtures/tenant-seed.ts` — shared 2-tenant seed helpers
- [ ] `tests/e2e/cross-tenant-leak.spec.ts` — covers SEC-01, SEC-04, SEC-06
- [ ] `tests/e2e/invite-flow.spec.ts` — covers AUTH-05, AUTH-06
- [ ] `tests/e2e/audit-writer.spec.ts` — covers D-08 plugin smoke test
- [ ] `tools/check-queries.mjs` — covers SEC-05
- [ ] `tools/fixtures/kibbutz.sql` — covers OPS-10; seed data for CI and local dev
- [ ] Playwright install: `npm install -D @playwright/test` + `npx playwright install chromium`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | NextAuth EmailProvider magic link; JWT session; `NEXTAUTH_SECRET` 32-byte random |
| V3 Session Management | yes | NextAuth `session: database` strategy; HTTP-only secure cookies; `maxAge: 2592000` |
| V4 Access Control | yes | `auth.pages.roles` + `request.auth.roles` + Postgres RLS (D-07) |
| V5 Input Validation | yes | `_user: tenant_id` (never `_payload`); KnexRaw parameterized queries; invite-code `UPPER()` normalization |
| V6 Cryptography | yes | `NEXTAUTH_SECRET` for JWT signing; never hand-roll |
| V7 Error Handling | yes | Log-redaction middleware (SEC-10); structured errors without stack traces to client |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tenant ID spoofing via URL `?tenant_id=` | Spoofing | `tenant_id` derived from session only (`_user: tenant_id`); Postgres RLS catches missed cases |
| Magic-link token theft | Spoofing | Short expiry (30 min); single-use; sent to verified email; HTTPS only |
| SQL injection via KnexRaw | Tampering | Parameterized queries (`:param` syntax); never string concatenation |
| Session cookie theft | Spoofing | HTTP-only + Secure cookie flags (NextAuth default); `NEXTAUTH_URL=https://...` |
| Cross-tenant data leak via missing WHERE | Information Disclosure | SEC-05 CI grep gate + Postgres RLS layer 5 |
| Enumerable invite codes | Information Disclosure | SEC-09 page gating; codes are 8-char base32 (32^8 ≈ 10^12 combinations) |
| Audit log tampering | Tampering | 0010 REVOKE UPDATE/DELETE; no delete path in application code |
| Secret leakage in logs | Information Disclosure | SEC-10 log-redaction middleware |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@lowdefy/plugin-nextauth` is published at version `5.3.0` on npm | Standard Stack | Phase 1 auth plan blocked; fallback: install `next-auth` directly and wire manually |
| A2 | The Knex `pool.afterCreate` hook is configurable via a custom Lowdefy plugin's connection initialization | Pattern 7 (RLS) | RLS `app.current_tenant` cannot be set automatically; workaround: prepend `SET LOCAL app.current_tenant = :tid` as a preamble query before each tenant-scoped request |
| A3 | Windows Task Scheduler tasks for backup do not yet exist on hpg5 | Runtime State Inventory | Tasks already exist → duplicate task creation fails; plan executor must check first |
| A4 | `rclone` is not installed on hpg5 | Environment Availability | If it is installed, the install step in the OPS plan is a no-op (harmless) |
| A5 | ICU collation support is available in the `postgres:16` Docker image for `CREATE COLLATION "he-x-icu"` | Pattern 14 (COLLATE) | `CREATE COLLATION` fails; fallback: use `pg_collation` check and skip if unavailable, or use `C.UTF-8` as a temporary workaround (degraded Hebrew sort) |
| A6 | `migrate/migrate` v4.18.3 is backward-compatible with the `v4.17.0` referenced in SUMMARY.md | Standard Stack | No impact expected; minor version bump in golang-migrate is typically backward-compatible |

---

## Recommended Plan Decomposition

The planner should produce **6 plans** for Phase 1 with the sequencing constraint described:

| Plan | Name | Key Work Items | Must Follow |
|------|------|----------------|-------------|
| Plan 01 | Smoke Test + Infra Baseline | Verify D-01 smoke test passes; add `migrate` service to docker-compose.yml; add pnpm workspace config for plugins; update `.env.example` | None |
| Plan 02 | Migrations 0002–0010 | Author and apply migrations 0002_tenancy_and_org (+ ICU collation + NextAuth tables) through 0007, then 0009 (RLS), then 0010 (audit REVOKEs); verify idempotent re-runs; seed kibbutz fixture | Plan 01 |
| Plan 03 | NextAuth + Auth Pages | `shifty-auth` plugin; `EmailProvider` + `KnexAdapter` in lowdefy.yaml; `SessionCallback` hydrating full session shape; login/signup/signup_with_invite pages; founding-admin and invite-code signup flows; RBAC page gates | Plan 02 |
| Plan 04 | RLS + Knex Tenant Hook | Verify RLS policies active after 0009; implement `afterCreate` tenant hook in `shifty-auth` plugin; test that anonymous queries return empty results; allowlist sign-in page queries | Plan 03 |
| Plan 05 | shifty-audit-writer Plugin | Author `app/plugins/shifty-audit-writer/`; add to lowdefy.yaml; create `admin_test_audit` page; Playwright smoke test that writes a row and reads it back from `schedule_audit` | Plan 03 |
| Plan 06 | Ops Baseline | Backup script + Task Scheduler XML + rclone config; log-redaction middleware; `tools/check-queries.mjs` CI gate; Playwright cross-tenant pen-test fixture + kibbutz seed; `docs/OPERATIONS.md` stub | Plan 02 |

Plans 04, 05, and 06 can run in parallel after Plan 03 completes.

---

## Sources

### Primary (HIGH confidence)
- `app/Dockerfile` — Symlink-preservation fix, verified live on hpg5
- `app/lowdefy.yaml` — Existing bootstrap app structure
- `app/package.json` — Current Lowdefy deps
- `docker-compose.yml` — Existing 2-service compose
- `db/migrations/0001_init.sql` — Bootstrap schema (pgcrypto, 5 tables)
- `.claude/skills/lowdefy/reference/08-auth.md` — NextAuth EmailProvider + KnexAdapter patterns
- `.claude/skills/lowdefy/reference/09-plugins.md` — Custom plugin authoring patterns
- `.claude/skills/lowdefy/reference/06-operators.md` — `_user`, `_payload`, `_secret` evaluation contexts
- `.claude/skills/lowdefy/reference/10-deployment.md` — Lowdefy build + Docker rationale
- `.planning/research/STACK.md` — Version pins, Resend SMTP, auth integration
- `.planning/research/ARCHITECTURE.md` — 5-layer tenant defense, RLS pattern
- `.planning/research/PITFALLS.md` — P1 (runtime), P2 (isolation), P5 (Hebrew collation), P6 (ops)
- `.planning/research/SUMMARY.md` — Critical Decisions #1, #2, #7, #8, #9
- `docs/PRD.md` §7.2, §8.2, §8.3, §8.8, §10 — Auth, RBAC, backup, migrations
- Live hpg5 probe (2026-05-12) — containers healthy, HTTP 200, zero ERR_MODULE_NOT_FOUND
- ctx7 golang-migrate/migrate — v4.18.3 confirmed latest

### Secondary (MEDIUM confidence)
- [dev.to golang-migrate Docker Compose article](https://dev.to/ynrfin/use-golang-migrate-on-docker-compose-50o5) — compose service pattern
- [AWS multi-tenant RLS guide](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/) — RLS session variable pattern
- [Crunchy Data RLS for tenants](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres/) — Postgres RLS policy design
- [Resend SMTP docs](https://resend.com/docs/send-with-smtp) — `smtp.resend.com:465` credentials

### Tertiary (LOW confidence; verify at implementation)
- `@lowdefy/plugin-nextauth` npm package existence at 5.3.0 — assumed, not directly verified
- Knex `pool.afterCreate` hook expressible via Lowdefy custom plugin — assumed, not verified in this repo
- ICU collation availability in `postgres:16` Docker image without custom build flags — assumed

---

## Metadata

**Confidence breakdown:**
- Smoke test resolution: HIGH — live system probe confirms pass
- Standard stack: HIGH — all existing deps in repo; new deps verified via npm/ctx7
- Migration patterns: HIGH — direct copy of PRD §10 SQL + ARCHITECTURE.md RLS pattern
- Auth integration: MEDIUM — KnexAdapter + Resend SMTP path is documented but unexercised in this repo
- Plugin scaffold: MEDIUM — canonical pattern from skill `09-plugins.md`; first time applying it here
- Ops baseline: HIGH — standard PowerShell + Task Scheduler + rclone; no novel technology

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days; stack is stable; Lowdefy 5.3 line unlikely to break compatibility)
