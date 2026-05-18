---
phase: 03-availability-rules
plan: W1
type: execute
wave: 1
depends_on: []
files_modified:
  - db/migrations/0015_add_shifty_tenant_id_to_users.up.sql
  - db/migrations/0015_add_shifty_tenant_id_to_users.down.sql
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig.json
  - next.config.ts
  - eslint.config.mjs
  - tailwind.config.ts
  - postcss.config.mjs
  - components.json
  - .prettierrc
  - .dockerignore
  - .gitignore
  - Dockerfile
  - drizzle.config.ts
  - middleware.ts
  - auth.config.ts
  - auth.ts
  - app/layout.tsx
  - app/page.tsx
  - app/globals.css
  - app/(public)/login/page.tsx
  - app/(public)/login/verify/page.tsx
  - app/(public)/login/error/page.tsx
  - app/(authed)/layout.tsx
  - app/(authed)/page.tsx
  - app/(authed)/shifts/page.tsx
  - app/api/auth/[...nextauth]/route.ts
  - src/db/schema.ts
  - src/db/client.ts
  - src/lib/auth/config.ts
  - src/lib/auth/index.ts
  - src/lib/auth/callbacks.ts
  - src/lib/auth/resend-email.ts
  - src/lib/tenant/index.ts
  - src/lib/tenant/withTenantTx.ts
  - src/lib/tenant/tenantScopedQuery.ts
  - src/lib/utils.ts
  - src/types/next-auth.d.ts
  - src/components/ui/button.tsx
  - src/components/ui/card.tsx
  - src/components/ui/input.tsx
  - src/components/ui/label.tsx
  - src/components/ui/form.tsx
  - src/components/ui/table.tsx
  - tools/check-tenant-isolation.mjs
  - tools/test/check-tenant-isolation.test.mjs
  - tools/test/fixtures/check-tenant-isolation/ok-inside-boundary.ts
  - tools/test/fixtures/check-tenant-isolation/bad-outside-boundary.ts
  - tools/test/fixtures/check-tenant-isolation/sanctioned-tx-callback.ts
  - tools/seed-founding-admin.mjs
  - tools/verify/smoke-login.mjs
  - tests/integration/tenant-scoped-query.spec.ts
  - tests/integration/layer-5-rls-blocks.spec.ts
  - tests/integration/layer5-rls-write-probe.spec.ts
  - tests/unit/session-callback.spec.ts
  - tests/unit/auth-resend-template.spec.ts
  - tests/e2e/_fixtures/seed-tenants.ts
  - playwright.config.ts
  - docker-compose.yml
  - .env.example
  - README.md
autonomous: true
loc_estimate: ~2050  # +~150 LOC over prior estimate for M-3/M-4 tests + portable verify wrappers + extra fixture
requirements:
  - TEN-01
  - TEN-02
  - TEN-03
  - TEN-04
  - TEN-05
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - SEC-01
  - SEC-07
  - PERF-04
  - I18N-07

user_setup:
  - service: resend
    why: "Magic-link emails for Auth.js sign-in. W1 dev uses the onboarding sandbox; production needs nesher.co verified."
    env_vars:
      - name: AUTH_RESEND_KEY
        source: "Resend Dashboard -> API Keys -> Create -> copy re_... token. Already provisioned per .env.example; rename from RESEND_API_KEY."
      - name: AUTH_RESEND_FROM
        source: "Verified sender address. Dev: onboarding@resend.dev (free tier; sends only to the verified Resend account email). Prod: shifty@nesher.co after domain verification."

must_haves:
  truths:
    - "Running `pnpm dev` starts the Next.js app on port 3000 without errors."
    - "Visiting `/login` renders a Hebrew-RTL magic-link form (no horizontal scroll on a 375px viewport)."
    - "The Resend Hebrew-RTL email template (sendHebrewMagicLink builder) is unit-tested: builds HTML containing `<html dir=\"rtl\" lang=\"he\">` and the magic-link URL placeholder. Verified by `tests/unit/auth-resend-template.spec.ts` (M-3)."
    - "Submitting the form with a valid email writes a `verification_tokens` row and triggers a Resend SDK call (template-builder unit test covers the rendering; SDK HTTP call is verified manually in 8e smoke against the Resend onboarding dashboard — declared deferred-to-manual per M-3 Option 1+3 hybrid)."
    - "Clicking a real magic link sets the `__Secure-authjs.session-token` cookie (or `authjs.session-token` in dev) and writes a `sessions` row."
    - "After login, `session.user.shiftyTenantId` is populated from the `users.shifty_tenant_id` column the founding admin row was seeded with."
    - "Visiting `/shifts` while authed runs a `tenantScopedQuery()` against `shift_slot`, returning an empty shadcn Card empty-state (zero rows for the admin's tenant in a fresh DB)."
    - "`pnpm test:check-tenant-isolation` exits 0 against the W1 codebase AND exits 1 against a synthetic fixture that uses `db.select().from(shiftSlot)` outside `src/lib/tenant/`."
    - "Layer-2 gate sanctioned-pattern fixture: `tenantScopedQuery((tx) => tx.select().from(...))` outside `src/lib/tenant/` is NOT flagged (B-2 + new positive fixture)."
    - "`pnpm build` produces a `.next/standalone/` tree."
    - "`docker compose build nextjs-app` succeeds locally (registry pull may need PsExec on hpg5)."
    - "Migration 0015 applied cleanly via `docker compose run --rm migrate`; `\\d users` shows the `shifty_tenant_id UUID NULL` column."
    - "Layer-5 read probe: connecting to Postgres as the `shifts` role (which auto-assumes `shifty_app` per migration 0013) and running `SELECT * FROM soldier` outside a `withTenantTx()` transaction returns zero rows."
    - "Layer-5 write probe (M-4): with `SET LOCAL app.current_tenant = '<tenant-A>'`, an INSERT into `shift_slot` carrying `tenant_id = '<tenant-B>'` raises a row-security policy violation (Postgres code 42501 / 'new row violates row-level security policy'). Verified by `tests/integration/layer5-rls-write-probe.spec.ts`."

  artifacts:
    - path: "db/migrations/0015_add_shifty_tenant_id_to_users.up.sql"
      provides: "users.shifty_tenant_id column + grant to shifty_app"
      contains: "ALTER TABLE \"users\""
    - path: "package.json"
      provides: "Next.js 15 + Auth.js v5-beta.31 + Drizzle 0.45 + pnpm scripts"
      contains: "\"next\""
    - path: "drizzle.config.ts"
      provides: "Drizzle introspect config with casing: preserve"
      contains: "casing"
    - path: "src/db/schema.ts"
      provides: "Drizzle schema introspected from live Postgres"
      contains: "pgTable"
    - path: "src/db/client.ts"
      provides: "pg.Pool + drizzle instance"
      contains: "drizzle(pool"
    - path: "src/lib/tenant/withTenantTx.ts"
      provides: "Per-request transaction wrapper that issues SET LOCAL app.current_tenant"
      contains: "SET LOCAL app.current_tenant"
    - path: "src/lib/tenant/tenantScopedQuery.ts"
      provides: "Single Layer-2 boundary; only sanctioned domain-table call path"
      contains: "shiftyTenantId"
    - path: "src/lib/auth/config.ts"
      provides: "Edge-safe Auth.js config (providers + pages); imported by middleware"
      contains: "satisfies NextAuthConfig"
    - path: "src/lib/auth/index.ts"
      provides: "Full Auth.js setup with DrizzleAdapter + session callback"
      contains: "DrizzleAdapter(db"
    - path: "src/lib/auth/callbacks.ts"
      provides: "shiftySessionCallback that reads users.shifty_tenant_id"
      contains: "shiftyTenantId"
    - path: "src/lib/auth/resend-email.ts"
      provides: "Hebrew-RTL magic-link template builder + sendHebrewMagicLink wrapper"
      contains: "buildMagicLinkHtml"
    - path: "middleware.ts"
      provides: "Edge auth gate for app/(authed)/**"
      contains: "matcher"
    - path: "app/layout.tsx"
      provides: "Hebrew RTL root layout with Heebo font"
      contains: "dir=\"rtl\""
    - path: "app/(public)/login/page.tsx"
      provides: "Magic-link request form"
      contains: "signIn"
    - path: "app/(authed)/shifts/page.tsx"
      provides: "First authed RSC route reading shift_slot via tenantScopedQuery"
      contains: "tenantScopedQuery"
    - path: "tools/check-tenant-isolation.mjs"
      provides: "Layer-2 CI gate (ts-morph AST scan). DB_IDENTIFIERS = { 'db' } only — tx outside boundary is reachable only via sanctioned tenantScopedQuery((tx) => ...) callback (B-2)."
      contains: "ts-morph"
    - path: "tools/seed-founding-admin.mjs"
      provides: "Idempotent founding-admin seed: SELECT-then-INSERT tenant (no fake ON CONFLICT (name)); ON CONFLICT (email) for users; ON CONFLICT (tenant_id, email) for app_user. Self-verifies shifty_tenant_id IS NOT NULL at exit. (B-1 + M-5)"
      contains: "SEED_ADMIN_TENANT_NAME"
    - path: "tests/unit/auth-resend-template.spec.ts"
      provides: "Unit test for Hebrew-RTL magic-link template builder (M-3)"
      contains: "buildMagicLinkHtml"
    - path: "tests/integration/layer5-rls-write-probe.spec.ts"
      provides: "Layer-5 negative write test: cross-tenant INSERT raises 42501 (M-4)"
      contains: "new row violates row-level security policy"
    - path: "Dockerfile"
      provides: "Multi-stage standalone Next.js image"
      contains: "output: 'standalone'"
    - path: "docker-compose.yml"
      provides: "nextjs-app service mapping 8080:3000"
      contains: "nextjs-app"

  key_links:
    - from: "middleware.ts"
      to: "src/lib/auth/config.ts"
      via: "import authConfig from '@/lib/auth/config'"
      pattern: "from\\s+['\"]@/lib/auth/config['\"]"
    - from: "src/lib/auth/index.ts"
      to: "src/db/schema.ts"
      via: "DrizzleAdapter(db, { usersTable: users, ... })"
      pattern: "usersTable\\s*:\\s*users"
    - from: "src/lib/auth/callbacks.ts"
      to: "users.shifty_tenant_id (migration 0015)"
      via: "session callback reads user.shiftyTenantId from the Auth.js users row"
      pattern: "shiftyTenantId"
    - from: "src/lib/tenant/tenantScopedQuery.ts"
      to: "src/lib/tenant/withTenantTx.ts"
      via: "calls withTenantTx(session.user.shiftyTenantId, fn)"
      pattern: "withTenantTx"
    - from: "src/lib/tenant/withTenantTx.ts"
      to: "Postgres app.current_tenant (migration 0013 sentinel)"
      via: "tx.execute(sql`SET LOCAL app.current_tenant = ...`)"
      pattern: "SET LOCAL app.current_tenant"
    - from: "app/(authed)/shifts/page.tsx"
      to: "src/lib/tenant/tenantScopedQuery.ts"
      via: "tenantScopedQuery(session, (tx) => tx.select().from(shiftSlot))"
      pattern: "tenantScopedQuery\\(session"
    - from: "tools/check-tenant-isolation.mjs"
      to: "src/lib/tenant/ (exempt boundary)"
      via: "skips files under src/lib/tenant/; fails on db.{select,insert,update,delete} elsewhere. tx is NOT in DB_IDENTIFIERS (B-2)."
      pattern: "src/lib/tenant"
    - from: "docker-compose.yml"
      to: "Cloudflare Tunnel"
      via: "nextjs-app publishes 8080:3000; tunnel target unchanged (D-W1-03)"
      pattern: "8080:3000"
---

<objective>
Stand up the Next.js 15 + Auth.js v5 + Drizzle ORM + shadcn/ui application substrate that Phase 03 Waves 2-4 (shift_slot CRUD, availability UI, planning_window + rules config) will build on. This is the first real-work plan after the 2026-05-18 Budibase->Next.js pivot.

Purpose: Replace the dead Budibase tier with a code-first Next.js stack that delivers strictly stronger tenant isolation than the pre-pivot posture — Layer 5 RLS becomes ACTIVE (the Next.js connection lands as `shifty_app`, NOSUPERUSER, NOBYPASSRLS), Layer 2 becomes a typed `tenantScopedQuery()` boundary enforced by a ts-morph AST CI gate, and Layer 1 ties everything together through the Auth.js session callback that reads a new `users.shifty_tenant_id` column. End state: magic-link login works, a Hebrew-RTL authed `/shifts` route renders an empty-state Card via a real tenant-scoped read, the CI gate fails the build on synthetic violations, and the multi-stage Dockerfile produces a working container that maps 8080:3000 inside docker-compose (zero Cloudflare Tunnel changes per D-W1-03).

Output: A buildable, runnable, deployable Next.js app at the repo root with the three-layer tenant-isolation contract green end-to-end; all subsequent Phase 03 waves depend on this plan.
</objective>

<revision_log>
This is revision 2 of the plan. Revision 1 was checked by gsd-plan-checker (verdict: block, 2 blockers + 5 majors). All 7 findings are addressed inline; map below points each finding to the section that holds the fix.

| Finding | Severity | Where fixed |
|---------|----------|-------------|
| B-1 — Seed script schema mismatch (`ON CONFLICT (name)`, missing `org_depth`) | blocker | Task 4 step 4h (rewritten); must_haves.artifacts: tools/seed-founding-admin.mjs |
| B-2 — Layer-2 gate flags sanctioned `tx.select()` in `tenantScopedQuery` callback | blocker | Task 6 step 6a (DB_IDENTIFIERS = {'db'} only); step 6c-new (sanctioned-tx-callback.ts positive fixture); done text updated |
| M-1 — ts-morph self-test mounting underspecified | major | Task 6 step 6a + 6b (Option (a) real-file fixtures chosen + named ts-morph APIs) |
| M-2 — Bash-only verify steps on PowerShell host | major | All `<verify>` blocks rewritten; new `tools/verify/smoke-login.mjs` Node script replaces bash backgrounding |
| M-3 — Resend SDK trigger has no automated test | major | Task 4 step 4c (export `buildMagicLinkHtml` + `buildMagicLinkText`); new `tests/unit/auth-resend-template.spec.ts` mirroring `tests/unit/invite-email-rtl.spec.ts` |
| M-4 — Missing Layer-5 RLS write-probe negative test | major | Task 7 new step 7c (was 7b): adds `tests/integration/layer5-rls-write-probe.spec.ts` |
| M-5 — SEED_ADMIN_TENANT_NAME collision footgun | major | Task 4 step 4h (env var REQUIRED, no default; clear error if missing; .env.example comment); Task 8 step 8c (.env.example update); README footgun note |
</revision_log>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/03-availability-rules/03-RESEARCH.md
@.planning/deliberations/2026-05-18-budibase-to-nextjs-pivot.md
@docs/NEXTJS-CONVENTIONS.md
@docs/PRD.md
@CLAUDE.md

# Schema source-of-truth (load-bearing for migration 0015, Drizzle pull, and the B-1 seed-script rewrite):
@db/migrations/0002_tenancy_and_org.up.sql
@db/migrations/0009_rls_policies.up.sql
@db/migrations/0013_layer5_rls_app_role.up.sql
@db/migrations/0014_phase3_denorms.up.sql

# Porting sources (verbatim template strings; rewrite the wrappers):
@legacy/shifty-handlers/auth/callbacks.js
@legacy/shifty-handlers/auth/providers.js
@legacy/shifty-handlers/dispatch/resend.js

# Existing tooling (cookie-name and baseURL updates only):
@playwright.config.ts
@tests/e2e/_fixtures/seed-tenants.ts

# Existing test mirror — Task 4 M-3 unit test copies this shape:
@tests/unit/invite-email-rtl.spec.ts

# Current docker-compose to extend with nextjs-app service:
@docker-compose.yml
@.env.example

<interfaces>
<!-- Key contracts the executor will produce/consume. Pre-extracted so no codebase scavenging is needed. -->

Migration 0002 - Auth.js tables (lines 54-147 of db/migrations/0002_tenancy_and_org.up.sql):
- "users" (id UUID PK, name TEXT, email TEXT UNIQUE, "emailVerified" TIMESTAMPTZ, image TEXT) - NOT RLS-protected per 0009 lines 10-11. CRITICAL: `email` is UNIQUE; `users` has NO unique constraint on any other column.
- tenant (id UUID PK, name TEXT NOT NULL [NOT UNIQUE!], org_depth SMALLINT NOT NULL CHECK BETWEEN 1 AND 3, created_at, updated_at) — B-1 hinges on this: no `UNIQUE (name)` so `ON CONFLICT (name)` is illegal; `org_depth` is NOT NULL with no default so the seed INSERT MUST supply it.
- accounts (id, "userId" FK, type, provider, "providerAccountId" UNIQUE-pair, ...)
- sessions (id, "sessionToken" UNIQUE, "userId" FK, expires)
- verification_tokens (identifier, token UNIQUE, expires, PK(identifier, token))
- app_user (id, tenant_id FK, email CITEXT, locale CHECK in ('he','en'), user_id FK -> users.id, UNIQUE(tenant_id, email))
- Quoted PascalCase columns are mandatory for Auth.js adapter contract; casing: 'preserve' required in drizzle.config.ts.

Migration 0013 - Layer-5 activation:
- Role `shifty_app`: NOSUPERUSER, NOBYPASSRLS, NOLOGIN, INHERIT.
- `ALTER ROLE shifts SET role = shifty_app` - every new connection auto-assumes shifty_app.
- `ALTER ROLE shifts SET app.current_tenant = '00000000-0000-0000-0000-000000000000'` - sentinel that blocks every domain table until SET LOCAL overrides it.
- FORCE ROW LEVEL SECURITY on every relrowsecurity=true table.
- migrator role bypasses RLS (used by docker compose run --rm migrate).

Migration 0015 (NEW, this plan) - shape:
- `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS shifty_tenant_id UUID NULL REFERENCES tenant(id) ON DELETE SET NULL;`
- `GRANT SELECT, UPDATE (shifty_tenant_id) ON "users" TO shifty_app;` (already implicit via 0013 GRANT ON ALL TABLES, but explicit is defensive after the new column).
- No RLS policy added — Auth.js users table is deliberately NOT RLS-protected per migration 0009 §RLS Architecture Notes lines 8-11.
- Idempotent; reversible via 0015.down.sql.

Auth.js v5 + DrizzleAdapter expected types (per @auth/drizzle-adapter README):
- `DrizzleAdapter(db, { usersTable, accountsTable, sessionsTable, verificationTokensTable })`
- session callback signature (database strategy): `({ session, user }) => Promise<Session>` where `user` is the canonical users row (extra columns like `shifty_tenant_id` are passed through).

withTenantTx contract:
- `withTenantTx<T>(tenantId: string, fn: (tx) => Promise<T>): Promise<T>`
- Validates tenantId is a UUID (defense-in-depth; sql.raw is fed validated input only).
- Opens db.transaction; tx.execute(sql`SET LOCAL app.current_tenant = ${sql.raw("'" + tenantId + "'")}`); then fn(tx).
- On commit/rollback the per-session value reverts to the migration-0013 sentinel.

tenantScopedQuery contract:
- `tenantScopedQuery<T>(session: Session, fn: (tx) => Promise<T>): Promise<T>`
- Reads `session.user.shiftyTenantId`; throws if null (treat as auth failure).
- Delegates to withTenantTx.

CI gate exempt paths (only these can call `db.{select,insert,update,delete}().from(...)`):
- src/lib/tenant/**
- src/db/**
- *.test.ts, *.spec.ts
- tests/**
- tools/test/fixtures/check-tenant-isolation/ok-inside-boundary.ts (synthetic OK fixture — mounted at src/lib/tenant/ virtual path for self-test)

CI gate forbidden-identifier set (B-2):
- DB_IDENTIFIERS = new Set(['db'])  // NOT ['db', 'tx']
- Rationale: tx outside src/lib/tenant/ is only reachable via the sanctioned tenantScopedQuery((tx) => …) callback. Flagging tx would self-contradict (it would fail the live shifts/page.tsx call site). The threat model is "someone reaches around the boundary by importing db from @/db/client" — restricting to db covers that fully.
</interfaces>

<locked_decisions>
<!-- From user 2026-05-18; do not revisit. -->
D-W1-01: Auth.js v5 beta (5.0.0-beta.31+). Dedicated Resend provider import path. auth.config.ts/auth.ts split. Unified `auth()` helper. Trust beta stability.
D-W1-02: Add `users.shifty_tenant_id UUID NULL` via migration 0015. Session callback reads it directly. Users table is NOT RLS-protected (per 0009), so this is the cleanest path. Founding-admin seeding handled in a separate W1 task using existing role grants.
D-W1-03: Cloudflare Tunnel stays at :8080. Compose service `nextjs-app` maps `8080:3000`. Zero Cloudflare/firewall ops change.

Researcher defaults applied (planner has final say; no flags):
- pnpm (faster on Windows Docker Desktop; lockfile committed).
- Drizzle 0.45.2 (not 1.0-rc).
- Env vars renamed: NEXTAUTH_SECRET -> AUTH_SECRET; RESEND_API_KEY -> AUTH_RESEND_KEY; new AUTH_RESEND_FROM. NEXTAUTH_URL kept (v5 reads it as a legacy alias).
- Local dev DB: fresh local Postgres via `docker compose up -d postgres` (NOT hpg5-tunneled).
- hpg5 volume cleanup: assumed already done by prior step; no W1 task spent on it.
</locked_decisions>
</context>

<shell_portability>
M-2 fix. The user's primary shell is PowerShell (CLAUDE.md: "Shell: PowerShell"). Every `<verify>` block in this plan is structured so the commands run identically in both PowerShell and Bash:

- Universal commands left alone: `pnpm install`, `pnpm build`, `pnpm tsc --noEmit`, `pnpm test:*`, `docker compose <subcommand>`, `docker build`, `docker run`.
- For anything that bash idioms used to handle (background a dev server, sleep, curl-and-grep, kill %1), the plan provides a single Node script `tools/verify/smoke-login.mjs` (Task 5) callable from either shell as `node tools/verify/smoke-login.mjs`.
- `grep` / `head` / `[ -f file ]` are NOT used in `<verify>` blocks. Where a string assertion is needed, the plan uses `node -e "..."` with `fs.readFileSync` + a regex.
- `psql -c "..."` invocations use double-quoted strings — works in both shells. Where `\d "users"` requires `\d \"users\"` escaping that bash and powershell handle identically (both treat `\"` inside a double-quoted string as literal `"`), the form below is portable.
</shell_portability>

<tasks>

<task type="auto">
  <name>Task 1: Migration 0015 - users.shifty_tenant_id column</name>
  <files>db/migrations/0015_add_shifty_tenant_id_to_users.up.sql, db/migrations/0015_add_shifty_tenant_id_to_users.down.sql</files>
  <action>
    Create the up + down migration pair that adds `users.shifty_tenant_id UUID NULL REFERENCES tenant(id) ON DELETE SET NULL` per D-W1-02. The Auth.js users table is intentionally NOT RLS-protected per migration 0009 §RLS Architecture Notes lines 8-11, so no RLS policy is added.

    The up migration MUST:
    - Wrap in BEGIN/COMMIT.
    - Use `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS shifty_tenant_id UUID REFERENCES tenant(id) ON DELETE SET NULL;` (idempotent).
    - Add `CREATE INDEX IF NOT EXISTS idx_users_shifty_tenant_id ON "users"(shifty_tenant_id);` so the session callback's read-by-id lookup remains O(1) once populated.
    - Explicitly `GRANT SELECT, UPDATE (shifty_tenant_id) ON "users" TO shifty_app;` to keep grant intent legible after the new column is added (the broad 0013 GRANT ON ALL TABLES already covers it; this is defensive documentation).
    - Open with a header comment block explaining: (a) why this column is needed (Auth.js session callback hydrates session.user.shiftyTenantId without bypassing RLS, eliminating the legacy `SET ROLE NONE` chicken-and-egg from `legacy/shifty-handlers/auth/callbacks.js`); (b) NULL is the legitimate initial state (user signed up but hasn't redeemed an invite — handled by `/login` redirect in the (authed) layout); (c) population is handled outside this migration — see Task 4 founding-admin seed script and W2's invite-redemption flow which will UPDATE this column.

    The down migration MUST:
    - Wrap in BEGIN/COMMIT.
    - `ALTER TABLE "users" DROP COLUMN IF EXISTS shifty_tenant_id;` (drops the index implicitly via the FK on the column).
    - Be safe to run even if the migration never applied.

    Do NOT modify any other migration. Do NOT touch app_user (its shape is fine; the session callback bypasses it entirely per D-W1-02).
  </action>
  <verify>
    <automated>docker compose run --rm migrate; docker compose exec -T postgres psql -U shifts -d shifts -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='shifty_tenant_id';"</automated>
  </verify>
  <done>0015 up applies cleanly twice (idempotent); the psql query above returns one row whose column_name is `shifty_tenant_id`; index `idx_users_shifty_tenant_id` present (verify by querying pg_indexes); down migration drops the column without error. shifty_app role can SELECT users (verified by switching role and querying). No other migration touched.</done>
</task>

<task type="auto">
  <name>Task 2: Repo scaffold - Next.js 15 + pnpm + Tailwind v4 + shadcn/ui (RTL)</name>
  <files>package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts, eslint.config.mjs, tailwind.config.ts, postcss.config.mjs, components.json, .prettierrc, .gitignore, .dockerignore, app/layout.tsx, app/page.tsx, app/globals.css, src/components/ui/button.tsx, src/components/ui/card.tsx, src/components/ui/input.tsx, src/components/ui/label.tsx, src/components/ui/form.tsx, src/components/ui/table.tsx, src/lib/utils.ts</files>
  <action>
    Scaffold the Next.js 15 + pnpm + Tailwind v4 + shadcn/ui (RTL-by-default) substrate at the repo root.

    Step 2a — replace the existing root `package.json` (the Lowdefy-era playwright+pg tooling pinger) with a Next.js 15 manifest. Preserve the existing test scripts (`test:e2e`, `test:unit`, `test:invite-code`) since the test layout survives the pivot per 03-RESEARCH.md §"Test Infrastructure / What survives from Phase 1-2". Add new scripts: `dev`, `build`, `start`, `lint`, `db:pull` (alias for `drizzle-kit pull`), `test:check-tenant-isolation`, `test:integration` (Playwright integration subset). Use a precise `packageManager` pin per checker N-7: `"packageManager": "pnpm@9.15.0"` (NOT `pnpm@9.x` — corepack refuses range specifiers).

    Step 2b — install (pnpm install --frozen-lockfile after generating manifest). Pin exactly:
    - dependencies: `next@15.5.18`, `react@^19.0.0`, `react-dom@^19.0.0`, `next-auth@5.0.0-beta.31` (per D-W1-01), `@auth/drizzle-adapter@^1.11.2`, `resend@^6.12.3`, `drizzle-orm@^0.45.2`, `pg@^8.16.3`, `zod@^4.4.3`, `next-intl@^4.12.0`, `@radix-ui/react-slot@^1.2.4`, `@radix-ui/react-label@^2.x`, `class-variance-authority@^0.7.1`, `clsx@^2.1.1`, `tailwind-merge@^3.6.0`, `lucide-react@^1.16.0`.
    - devDependencies: `typescript@^5.6`, `@types/node@^22`, `@types/react@^19`, `@types/react-dom@^19`, `@types/pg@^8`, `tailwindcss@^4.3.0`, `@tailwindcss/postcss@^4.3.0`, `drizzle-kit@^0.31.10`, `ts-morph@^28.0.0`, `eslint@^9`, `eslint-config-next@^15.5.18`, `prettier@^3`, `@playwright/test@^1.49` (already present).

    Step 2c — `tsconfig.json` with `paths: { "@/*": ["./src/*"], "@/app/*": ["./app/*"] }`, `target: "ES2022"`, `module: "esnext"`, `moduleResolution: "bundler"`, `jsx: "preserve"`, `incremental: true`, `plugins: [{ name: "next" }]`. Include `app`, `src`, `middleware.ts`, `auth.ts`, `auth.config.ts`, `next-env.d.ts`. Exclude `node_modules`, `.next`, `tests`, `tools`, `legacy`.

    Step 2d — `next.config.ts` with `output: 'standalone'` (per Dockerfile requirement) and `reactStrictMode: true`. No experimental flags.

    Step 2e — `tailwind.config.ts` content paths: `["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"]`; extend `theme.fontFamily.sans` with `"Heebo"` (loaded via `next/font/google` in `app/layout.tsx`); keep shadcn's default tokens (CSS variables from `app/globals.css`).

    Step 2f — `postcss.config.mjs` exports `{ plugins: { '@tailwindcss/postcss': {} } }` (Tailwind v4 split).

    Step 2g — `eslint.config.mjs` uses flat config extending `eslint-config-next`. No custom rules in W1 (the Hebrew RTL ml-/mr- guard is W2 nice-to-have per 03-RESEARCH.md §Pitfalls #7).

    Step 2h — `components.json` with `"rtl": true` per 03-RESEARCH.md Pattern 3:
    ```
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      "style": "default",
      "rsc": true,
      "tsx": true,
      "tailwind": { "config": "tailwind.config.ts", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true },
      "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" },
      "rtl": true
    }
    ```

    Step 2i — `app/layout.tsx`: `<html dir="rtl" lang="he">`, Heebo font via `next/font/google` applied to body, import `./globals.css`. Metadata: `{ title: "Shifty", description: "ניהול משמרות למילואים" }`.

    Step 2j — `app/globals.css`: shadcn's default CSS variables block + `@tailwind base; @tailwind components; @tailwind utilities;` (or Tailwind v4's `@import "tailwindcss";` directive — choose per Tailwind v4 install docs; `next-app` defaults are correct).

    Step 2k — `app/page.tsx`: minimal public landing that links to `/login`. Server Component, Hebrew text "התחבר ל-Shifty".

    Step 2l — Run `pnpm dlx shadcn@latest init --yes` then `pnpm dlx shadcn@latest add button card input label form table` to vendor 6 components into `src/components/ui/`. Per 03-RESEARCH.md §Pattern 3 the `rtl: true` flag in components.json triggers physical-to-logical class transforms at add time. Verify the generated Button uses `ps-*`/`pe-*` not `pl-*`/`pr-*`.

    Step 2m — `src/lib/utils.ts`: the standard shadcn `cn()` utility (clsx + tailwind-merge). If shadcn init produced it, leave it; otherwise create.

    Step 2n — `.gitignore`: add `node_modules/`, `.next/`, `.next-build/`, `out/`, `*.log`, `.env`, `.env.local`. Keep existing entries (postgres-data/ etc.).

    Step 2o — `.dockerignore`: `node_modules`, `.next`, `.git`, `tests`, `tools`, `legacy`, `*.md`, `.env*`, `postgres-data`, `archive`, `budibase-exports`, `graphify-out`, `test-results`.

    Critical: shadcn init may try to create a separate tsconfig or modify `next.config.ts` — review the generated diff and reconcile with the specs above before committing.

    Do NOT install `nodemailer` (Resend provider does not need it per 03-RESEARCH.md §Standard Stack). Do NOT install `tailwindcss-rtl` (shadcn handles RTL natively).
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile; pnpm build</automated>
  </verify>
  <done>`pnpm install --frozen-lockfile` succeeds (lockfile committed); `pnpm build` produces a `.next/standalone/` tree; `pnpm dev` boots without errors and `/` (public landing) renders with `<html dir="rtl" lang="he">`. `components.json` has `"rtl": true`. 6 shadcn components live under `src/components/ui/` and use logical-property classes (`ps-`/`pe-`/`ms-`/`me-`). `packageManager` field is the exact version `pnpm@9.15.0`.</done>
</task>

<task type="auto">
  <name>Task 3: Drizzle wiring - introspect schema, build client, define withTenantTx</name>
  <files>drizzle.config.ts, src/db/schema.ts, src/db/client.ts, src/lib/tenant/withTenantTx.ts, src/lib/tenant/tenantScopedQuery.ts, src/lib/tenant/index.ts</files>
  <action>
    Wire Drizzle against the live local Postgres (migrations 0001-0015 applied) and define the Layer-2 + Layer-5 boundary.

    Step 3a — `drizzle.config.ts` per 03-RESEARCH.md §Pattern 4:
    - `schema: './src/db/schema.ts'`
    - `out: './db/migrations'` (existing dir; we DO NOT use drizzle-kit to generate new migrations — new migrations remain raw SQL written by hand, applied via the `migrate` container, per docs/NEXTJS-CONVENTIONS.md §3)
    - `dialect: 'postgresql'`
    - `dbCredentials: { url: process.env.DATABASE_URL! }`
    - `introspect: { casing: 'preserve' }` — MANDATORY per 03-RESEARCH.md §Pitfall 1; the Auth.js tables use quoted PascalCase (`"userId"`, `"sessionToken"`, `"emailVerified"`, `"providerAccountId"`) and `'camel'` would silently rewrite them.

    Step 3b — Ensure a local Postgres is running with all 15 migrations applied:
    ```
    docker compose up -d postgres
    docker compose run --rm migrate
    ```
    Then run `pnpm drizzle-kit pull`. This writes `src/db/schema.ts` and may also create a `schema.json` or `relations.ts` — keep `schema.ts`, delete sidecar files we don't need (drizzle.config.ts can disable them with `verbose: false`; or just `git clean` the unwanted output). The schema MUST export at minimum: `users`, `accounts`, `sessions`, `verificationTokens`, `tenant`, `orgUnit`, `appUser`, `soldier`, `membership`, `shiftSlot`, `planningWindow`, `shiftInstance`, `availability`, `roleTag`, `scheduleAudit`, `notificationLog`, `inviteCode`, `inviteCodeRedemption`, `rosterImportLog`. (The `pull` command emits all tables; we just verify these are present.) Hand-fix any column-name oddities the introspect tool gets wrong by comparing against `db/migrations/0002_*.up.sql` and `0015_*.up.sql` directly.

    Step 3c — `src/db/client.ts` per 03-RESEARCH.md §Code Example 1:
    - `import { Pool } from 'pg'; import { drizzle } from 'drizzle-orm/node-postgres'; import * as schema from './schema';`
    - Throw at import time if `DATABASE_URL` unset.
    - Export `pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 })`.
    - Export `db = drizzle(pool, { schema })`.
    - Export type `DB = typeof db`.

    Step 3d — `src/lib/tenant/withTenantTx.ts` per 03-RESEARCH.md §Pattern 2:
    - Signature: `withTenantTx<T>(tenantId: string, fn: (tx) => Promise<T>): Promise<T>`.
    - First line: validate `tenantId` is a UUID via `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)`; throw `Error('withTenantTx: tenant_id missing or invalid - request rejected (Layer-5 guard)')` otherwise. This defends the one `sql.raw` use site below.
    - Body: `return db.transaction(async (tx) => { await tx.execute(sql\`SET LOCAL app.current_tenant = ${sql.raw("'" + tenantId + "'")}\`); return fn(tx); });`
    - Why `sql.raw` is safe here: tenantId is regex-validated to UUID-only chars one line earlier; cannot contain quote/semicolon/SQL meta.
    - Comment block explains the migration-0013 sentinel revert-on-commit/rollback behavior so a future reader understands the secure-by-default failure mode.

    Step 3e — `src/lib/tenant/tenantScopedQuery.ts`:
    - Signature: `tenantScopedQuery<T>(session: Session, fn: (tx) => Promise<T>): Promise<T>`.
    - Reads `session.user.shiftyTenantId`; throws `Error('tenantScopedQuery: session has no shiftyTenantId - did the user redeem an invite?')` if null.
    - Delegates to `withTenantTx(tenantId, fn)`.
    - Import `Session` from `next-auth` (the module-augmentation in Task 4 makes `shiftyTenantId` typed).

    Step 3f — `src/lib/tenant/index.ts`: re-export `tenantScopedQuery`, `withTenantTx`. This is the ONLY public surface for tenant-scoped data access; the CI gate in Task 6 enforces it.
  </action>
  <verify>
    <automated>pnpm drizzle-kit pull; pnpm tsc --noEmit; node -e "const s=require('fs').readFileSync('src/db/schema.ts','utf8'); if (!/userId/.test(s) || !/sessionToken/.test(s)) { console.error('casing:preserve not honored'); process.exit(1); } else { console.log('schema casing OK'); }"</automated>
  </verify>
  <done>`src/db/schema.ts` exports at least the 19 tables listed above with `casing: preserve` honored (the node assertion above proves `userId` and `sessionToken` appear quoted/cased in the schema file — these would have become `user_id` / `session_token` if casing was `camel`); `src/db/client.ts` exports `pool`, `db`, `DB`; `withTenantTx` and `tenantScopedQuery` typecheck against `next-auth`'s `Session` (after Task 4 lands the module augmentation, but this task's `tsc --noEmit` may flag the unaugmented type — acceptable interim).</done>
</task>

<task type="auto">
  <name>Task 4: Auth.js v5 setup - config split, callbacks, Resend Hebrew template, founding-admin seed</name>
  <files>auth.config.ts, auth.ts, app/api/auth/[...nextauth]/route.ts, src/lib/auth/config.ts, src/lib/auth/index.ts, src/lib/auth/callbacks.ts, src/lib/auth/resend-email.ts, src/types/next-auth.d.ts, tools/seed-founding-admin.mjs, tests/unit/auth-resend-template.spec.ts</files>
  <action>
    Wire Auth.js v5 with the DrizzleAdapter + Resend provider + session callback that hydrates `session.user.shiftyTenantId` from the `users.shifty_tenant_id` column (per D-W1-02). Implement the edge-runtime split per 03-RESEARCH.md §Pattern 1.

    Step 4a — `src/lib/auth/config.ts` (edge-safe; no DB imports; matches 03-RESEARCH.md §Code Example 2):
    - Default export `satisfies NextAuthConfig`.
    - `providers: [Resend({ from: process.env.AUTH_RESEND_FROM! })]` — `apiKey` is auto-detected from `AUTH_RESEND_KEY` env var per Auth.js v5 convention.
    - `pages: { signIn: '/login', verifyRequest: '/login/verify', error: '/login/error' }`.
    - `session: { strategy: 'database' }` per docs/NEXTJS-CONVENTIONS.md §4 (revocable sessions).
    - No callbacks here — they live in `src/lib/auth/index.ts` (need DB access).

    Step 4b — `src/lib/auth/callbacks.ts`:
    - `export async function shiftySessionCallback({ session, user }) { session.user = { ...session.user, id: user.id, shiftyTenantId: (user as any).shiftyTenantId ?? null, locale: (user as any).locale ?? 'he' }; return session; }`
    - Database session strategy gives `user` directly (the canonical `users` row); we read `shifty_tenant_id` straight off it — no `app_user` lookup, no `SET ROLE NONE` bypass (the chicken-and-egg from `legacy/shifty-handlers/auth/callbacks.js` is gone per D-W1-02).
    - Note in a header comment: NULL `shiftyTenantId` is the legitimate "signed in but no tenant yet" state; the (authed) layout in Task 5 redirects such users to a placeholder `/login` (invite-redemption flow is W2 scope).

    Step 4c — `src/lib/auth/resend-email.ts` (M-3 — split builder from sender so the template can be unit-tested without hitting the Resend HTTP API):
    - Export TWO PURE FUNCTIONS that DO NOT call the SDK:
      - `export function buildMagicLinkHtml({ url, identifier, locale }: { url: string; identifier: string; locale?: 'he' | 'en' }): string` — returns the rendered HTML email body. For `locale === 'en'` (or unset, default to 'he'): the Hebrew template. Hebrew template MUST contain `<html dir="rtl" lang="he">`, an inline `direction:rtl` on the wrapping container, the subject "הזמנה לשיפטי", the CTA "היכנס לשיפטי", and the `url` parameter embedded verbatim in an `<a href="...">` element.
      - `export function buildMagicLinkText({ url, identifier, locale }): string` — returns the plaintext fallback. Hebrew variant MUST begin with U+200F RLM, mirror the line shape of `legacy/shifty-handlers/dispatch/resend.js` `buildInviteText`, and include the `url` on its own line.
    - Both builders port verbatim string content from `legacy/shifty-handlers/dispatch/resend.js` `buildInviteHtml` / `buildInviteText` (the Phase 02 Litmus-tested template). Drop the legacy `createRequire` + SDK-loading wrapper (Lowdefy-pnpm-isolation hack we don't need per assumption A3 in 03-RESEARCH.md).
    - Then export the SDK call site:
      - `export async function sendHebrewMagicLink({ identifier, url, provider }: { identifier: string; url: string; provider: { server: any; from: string } }): Promise<void>` matching the Auth.js v5 `sendVerificationRequest` signature.
      - Body: instantiate `new Resend(process.env.AUTH_RESEND_KEY!)`, build html + text via the two builders above, call `resendClient.emails.send({ from: process.env.AUTH_RESEND_FROM!, to: [identifier], subject: 'הזמנה לשיפטי', html, text })`.
      - Throw on Resend SDK error response so Auth.js can record the failure.
    - Keep the legacy template's exact Hebrew strings (verified RTL-correct + Outlook-friendly per Phase 02 Litmus testing).

    Step 4c-test — `tests/unit/auth-resend-template.spec.ts` (M-3):
    - Mirror the shape of `tests/unit/invite-email-rtl.spec.ts` (the surviving pattern).
    - Import { buildMagicLinkHtml, buildMagicLinkText } from '../../src/lib/auth/resend-email';
    - Tests (Hebrew default):
      - `dir="rtl" lang="he"` present on `<html>` element (regex match).
      - `direction:rtl` and `text-align:right` inline on the wrapping container.
      - The Hebrew subject string "הזמנה לשיפטי" appears in `<title>` or body.
      - The CTA "היכנס לשיפטי" appears.
      - The magic-link URL passed in (a known placeholder like `https://test.local/api/auth/callback/email?token=PROBE`) appears verbatim in the HTML inside an `<a href>` element.
      - Plaintext starts with U+200F RLM (the literal Hebrew Right-to-Left Mark codepoint; mirror tests/unit/invite-email-rtl.spec.ts line 119 which uses the same literal) when locale is he.
      - Plaintext includes the magic-link URL on its own line.
    - Tests (English fallback):
      - `dir="ltr" lang="en"` present when `locale: 'en'`.
    - No SDK / no network. Run via `pnpm test:unit`.
    - This is the M-3 deliverable. The actual `resend.emails.send` HTTP call remains a Task 8e manual smoke item (integration concern, deferred-to-manual with explicit declaration in must_haves.truths).

    Step 4d — `src/lib/auth/index.ts` (full setup; database access; matches 03-RESEARCH.md §Code Example 2):
    - `import NextAuth from 'next-auth'; import { DrizzleAdapter } from '@auth/drizzle-adapter'; import { db } from '@/db/client'; import { users, accounts, sessions, verificationTokens } from '@/db/schema'; import authConfig from './config'; import { shiftySessionCallback } from './callbacks'; import { sendHebrewMagicLink } from './resend-email';`
    - `export const { handlers, auth, signIn, signOut } = NextAuth({ ...authConfig, adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }), callbacks: { session: shiftySessionCallback }, providers: authConfig.providers.map((p) => p.id === 'resend' ? { ...p, sendVerificationRequest: sendHebrewMagicLink } : p) });`

    Step 4e — Root re-export files for Auth.js convention:
    - `auth.ts` at repo root: `export * from '@/lib/auth';`
    - `auth.config.ts` at repo root: `export { default } from '@/lib/auth/config';`
    These match the Auth.js v5 documented import paths.

    Step 4f — `app/api/auth/[...nextauth]/route.ts`:
    - `export { GET, POST } from '@/lib/auth';` (handlers re-exported per 03-RESEARCH.md §Code Example 3).
    - Also set `export const runtime = 'nodejs';` to be explicit (DrizzleAdapter requires Node).

    Step 4g — `src/types/next-auth.d.ts` (module augmentation per 03-RESEARCH.md §Pattern 5):
    ```
    import 'next-auth';
    declare module 'next-auth' {
      interface Session { user: { id: string; email: string; name?: string | null; image?: string | null; shiftyTenantId: string | null; locale: 'he' | 'en'; }; }
      interface User { shiftyTenantId?: string | null; locale?: 'he' | 'en' | null; }
    }
    ```
    Add the path to `tsconfig.json`'s `include` so it's picked up.

    Step 4h — `tools/seed-founding-admin.mjs` (B-1 + M-5 rewrite; founding-admin one-time seed; closes the D-W1-02 follow-up note "Initial seeding for the founding admin happens in a separate W1 task"):

    Header comment block MUST state:
    - This script runs as `migrator` (SUPERUSER, bypasses RLS by design). Operator-only.
    - SCHEMA NOTES (B-1):
      - `tenant.name` has NO UNIQUE constraint (verified against migration 0002 line 27). Therefore `ON CONFLICT (name)` is illegal SQL — Postgres rejects with "there is no unique or exclusion constraint matching the ON CONFLICT specification". The script uses SELECT-then-INSERT instead.
      - `tenant.org_depth` is NOT NULL CHECK BETWEEN 1 AND 3 (migration 0002 line 28). The INSERT MUST supply it. Founding admin's root tenant is `org_depth = 1` (top of the 3-tier company/unit/team hierarchy).
      - `users.email` IS UNIQUE (migration 0002 line 57) — safe to use `ON CONFLICT (email) DO UPDATE`.
      - `app_user (tenant_id, email)` IS a composite UNIQUE (migration 0002 line 73) — safe to use `ON CONFLICT (tenant_id, email) DO NOTHING`.
    - M-5: `SEED_ADMIN_TENANT_NAME` is the operator contract. Re-running with the same name reuses the existing tenant. To create a fresh tenant for a fresh admin, supply a unique name (suffix with date or operator initials).

    Body:
    - `import { Pool } from 'pg';` (no Drizzle, no Next runtime; ESM).
    - Reads from env, fails fast on missing (M-5):
      - `DATABASE_URL` — required.
      - `SEED_ADMIN_EMAIL` — required.
      - `SEED_ADMIN_TENANT_NAME` — required, NO DEFAULT. If missing, exit 2 with stderr message: "SEED_ADMIN_TENANT_NAME is required (no default — pick a unique tenant display name; re-runs are idempotent on this name)".
    - Connects to `process.env.DATABASE_URL`, expects it to authenticate as the `migrator` role (operator runs this via `pnpm seed:admin` against the local Postgres which has MIGRATOR_PASSWORD set in .env).
    - Inside a single `BEGIN; ... COMMIT;` transaction (use `client.query('BEGIN')` then `client.query('COMMIT')` on success, `ROLLBACK` on any throw — single connection from the pool, NOT pool.query for atomicity):

      ```js
      // Step 1: tenant — SELECT-then-INSERT (no UNIQUE on name).
      const found = await client.query(
        'SELECT id FROM tenant WHERE name = $1 LIMIT 1',
        [SEED_ADMIN_TENANT_NAME]
      );
      let tenantId;
      if (found.rowCount > 0) {
        tenantId = found.rows[0].id;
      } else {
        const ins = await client.query(
          'INSERT INTO tenant (name, org_depth) VALUES ($1, 1) RETURNING id',
          [SEED_ADMIN_TENANT_NAME]
        );
        tenantId = ins.rows[0].id;
      }

      // Step 2: users — ON CONFLICT (email) is legal; users.email is UNIQUE per migration 0002 line 57.
      const userResult = await client.query(
        'INSERT INTO "users" (email, "emailVerified", shifty_tenant_id) ' +
        'VALUES ($1, now(), $2) ' +
        'ON CONFLICT (email) DO UPDATE SET shifty_tenant_id = EXCLUDED.shifty_tenant_id ' +
        'RETURNING id, shifty_tenant_id',
        [SEED_ADMIN_EMAIL, tenantId]
      );
      const userId = userResult.rows[0].id;

      // Step 3: app_user — ON CONFLICT (tenant_id, email) is legal; composite UNIQUE per migration 0002 line 73.
      await client.query(
        'INSERT INTO app_user (tenant_id, email, locale, user_id) ' +
        'VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT (tenant_id, email) DO UPDATE SET user_id = EXCLUDED.user_id',
        [tenantId, SEED_ADMIN_EMAIL, 'he', userId]
      );
      ```

    - Self-verifying assertion (B-1 fix sub-step "include a self-verifying SELECT shifty_tenant_id FROM users WHERE email = $1 assertion at the end that errors if NULL"):
      ```js
      const verify = await client.query(
        'SELECT id, shifty_tenant_id FROM "users" WHERE email = $1',
        [SEED_ADMIN_EMAIL]
      );
      if (verify.rowCount === 0) {
        throw new Error('Seed verification failed: no users row for ' + SEED_ADMIN_EMAIL);
      }
      if (verify.rows[0].shifty_tenant_id === null) {
        throw new Error('Seed verification failed: shifty_tenant_id is NULL — the upsert did not populate the column. Check migration 0015 is applied.');
      }
      ```

    - Print on success: `tenant.id`, `users.id`, `users.shifty_tenant_id`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_TENANT_NAME`. Operator records these.
    - Add a `package.json` script: `"seed:admin": "node tools/seed-founding-admin.mjs"`.

    Idempotence proof: re-running with the same env produces zero new rows (the SELECT-then-INSERT short-circuits the tenant create; both upserts are no-ops on identical input) and zero errors. The self-verification at exit confirms the column stays populated.

    Do NOT add a session callback that queries `app_user` (legacy `SET ROLE NONE` path is dead per D-W1-02). Do NOT use the `EmailProvider` from `next-auth/providers/email` (legacy SMTP wrapper) — use the dedicated `Resend` provider from `next-auth/providers/resend` per D-W1-01.
  </action>
  <verify>
    <automated>pnpm tsc --noEmit; pnpm test:unit; pnpm seed:admin; docker compose exec -T postgres psql -U shifts -d shifts -c "SELECT email, shifty_tenant_id IS NOT NULL AS hydrated FROM \"users\" WHERE email = current_setting('SEED_ADMIN_EMAIL', true) OR email = 'omernesher@gmail.com';"</automated>
  </verify>
  <done>`pnpm tsc --noEmit` passes (including the augmented Session type). `tests/unit/auth-resend-template.spec.ts` passes — proves `buildMagicLinkHtml` renders RTL Hebrew with the magic-link URL embedded (M-3 closes). `tools/seed-founding-admin.mjs` runs idempotently — second run produces same row, exits 0; running with `SEED_ADMIN_TENANT_NAME` unset exits 2 with a clear stderr message (M-5). Founding admin's `users.shifty_tenant_id` is populated to the tenant's UUID (B-1 self-verifying assertion confirms). `src/lib/auth/config.ts` does NOT import `@/db/*` or `@auth/drizzle-adapter` (edge-safe). `src/lib/auth/index.ts` re-exports `handlers`, `auth`, `signIn`, `signOut`. Module augmentation makes `session.user.shiftyTenantId` typed as `string | null` everywhere.</done>
</task>

<task type="auto">
  <name>Task 5: Middleware + auth pages + first authed route</name>
  <files>middleware.ts, app/(public)/login/page.tsx, app/(public)/login/verify/page.tsx, app/(public)/login/error/page.tsx, app/(authed)/layout.tsx, app/(authed)/page.tsx, app/(authed)/shifts/page.tsx, tools/verify/smoke-login.mjs</files>
  <action>
    Wire the edge-runtime auth gate, the public login flow, and the first authed route that proves the full stack end-to-end via a real `tenantScopedQuery()` read of `shift_slot`.

    Step 5a — `middleware.ts` at repo root per 03-RESEARCH.md §Code Example 4:
    - `import NextAuth from 'next-auth'; import authConfig from './auth.config';`
    - `const { auth } = NextAuth(authConfig);`
    - `export default auth((req) => { if (!req.auth && req.nextUrl.pathname.startsWith('/shifts')) { return Response.redirect(new URL('/login', req.nextUrl)); } });`
    - `export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };`
    - CRITICAL: imports ONLY `auth.config` (edge-safe) — never `auth.ts` (which pulls in Drizzle + pg) per 03-RESEARCH.md §Pitfall 2.
    - For W1 the only authed path prefix is `/shifts`. W2+ extends the prefix list.

    Step 5b — `app/(public)/login/page.tsx`:
    - Server Component. Render a Hebrew RTL form: heading "התחבר ל-Shifty", a shadcn `<Input type="email" name="email" dir="ltr" required>` (LTR per docs/NEXTJS-CONVENTIONS.md §6), `<Label>` "כתובת אימייל", and a shadcn `<Button type="submit">` "שלח קישור התחברות".
    - The form `action` is a server action declared inline: `async function requestMagicLink(formData: FormData) { 'use server'; const { signIn } = await import('@/lib/auth'); await signIn('resend', { email: formData.get('email') as string, redirectTo: '/shifts' }); }`.
    - Wrap in a shadcn `<Card>` with `max-w-md mx-auto` for the mobile-first layout.
    - Below the form: small print "נשלח אליך קישור חד-פעמי שתוקפו 30 דקות.".

    Step 5c — `app/(public)/login/verify/page.tsx`:
    - Server Component. Renders "בדוק את האימייל שלך" Card with copy explaining the magic link was sent. No form.

    Step 5d — `app/(public)/login/error/page.tsx`:
    - Server Component. Reads `searchParams.error` and shows a Hebrew translation of common Auth.js error codes (`Verification`, `EmailSignin`, `Default`). Falls back to a generic "אירעה שגיאה" message.

    Step 5e — `app/(authed)/layout.tsx`:
    - Server Component. `const session = await auth(); if (!session?.user) redirect('/login'); if (!session.user.shiftyTenantId) redirect('/login?reason=no-tenant');`
    - Renders `{children}` inside a simple container (`<main className="container mx-auto p-6">`).
    - Add a top bar with the user's email + a sign-out form (server action: `'use server'; await signOut({ redirectTo: '/' });`).
    - Notes the Hebrew RTL chrome flips naturally — Tailwind's `container mx-auto` is RTL-symmetric.

    Step 5f — `app/(authed)/page.tsx`:
    - Server Component. Hebrew heading "ברוך הבא ל-Shifty" + a `<Card>` listing the navigation links: `<a href="/shifts">משמרות</a>` (only link in W1; W2+ adds rules, swaps, etc.).

    Step 5g — `app/(authed)/shifts/page.tsx` per 03-RESEARCH.md §Code Example 5:
    - `import { auth } from '@/lib/auth'; import { redirect } from 'next/navigation'; import { tenantScopedQuery } from '@/lib/tenant'; import { shiftSlot } from '@/db/schema';`
    - `export default async function ShiftsPage() { const session = await auth(); if (!session?.user?.shiftyTenantId) redirect('/login'); const slots = await tenantScopedQuery(session, (tx) => tx.select().from(shiftSlot).limit(50)); return ( ... ); }`
    - Render: heading "משמרות"; shadcn `<Card>` with `<CardHeader><CardTitle>תבניות משמרת ({slots.length})</CardTitle></CardHeader>`. If `slots.length === 0`: `<CardContent><p className="text-muted-foreground">אין עדיין תבניות משמרת.</p></CardContent>` (the W1 success state — fresh DB has zero slots). If non-empty: render a shadcn `<Table>` with columns name / headcount.
    - Below the Card: a placeholder `<Button>צור תבנית חדשה</Button>` (no action; W2 wires it).

    Critical: the `shifts/page.tsx` import of `shiftSlot` and `tenantScopedQuery` is THE proof point that the three-layer contract works end-to-end. Layer 1: `auth()` provides `session.user.shiftyTenantId`. Layer 2: `tenantScopedQuery` is the only import path. Layer 5: inside `tenantScopedQuery` → `withTenantTx` → `SET LOCAL app.current_tenant` → Postgres RLS scopes the read.

    Step 5h — `tools/verify/smoke-login.mjs` (M-2 fix: replaces bash backgrounding with a portable Node script that runs identically in PowerShell and Bash):
    - ESM Node script. Imports `child_process.spawn`, `node-fetch` (or `globalThis.fetch` on Node 22+), `setTimeout` from `timers/promises`.
    - Spawns `pnpm dev` as a detached child, captures stdout (waits for line matching `/Ready in/`).
    - After server is ready (or 30s timeout), does:
      1. `GET /` — assert status 200 and HTML contains `dir="rtl"` (Hebrew RTL landing).
      2. `GET /shifts` — assert status 307 or 302 with Location header pointing to `/login` (unauth redirect).
      3. `GET /login` — assert status 200 and HTML contains `התחבר ל-Shifty`.
    - On any failure: kill the child, exit 1 with diagnostic stderr.
    - On all-pass: kill the child cleanly (`child.kill('SIGTERM')`), exit 0.
    - Add to package.json: `"verify:smoke-login": "node tools/verify/smoke-login.mjs"`.
    - This script is the M-2 fix — the verify block below calls it instead of using bash `&` / `sleep` / `kill %1`.
  </action>
  <verify>
    <automated>pnpm tsc --noEmit; pnpm build; pnpm verify:smoke-login</automated>
  </verify>
  <done>`pnpm build` succeeds. `pnpm verify:smoke-login` (M-2 portable Node script) exits 0: confirms `pnpm dev` boots, unauth `/shifts` redirects to `/login`, `/login` renders Hebrew RTL form. middleware.ts does NOT import `@/lib/auth/index` (verify with `node -e` reading middleware.ts and asserting no match against `/from\s+['\"]@\/lib\/auth['\"]|from\s+['\"]\.\/auth['\"]/`). After a manual magic-link flow (or seeded session for tests), `GET /shifts` renders the empty-state Card without any 500 error in logs.</done>
</task>

<task type="auto">
  <name>Task 6: Layer-2 CI gate - ts-morph AST scanner with golden fixtures (B-2 + M-1 fixes)</name>
  <files>tools/check-tenant-isolation.mjs, tools/test/check-tenant-isolation.test.mjs, tools/test/fixtures/check-tenant-isolation/ok-inside-boundary.ts, tools/test/fixtures/check-tenant-isolation/bad-outside-boundary.ts, tools/test/fixtures/check-tenant-isolation/sanctioned-tx-callback.ts</files>
  <action>
    Replace the dead `tools/check-bb-queries.mjs` with a ts-morph AST scanner that fails the build when any `db.{select,insert,update,delete}().from(...)` sits outside the `src/lib/tenant/` boundary.

    Step 6a — `tools/check-tenant-isolation.mjs` per 03-RESEARCH.md §Code Example 6, with B-2 + M-1 corrections:

    ```js
    // B-2 fix: DB_IDENTIFIERS includes ONLY 'db', NOT 'tx'.
    //
    // Rationale (encoded as a comment so future readers don't re-add 'tx'):
    //   `tx` outside `src/lib/tenant/` is, by construction, only reachable via the
    //   sanctioned `tenantScopedQuery((tx) => ...)` callback pattern. The Layer-2
    //   boundary IS the `tenantScopedQuery` helper itself; calling code receives `tx`
    //   inside the callback and is expected to issue `tx.select().from(...)`. That's
    //   the documented API.
    //
    //   The actual threat we guard against is "someone reaches around the boundary by
    //   importing `db` from `@/db/client` and calling `db.select().from(...)` in a
    //   handler". `db` is the only identifier that can leak the unscoped connection.
    //   Restricting DB_IDENTIFIERS to `{ 'db' }` covers that fully without
    //   self-contradicting on the live `shifts/page.tsx` call site that uses `tx`.
    //
    //   Sanctioned-pattern fixture (sanctioned-tx-callback.ts) proves the gate does
    //   NOT flag the documented `tenantScopedQuery((tx) => tx.select().from(...))`
    //   call pattern when it appears outside `src/lib/tenant/`.
    const DB_IDENTIFIERS = new Set(['db']);
    const FORBIDDEN_METHODS = new Set(['select', 'insert', 'update', 'delete']);
    ```

    - ESM module (`.mjs`). `import { Project, SyntaxKind, Node } from 'ts-morph'; import path from 'node:path';`
    - Load `Project({ tsConfigFilePath: './tsconfig.json' })`.
    - Walk `src/**/*.{ts,tsx}` and `app/**/*.{ts,tsx}` source files.
    - Skip exempt paths: anything starting with `path.resolve('src/lib/tenant')`, anything starting with `path.resolve('src/db')`, anything matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `tests/**`, `tools/**`.
    - For each `CallExpression`: extract the property access chain; if the leaf method is in `FORBIDDEN_METHODS` AND the root identifier is in `DB_IDENTIFIERS`, record a violation. (Note: `tx.select()` is NOT in DB_IDENTIFIERS so it is not scanned at all. `pool.query()` is also not scanned — legitimate raw escape hatch inside `src/lib/tenant/`.)
    - On exit: if `violations.length > 0`, print each violation as `Layer 2 violation: <relative-path>:<line>: <expr-snippet>` and `process.exit(1)`. Otherwise print `Layer 2 check passed: 0 violations.` and `process.exit(0)`.
    - Add a `--self-test` flag — see step 6a-selftest below for the mechanism (M-1 fix).

    Step 6a-selftest — `--self-test` flag mechanism (M-1 fix, Option (a): real-file fixtures with synthetic-path mounting):

    The `--self-test` flag does NOT walk the filesystem normally (the gate's `tools/**` exclusion would skip the fixture files on disk). Instead, the self-test:

    1. Creates a fresh `Project()` with `useInMemoryFileSystem: false` and NO `tsConfigFilePath` (a minimal Project for the test).
    2. Reads each fixture's contents from disk via `fs.readFileSync(<fixture-path>, 'utf8')`.
    3. For each fixture, mounts it under a SYNTHETIC PATH that represents where this code WOULD live in production:
       - `tools/test/fixtures/check-tenant-isolation/ok-inside-boundary.ts` content → mounted at synthetic path `src/lib/tenant/__probe-ok.ts` (inside the exempt boundary).
       - `tools/test/fixtures/check-tenant-isolation/bad-outside-boundary.ts` content → mounted at synthetic path `app/(authed)/__probe-bad/page.tsx` (outside the exempt boundary).
       - `tools/test/fixtures/check-tenant-isolation/sanctioned-tx-callback.ts` content → mounted at synthetic path `app/(authed)/__probe-sanctioned/page.tsx` (outside the boundary, exercising the `tenantScopedQuery((tx) => ...)` pattern).
    4. Mount API: `project.createSourceFile('<synthetic-path>', <content>)` (the ts-morph API for synthetic-path mounting; the path string is what the gate's exempt-path matcher reads).
    5. The gate's exempt-path matcher is run against the SYNTHETIC paths (NOT the on-disk paths), so the gate correctly treats `src/lib/tenant/__probe-ok.ts` as exempt and `app/(authed)/__probe-bad/page.tsx` as in-scope.
    6. Runs the same scan loop over `project.getSourceFiles()`.
    7. Asserts:
       - OK fixture (mounted under exempt prefix): exactly 0 violations.
       - BAD fixture (mounted under `app/(authed)/`): exactly 1 violation.
       - Sanctioned-tx fixture (mounted under `app/(authed)/`): exactly 0 violations (tx is not in DB_IDENTIFIERS).
    8. Exits 0 iff ALL assertions pass; exits 1 otherwise with diagnostic stderr identifying which assertion failed.

    Step 6b — `tools/test/fixtures/check-tenant-isolation/ok-inside-boundary.ts`:
    - Plain TypeScript file containing the violating pattern: `import { db } from '@/db/client'; import { shiftSlot } from '@/db/schema'; export function probe() { return db.select().from(shiftSlot); }`.
    - On disk this lives under `tools/test/fixtures/...` (a path the gate's `tools/**` rule normally excludes).
    - The self-test mounts its CONTENT at the synthetic path `src/lib/tenant/__probe-ok.ts` — the gate sees `src/lib/tenant/` (exempt) → 0 violations expected. This proves the exempt-path skip works.

    Step 6c — `tools/test/fixtures/check-tenant-isolation/bad-outside-boundary.ts`:
    - Same content as 6b (also using `db.select().from(...)`).
    - The self-test mounts its CONTENT at the synthetic path `app/(authed)/__probe-bad/page.tsx` — outside the exempt boundary → 1 violation expected. This proves the gate fires on the actual threat (db reach-around).

    Step 6c-new — `tools/test/fixtures/check-tenant-isolation/sanctioned-tx-callback.ts` (B-2 positive fixture):
    - Demonstrates the SANCTIONED PATTERN: `tx.select().from(...)` inside a `tenantScopedQuery((tx) => ...)` callback. Content:
      ```ts
      import { tenantScopedQuery } from '@/lib/tenant';
      import { shiftSlot } from '@/db/schema';
      // This pattern lives in production handlers; it's the documented Layer-2 API.
      export async function loadSlots(session: any) {
        return tenantScopedQuery(session, (tx) =>
          tx.select().from(shiftSlot).limit(50)
        );
      }
      ```
    - The self-test mounts its CONTENT at the synthetic path `app/(authed)/__probe-sanctioned/page.tsx` (outside `src/lib/tenant/`) → 0 violations expected. This is the B-2 proof: the gate does NOT flag the sanctioned `tx.select()` pattern because `tx` is not in DB_IDENTIFIERS.

    Step 6d — `tools/test/check-tenant-isolation.test.mjs`:
    - Uses `node:test`. Three tests:
      1. OK fixture mounted under `src/lib/tenant/` produces zero violations + exit 0.
      2. BAD fixture mounted under `app/(authed)/` produces one violation + exit 1.
      3. Sanctioned-tx-callback fixture mounted under `app/(authed)/` produces zero violations + exit 0 (B-2 positive case).
    - Both tests assert the printed message contains the expected substring.
    - Run via `pnpm test:check-tenant-isolation-unit` (add to `package.json` scripts).

    Step 6e — wire into the existing `package.json` scripts:
    - `"test:check-tenant-isolation": "node tools/check-tenant-isolation.mjs"`
    - `"test:check-tenant-isolation-selftest": "node tools/check-tenant-isolation.mjs --self-test"`
    - `"test:check-tenant-isolation-unit": "node --test tools/test/check-tenant-isolation.test.mjs"`

    Step 6f — DELETE the dead `tools/check-bb-queries.mjs` + `tools/test/check-bb-queries.test.mjs` + `tools/test/fixtures/check-bb-queries/` if they exist (they're Budibase-era artifacts replaced by this gate per 03-RESEARCH.md §State of the Art). Keep `tools/check-queries.mjs` if still present — it's Lowdefy-era YAML, dead but harmless until W2 cleanup. (Per check N-1, these files don't currently exist; the `if exists` hedge keeps this safe.)

    Critical (B-2): The gate must NOT false-positive on `tx.select()` outside the boundary (sanctioned tenantScopedQuery callback pattern). The forbidden-identifier set is strictly `{ 'db' }`, NOT `{ 'db', 'tx' }`. The sanctioned-tx-callback.ts fixture proves this assertion holds. The done text below reflects the corrected gate behavior.
  </action>
  <verify>
    <automated>pnpm test:check-tenant-isolation; pnpm test:check-tenant-isolation-selftest; pnpm test:check-tenant-isolation-unit</automated>
  </verify>
  <done>
    `pnpm test:check-tenant-isolation` exits 0 against the W1 codebase. The gate flags `db.<verb>(...)` method calls only; `tx.<verb>(...)` method calls (inside the sanctioned `tenantScopedQuery((tx) => ...)` callback, e.g. at `app/(authed)/shifts/page.tsx`) are NOT scanned — this is the boundary contract (B-2). `--self-test` proves the gate FAILS on the bad fixture (db reach-around outside boundary) AND PASSES on both the ok fixture (db usage inside boundary, exempt) and the sanctioned-tx-callback fixture (tx usage outside boundary, intentionally not scanned). `node --test` over the unit-test file passes all three cases. `tools/check-bb-queries.mjs` and its tests are deleted (or confirmed absent).
  </done>
</task>

<task type="auto">
  <name>Task 7: Tenant-isolation integration tests + cookie/baseURL updates + Layer-5 write probe (M-4)</name>
  <files>tests/integration/tenant-scoped-query.spec.ts, tests/integration/layer-5-rls-blocks.spec.ts, tests/integration/layer5-rls-write-probe.spec.ts, tests/unit/session-callback.spec.ts, tests/e2e/_fixtures/seed-tenants.ts, playwright.config.ts</files>
  <action>
    Add the integration tests that prove the Layer-2 + Layer-5 contract is active end-to-end (read AND write paths per M-4), plus the small cookie-name + baseURL updates the post-pivot Playwright fixtures need per 03-RESEARCH.md §Test Infrastructure.

    Step 7a — `tests/integration/tenant-scoped-query.spec.ts`:
    - Uses `node:test` (preferred for back-end DB tests; matches existing `tests/unit/*.spec.ts` style).
    - `beforeAll`: connect to Postgres as `migrator` (SUPERUSER); INSERT two tenants ('tenant-a-7a', 'tenant-b-7a') with `org_depth = 1`, one `shift_slot` per tenant. Record their UUIDs.
    - Test 1: build a fake `Session` object with `shiftyTenantId = tenantA.id`; call `tenantScopedQuery(session, (tx) => tx.select().from(shiftSlot))`; assert exactly 1 row returned AND it's tenant-A's slot.
    - Test 2: same with `tenantB.id`; assert exactly 1 row, tenant-B's slot.
    - Test 3: build a session with `shiftyTenantId = null`; assert `tenantScopedQuery` THROWS with message containing "shiftyTenantId".
    - Test 4: build a session with `shiftyTenantId = 'not-a-uuid'`; assert THROWS with message containing "Layer-5 guard".
    - `afterAll`: TRUNCATE the seeded rows.

    Step 7b — `tests/integration/layer-5-rls-blocks.spec.ts` (Layer-5 READ probe):
    - Connect to Postgres as `shifts` (the app role; auto-assumes `shifty_app` per migration 0013).
    - Without opening any transaction (no `SET LOCAL`), run `SELECT * FROM soldier`.
    - Assert the result has 0 rows even though `migrator` can see seeded rows (Layer 5 active — sentinel UUID matches no tenant).
    - Cleanup: same pattern as 7a.

    Step 7c — `tests/integration/layer5-rls-write-probe.spec.ts` (M-4 fix — Layer-5 WRITE probe; explicitly user-requested in W1 brief Question 11; the checker correctly flagged its absence):

    Pattern:
    - `beforeAll`: connect to Postgres as `migrator` (SUPERUSER); INSERT two tenants ('tenant-a-7c', 'tenant-b-7c') with `org_depth = 1`. Record their UUIDs as `tenantA_id` and `tenantB_id`.
    - Test setup: open a SECOND pool connection as `shifts` (which auto-assumes `shifty_app` per migration 0013 — NOSUPERUSER, NOBYPASSRLS).
    - Test 1 (cross-tenant write probe):
      - Open a transaction on the `shifts`/`shifty_app` connection.
      - `SET LOCAL app.current_tenant = '<tenantA_id>'` (the "active tenant" for this session).
      - Attempt to INSERT into `shift_slot` with `tenant_id = '<tenantB_id>'` (the WRONG tenant — cross-tenant smuggle attempt):
        ```sql
        INSERT INTO shift_slot (tenant_id, name, headcount, start_time, end_time, weekday)
        VALUES ('<tenantB_id>', 'probe-cross-tenant', 1, '08:00', '12:00', 1);
        ```
      - Assert: the INSERT throws a Postgres error with one of these signals (any one suffices — Postgres uses both depending on policy shape):
        - `code === '42501'` (insufficient_privilege / RLS violation), OR
        - error `message` matches `/new row violates row-level security policy/i`.
      - The transaction is rolled back automatically by the error.
    - Test 2 (same-tenant write succeeds — proves the policy isn't blocking everything):
      - Open a fresh transaction on the `shifty_app` connection.
      - `SET LOCAL app.current_tenant = '<tenantA_id>'`.
      - INSERT into `shift_slot` with `tenant_id = '<tenantA_id>'` (matching the active tenant).
      - Assert: INSERT succeeds (returns 1 affected row). Rollback at end to keep DB clean.
    - `afterAll`: as `migrator`, DELETE the test tenants and any orphaned rows (CASCADE handles shift_slot).

    Adapter notes (mirroring the surviving 7a + 7b patterns):
    - Use `pg.Pool` with two separate pools: one with `MIGRATOR_PASSWORD` for setup/teardown, one with `POSTGRES_PASSWORD` (the `shifts` role) for the probe itself.
    - The two connection pools allow the test to clearly separate setup-as-superuser from probe-as-shifty_app.
    - SKIP gracefully when `DATABASE_URL` and `MIGRATOR_PASSWORD` are unset (consistent with 7a/7b).

    Why this completes M-4: Migration 0009 line 102 establishes the policy as `USING (...) WITH CHECK (...)` — the WITH CHECK clause is the INSERT/UPDATE enforcer. Until this test exists, ONLY the USING clause (SELECT-time) is proven active by 7b. The user explicitly asked for write coverage. After 7c lands, both halves of the policy are verified.

    Step 7d — `tests/unit/session-callback.spec.ts`:
    - Pure unit test (no DB). Imports `shiftySessionCallback` from `@/lib/auth/callbacks`.
    - Test 1: input `{ session: { user: {} }, user: { id: 'u1', email: 'a@b.c', shiftyTenantId: 't1', locale: 'he' } }` — assert returned `session.user.shiftyTenantId === 't1'`, `locale === 'he'`.
    - Test 2: input where user has no `shiftyTenantId` — assert returned `session.user.shiftyTenantId === null` AND `locale === 'he'` (default).
    - Test 3: input where user has `locale: 'en'` — assert returned `session.user.locale === 'en'`.

    Step 7e — `tests/e2e/_fixtures/seed-tenants.ts` (only the cookie-name update per 03-RESEARCH.md §Pitfall 5; do NOT rewrite the rest):
    - Replace the legacy `SESSION_COOKIE_NAME = '__Secure-next-auth.session-token'` constant with `SESSION_COOKIE_NAME = process.env.NEXTAUTH_URL?.startsWith('https') ? '__Secure-authjs.session-token' : 'authjs.session-token'`.
    - This handles both dev (http, plain cookie) and prod (https, __Secure- prefix).

    Step 7f — `playwright.config.ts`:
    - Update `baseURL` from `http://localhost:8080` to `http://localhost:3000` per 03-RESEARCH.md §Test Infrastructure.
    - No other changes — the existing Playwright structure survives the pivot.

    Step 7g — Add `package.json` scripts:
    - `"test:integration": "node --test tests/integration/*.spec.ts"` (use `--experimental-strip-types` for TS support if needed; consistent with existing `test:unit`).
    - Update the existing `"test:unit"` glob to include the new `session-callback.spec.ts` AND `auth-resend-template.spec.ts` (both should be matched by the existing `tests/unit/*.spec.ts` glob).

    Critical: integration tests must run against a real local Postgres (`docker compose up -d postgres && docker compose run --rm migrate`); they connect via `DATABASE_URL` (and `MIGRATOR_PASSWORD` for 7c setup) which the operator sets in the local `.env`. If `DATABASE_URL` is missing the tests must SKIP (not fail) with a clear "set DATABASE_URL to run integration tests" message — keeps the CI green when DB isn't available.
  </action>
  <verify>
    <automated>docker compose up -d postgres; docker compose run --rm migrate; pnpm test:unit; pnpm test:integration</automated>
  </verify>
  <done>All unit tests (session-callback + auth-resend-template) + integration tests (tenant-scoped-query 4 cases + layer-5-rls-blocks read probe + layer5-rls-write-probe 2 cases per M-4) pass against a live local Postgres. `playwright.config.ts` baseURL is `http://localhost:3000`. `seed-tenants.ts` SESSION_COOKIE_NAME branches on https. Integration tests SKIP gracefully when `DATABASE_URL` is unset (verify: unset and re-run — test runner reports skip, exit 0). M-4 is closed: cross-tenant INSERT raises an RLS error; same-tenant INSERT succeeds.</done>
</task>

<task type="auto">
  <name>Task 8: Dockerfile + compose service + env wiring + first-run smoke + README</name>
  <files>Dockerfile, docker-compose.yml, .env.example, README.md</files>
  <action>
    Ship the multi-stage Dockerfile, add the `nextjs-app` service to docker-compose.yml mapping `8080:3000` per D-W1-03, finalize `.env.example` for Auth.js v5 conventions, and refresh the README "Status" block + getting-started commands.

    Step 8a — `Dockerfile` at repo root per 03-RESEARCH.md §"Recommended Dockerfile pattern":
    - Multi-stage: `deps` (pnpm install with BuildKit cache mount), `builder` (`pnpm build`), `runner` (standalone tree + non-root user).
    - Base image: `node:22-bookworm-slim` (NOT Alpine — `pg` + `sharp` have glibc-only wheels per 03-RESEARCH.md §"Recommended Dockerfile pattern" notes).
    - Enable corepack for pnpm. Cache pnpm store at `/root/.local/share/pnpm/store`.
    - Final stage copies only `.next/standalone`, `.next/static`, `public/`.
    - Runs as `nextjs:nodejs` (uid 1001 / gid 1001).
    - `EXPOSE 3000`, `CMD ["node", "server.js"]`, `ENV PORT=3000 HOSTNAME=0.0.0.0`.

    Step 8b — `docker-compose.yml` — append a new `nextjs-app` service (preserve the existing `migrate` and `postgres` services unchanged):
    ```
      nextjs-app:
        build:
          context: .
          dockerfile: Dockerfile
        container_name: shifty-nextjs
        depends_on:
          postgres:
            condition: service_healthy
        environment:
          DATABASE_URL: ${DATABASE_URL:?missing}
          AUTH_SECRET: ${AUTH_SECRET:?missing}
          NEXTAUTH_URL: ${NEXTAUTH_URL:?missing}
          AUTH_RESEND_KEY: ${AUTH_RESEND_KEY:?missing}
          AUTH_RESEND_FROM: ${AUTH_RESEND_FROM:?missing}
          NODE_ENV: production
        ports:
          - "8080:3000"
        restart: unless-stopped
    ```
    The `8080:3000` mapping honors D-W1-03 — the existing Cloudflare Tunnel target (`192.168.1.133:8080`) keeps working without any tunnel config change.

    Step 8c — `.env.example` — rewrite the Auth.js + Resend section to Auth.js v5 conventions AND add the M-5 seed-script vars:
    - Keep existing Postgres section (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MIGRATOR_PASSWORD`, `DATABASE_URL`) unchanged.
    - Rename `NEXTAUTH_SECRET` -> `AUTH_SECRET` (regenerate via `openssl rand -hex 32`).
    - Keep `NEXTAUTH_URL` — Auth.js v5 reads it as a legacy alias per 03-RESEARCH.md §Open Questions #3.
    - Rename `RESEND_API_KEY` -> `AUTH_RESEND_KEY`.
    - Rename `RESEND_FROM_EMAIL` -> `AUTH_RESEND_FROM` (Auth.js v5 doesn't auto-detect a from address; we wire it explicitly in `src/lib/auth/config.ts`).
    - Add (M-5):
      ```
      # --- Founding-admin seed (one-time bootstrap) ---
      # The pnpm seed:admin script requires BOTH to be set.
      # SEED_ADMIN_EMAIL: the email of the first user; will receive magic-link login.
      SEED_ADMIN_EMAIL=
      # SEED_ADMIN_TENANT_NAME: the human-readable name for the root tenant.
      # FIRST TIME ONLY — pick a unique name. The seed script is idempotent on this
      # name: re-runs with the SAME name REUSE the existing tenant (this is by
      # design; tenant.name is NOT a unique key). To create a NEW tenant for a NEW
      # admin, supply a DIFFERENT name (e.g. add a date suffix). Leaving this blank
      # makes the seed script exit 2 with a clear error message.
      SEED_ADMIN_TENANT_NAME=
      ```
    - Comment block at top makes the pivot context explicit: "Auth.js v5 convention: AUTH_* envs auto-detected. Provision AUTH_RESEND_KEY from Resend Dashboard -> API Keys."

    Step 8d — `README.md` — rewrite the "Status" block + add a "Getting started (Next.js)" section:
    - Replace the existing pivot note with the post-W1 status: "Phase 03 Wave 1 in execution: Next.js 15 app at repo root with Auth.js v5 + Drizzle + shadcn/ui (Hebrew RTL). Postgres + migrations unchanged on hpg5. See `docs/NEXTJS-CONVENTIONS.md`."
    - Update the "Stack" bullet that says `node:20-alpine` to `node:22-bookworm-slim` (per Dockerfile decision in 03-RESEARCH.md).
    - Add a "Prerequisites" subsection (per check N-6): Node 22+, pnpm 9.15+, Docker Desktop, a Resend account.
    - Add a "Getting started (local dev)" section:
      ```
      ## Getting started (local dev)
      1. `cp .env.example .env` and fill in values. CRITICAL (M-5): set
         `SEED_ADMIN_EMAIL` AND `SEED_ADMIN_TENANT_NAME`. The tenant name is the
         operator contract for the seed script: re-runs with the same name reuse
         the existing tenant (idempotent); a different name creates a fresh tenant.
      2. `docker compose up -d postgres`
      3. `docker compose run --rm migrate`  (applies all 15 migrations)
      4. `pnpm install --frozen-lockfile`
      5. `pnpm drizzle-kit pull`  (regenerates `src/db/schema.ts` from live Postgres)
      6. `pnpm seed:admin`  (seeds the founding admin into users + tenant — idempotent on SEED_ADMIN_TENANT_NAME)
      7. `pnpm dev`  -> open http://localhost:3000
      ```
    - Add a "Verifying the tenant-isolation contract" section that points at the 4 test commands: `pnpm test:check-tenant-isolation`, `pnpm test:check-tenant-isolation-selftest`, `pnpm test:integration` (which includes the M-4 Layer-5 write probe), `pnpm playwright test`.
    - Add a "Deploy to hpg5" section: `git push origin main`, then on hpg5 `git fetch && git reset --hard origin/main && docker compose pull (via PsExec) && docker compose up -d --build nextjs-app`.

    Step 8e — first-run smoke (local) — declared deferred-to-manual per M-3 Option 3:
    - This is a checklist the executor performs and records in the SUMMARY (the Resend SDK HTTP call is the one thing not covered by automated tests — M-3 closes the template-builder coverage; the actual `emails.send` call remains a manual smoke step):
      - `pnpm verify:smoke-login` (the M-2 portable Node script from Task 5) passes.
      - On `/login`, submit `omernesher@gmail.com`; verify `verification_tokens` row appears in Postgres (`SELECT * FROM verification_tokens;`) AND a Resend SDK call was made (visible in Resend onboarding dashboard with `AUTH_RESEND_FROM=onboarding@resend.dev`, or via SDK debug log).
      - Click the magic link from the Resend dashboard (or copy the URL from Postgres + reconstruct it locally via the Auth.js callback URL format).
      - Land on `/shifts` showing the empty-state Card "אין עדיין תבניות משמרת.".
      - `docker compose build nextjs-app` succeeds (locally; on hpg5 wrap in PsExec for the first base-image pull).

    Do NOT push to hpg5 in W1 — that's a manual operator step after W1 closes. The plan ships a buildable container; deployment to hpg5 is intentionally out of scope per the user's "Don't commit. Don't run installs." instruction at planning time.
  </action>
  <verify>
    <automated>docker compose config; docker build -t shifty-nextjs-w1 .</automated>
  </verify>
  <done>`docker compose config` validates (the M-2 portable verify — no bash backgrounding needed) and shows the `nextjs-app` service with port mapping `8080:3000`. `docker build` succeeds; final image is ~250-300MB. `.env.example` uses `AUTH_SECRET`, `AUTH_RESEND_KEY`, `AUTH_RESEND_FROM`, and has the M-5 `SEED_ADMIN_EMAIL` + `SEED_ADMIN_TENANT_NAME` block with the footgun comment. README "Status" block reflects post-W1 reality + has Prerequisites + 7-step local-dev recipe (with M-5 callout) + the tenant-isolation verification commands.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser -> Next.js (middleware/edge) | Untrusted form input + cookies cross here. Magic-link request POST is the primary attack surface in W1. |
| Next.js (Node runtime) -> Postgres | App connection lands as `shifts` -> auto-assumes `shifty_app` (NOSUPERUSER, NOBYPASSRLS). Every domain-table read/write MUST go through `withTenantTx`. |
| Next.js -> Resend API | Outbound HTTPS. API key in env only. Magic-link content includes URL-bearing the verification token. |
| `migrate` container -> Postgres | Connects as `migrator` (SUPERUSER) — bypasses RLS by design. Only runs one-shot at deploy/test time. |
| Founding-admin seed script -> Postgres | Connects as `migrator` deliberately (must bypass RLS to seed pre-tenant rows). Operator-only invocation. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03W1-01 | Spoofing | Magic-link login (/login) | mitigate | Auth.js v5 Resend provider: tokens are 256-bit randomBytes hashed sha256(token+AUTH_SECRET) and single-use (verifyToken deletes the row); single-shot per Pitfall 6 in 03-RESEARCH.md |
| T-03W1-02 | Spoofing | Session cookie | mitigate | Database session strategy + HttpOnly + SameSite=Lax + `__Secure-` prefix when NEXTAUTH_URL is https; database revocation works |
| T-03W1-03 | Tampering | Tenant-id smuggled via request body/header | mitigate | Layer-1 (session.shiftyTenantId only); Layer-2 CI gate (Task 6) fails build if any handler reads tenant_id from request input; Layer-5 RLS returns zero rows even if L1+L2 bypassed |
| T-03W1-04 | Tampering | Cross-tenant data read via direct db.select bypass | mitigate | Layer-2 ts-morph gate (`tools/check-tenant-isolation.mjs`) walks every CallExpression under `src/**` and `app/**`; exits 1 on any `db.{select,insert,update,delete}` outside `src/lib/tenant/` (DB_IDENTIFIERS = `{ 'db' }` only per B-2). Self-test fixtures in Task 6 prove the gate FAILS on the bad case (db reach-around) AND DOES NOT FALSE-POSITIVE on the sanctioned `tenantScopedQuery((tx) => ...)` callback (B-2 positive fixture). |
| T-03W1-05 | Tampering | SQL injection via `sql.raw` interpolation in withTenantTx | mitigate | tenantId is regex-validated `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` one statement above the `sql.raw` use; non-UUID input throws BEFORE reaching the raw interpolation. Only known-format strings reach `sql.raw`. |
| T-03W1-06 | Repudiation | Sign-in event lacks audit trail | accept (W1) | Auth.js writes verification_tokens + sessions rows; full audit-log integration with `schedule_audit` is a Phase 06 dispatcher concern. W1 captures DB-level rows; AUTH-07 (audit logs for auth events) is out of W1 scope. |
| T-03W1-07 | Information disclosure | DATABASE_URL leak in stack trace | mitigate | Next.js does NOT log full env on errors; the `pg` driver does not include connection strings in error messages by default. log-redact middleware port deferred to Phase 06 (per 03-RESEARCH.md §Security Domain V7). Mitigation: `AUTH_SECRET` and `AUTH_RESEND_KEY` referenced ONLY via `process.env.*` (no literal in code); ESLint default rules flag accidental hard-codes. |
| T-03W1-08 | Information disclosure | Resend API key in client bundle | mitigate | All Resend usage happens in `src/lib/auth/resend-email.ts` (server-only); not prefixed `NEXT_PUBLIC_*`; Next.js does not bundle non-public env vars into the client. Verified at build time by inspecting `.next/static/` for the key (smoke check). |
| T-03W1-09 | Denial of service | Resend rate limit (2 req/s free tier) | accept (W1) | W1 only sends single magic-link emails per login attempt — well within free tier. Bulk-invite rate-limiting is W2/W3 concern (legacy `bulkDispatchWithBackoff` pattern preserved at `legacy/shifty-handlers/dispatch/resend.js` for porting then). |
| T-03W1-10 | Elevation of privilege | Magic-link token reuse | mitigate | Auth.js `useVerificationToken` deletes the row on first use; replay attempts hit a missing-token error path. |
| T-03W1-11 | Elevation of privilege | Open redirect after magic-link callback | mitigate | Auth.js validates `callbackUrl` against `pages.signIn` configured paths; no user-controlled redirect URL accepted unless on the allowlist. We do not pass arbitrary `callbackUrl` query params. |
| T-03W1-12 | Elevation of privilege | Session.user.shiftyTenantId tampered client-side | mitigate | Database session strategy: session is re-hydrated server-side from the DB on every request via the session callback. Client mutations to the session object never reach the server. |
| T-03W1-13 | Tampering | shifty_app role gains SUPERUSER and bypasses RLS | mitigate | Migration 0013 created shifty_app with explicit `NOSUPERUSER NOBYPASSRLS`. The Postgres role's `NOBYPASSRLS` flag stays in force even if a future operator accidentally GRANTs SUPERUSER. Defense-in-depth via migration 0013 lines 12-13. |
| T-03W1-14 | Tampering | Cross-tenant write via tenant_id smuggle in INSERT body | mitigate | Layer-5 RLS WITH CHECK clause (migration 0009 line 102): even if app code constructed an INSERT with a foreign tenant_id, Postgres raises code 42501 / "new row violates row-level security policy" because the WITH CHECK predicate `tenant_id = current_setting('app.current_tenant')::uuid` fails. Verified by `tests/integration/layer5-rls-write-probe.spec.ts` (M-4). |
| T-03W1-SC | Tampering | npm package installs | mitigate | slopcheck 0.6.1 ran 2026-05-18 against all 23 candidate packages — 0 SUS / 0 SLOP / 23 OK (per 03-RESEARCH.md §Package Legitimacy Audit). No new packages introduced in W1 beyond the audited set. Future package additions in W2+ require a fresh slopcheck pass per CLAUDE.md convention. |
</threat_model>

<verification>
Overall phase-W1 checks (executed after Task 8 closes):

1. **Migration & schema** — `docker compose run --rm migrate` applies all 15 migrations idempotently; the psql information_schema query in Task 1 returns the `shifty_tenant_id` column. Founding admin's `users.shifty_tenant_id` populated by `pnpm seed:admin` and confirmed by the seed script's self-verifying SELECT-IS-NOT-NULL assertion (B-1).

2. **Three-layer tenant isolation green:**
   - Layer 1: After magic-link login, `session.user.shiftyTenantId` is populated (verified by `tests/unit/session-callback.spec.ts`).
   - Layer 2: `pnpm test:check-tenant-isolation` exits 0 against the codebase; `--self-test` proves the gate fails on the bad fixture AND does NOT false-positive on the sanctioned-tx-callback fixture (B-2).
   - Layer 5 read: `tests/integration/layer-5-rls-blocks.spec.ts` proves an out-of-transaction `SELECT * FROM soldier` as the `shifts` role returns zero rows.
   - Layer 5 write (M-4): `tests/integration/layer5-rls-write-probe.spec.ts` proves a cross-tenant INSERT raises code 42501 / "new row violates row-level security policy"; same-tenant INSERT succeeds.

3. **First authed route works end-to-end:** `pnpm verify:smoke-login` (M-2 portable Node script) confirms `pnpm dev` boots and the unauth-redirect + Hebrew-RTL form render correctly. The Resend SDK side-effect remains a manual 8e smoke step (M-3 Option 3 — template builder is unit-tested, HTTP call is integration-level deferred).

4. **Build & ship readiness:** `pnpm build` produces `.next/standalone/`. `docker build` produces the runner image. `docker compose config` validates and shows `nextjs-app: 8080:3000`. (Actual hpg5 deploy is operator-driven post-W1.)

5. **Hebrew RTL default:** All rendered pages (`/`, `/login`, `/login/verify`, `/login/error`, `/(authed)/`, `/(authed)/shifts`) have `<html dir="rtl" lang="he">`; the Hebrew RTL email template is unit-tested via `tests/unit/auth-resend-template.spec.ts` (M-3); manual smoke shows no LTR-mirroring bugs in W1's small surface.

6. **CI scripts wired:** `pnpm test:unit && pnpm test:check-tenant-isolation && pnpm test:check-tenant-isolation-selftest && pnpm test:check-tenant-isolation-unit && pnpm test:integration` all green when `DATABASE_URL` is set.

7. **Shell portability (M-2):** Every `<verify>` block runs identically in PowerShell and Bash. No bash idioms (`&` backgrounding, `kill %1`, `[ -f file ]`, `grep -q` against stdin). Dev-server smoke is `pnpm verify:smoke-login` (Node script); string assertions inside verifies are `node -e "..."` invocations.
</verification>

<success_criteria>
W1 is complete when ALL of the following are TRUE:

1. **Migration 0015** applied; `users.shifty_tenant_id` column exists and is populated for the founding admin via `pnpm seed:admin` (B-1: self-verifying assertion confirms NOT NULL).
2. **Founding-admin seed (B-1 + M-5)** runs idempotently with `SEED_ADMIN_EMAIL` + `SEED_ADMIN_TENANT_NAME` both set; exits 2 if either is missing; uses the corrected schema-aware UPSERT pattern (SELECT-then-INSERT for tenant including `org_depth = 1`; `ON CONFLICT (email)` for users; `ON CONFLICT (tenant_id, email)` for app_user).
3. **`pnpm verify:smoke-login` (M-2 portable Node script)** confirms the dev server boots, unauth `/shifts` redirects, and `/login` renders Hebrew RTL — no bash-isms required.
4. **Magic-link login flow** works locally — submitting an email at `/login` triggers a Resend API call and writes a `verification_tokens` row; the Hebrew RTL email template is unit-tested via `tests/unit/auth-resend-template.spec.ts` (M-3); clicking the link (real or via test fixture) creates a `sessions` row and `session.user.shiftyTenantId` is populated.
5. **`/shifts`** renders an empty-state shadcn Card after authed access; the data path is `auth() -> session -> tenantScopedQuery(session, ...) -> withTenantTx -> SET LOCAL app.current_tenant -> Drizzle SELECT -> RLS-scoped read`.
6. **`pnpm test:check-tenant-isolation`** exits 0 against the W1 codebase; **`--self-test`** exits 1 on the bad fixture (db reach-around) AND exits 0 on the sanctioned-tx-callback fixture (B-2); **`pnpm test:check-tenant-isolation-unit`** asserts all three cases.
7. **Layer-5 write probe (M-4)** is automated: `tests/integration/layer5-rls-write-probe.spec.ts` proves the WITH CHECK clause blocks cross-tenant INSERTs with Postgres error code 42501.
8. **`pnpm build`** produces `.next/standalone/`; **`docker build -t shifty-nextjs-w1 .`** succeeds locally (pre-hpg5 deploy).
9. **Integration tests green:** `pnpm test:unit` (includes auth-resend-template + session-callback), `pnpm test:integration` (includes tenant-scoped-query + layer-5-rls-blocks read + layer5-rls-write-probe), and the existing `tests/e2e/cross-tenant-leak.spec.ts` (with cookie-name + baseURL updates) all pass against a live local Postgres with the 15 migrations applied.
10. **Hebrew RTL is the default** across all W1 routes (`<html dir="rtl" lang="he">` in root layout); the magic-link email template builder is RTL-correct (M-3 unit test); English fallback not in W1 scope (deferred to Phase 07).
11. **`.env.example`** uses Auth.js v5 conventions (`AUTH_SECRET`, `AUTH_RESEND_KEY`, `AUTH_RESEND_FROM`) AND includes the M-5 founding-admin block (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_TENANT_NAME`) with the collision footgun comment.
12. **README** "Status" reflects post-W1 reality + has the Prerequisites subsection + 7-step local-dev recipe (with the M-5 callout on step 1).
13. **Three-layer contract** active and verified end-to-end: Layer 1 (session.shiftyTenantId) + Layer 2 (`tenantScopedQuery` + CI gate with DB_IDENTIFIERS = `{ 'db' }` per B-2) + Layer 5 (Postgres RLS via `withTenantTx`, both USING and WITH CHECK clauses tested per M-4). This is strictly stronger than the pre-pivot posture (Layer 5 was INACTIVE under Budibase superuser; now ACTIVE under `shifty_app` for both reads and writes).
14. **Zero Cloudflare/firewall change required** per D-W1-03: compose maps `8080:3000`, existing tunnel works unchanged.
15. **Critical path preserved:** 1 → 2 → 3 → 4 → 5 → (6 ∥ 7) → 8. Tasks 6 and 7 can run in parallel after 5 (no shared files between them); Task 8 depends on 5 (verify script) + 7 (test artifacts referenced in README).
</success_criteria>

<output>
Create `.planning/phases/03-availability-rules/03-W1-SUMMARY.md` when done.

The SUMMARY MUST capture:
- All 8 tasks' actual outputs (files created, commands run, anomalies encountered)
- Founding admin's seeded tenant UUID + users.id (operator records this) AND the exact `SEED_ADMIN_TENANT_NAME` used (M-5: this becomes the operator contract for re-seeds)
- The exact `AUTH_RESEND_FROM` value used for dev (`onboarding@resend.dev` is the expected sandbox)
- Whether the first-run smoke (Task 8 §step 8e) was performed and the result — including the manual Resend dashboard observation (M-3 Option 3 deferred-to-manual closure)
- Confirmation that the M-4 Layer-5 write-probe test ran and asserted Postgres error code 42501
- Confirmation that the B-2 sanctioned-tx-callback fixture asserts zero violations in the self-test
- Any deviations from this plan with rationale
- Open follow-ups for W2 (e.g., invite-code redemption flow that populates `users.shifty_tenant_id` for new users; ESLint rule for ml-/mr- → ms-/me- per 03-RESEARCH.md §Pitfalls #7)
</output>
