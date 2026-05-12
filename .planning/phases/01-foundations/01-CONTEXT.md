# Phase 1: Foundations - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Mode:** --auto (recommended option selected for every gray area)

<domain>
## Phase Boundary

**What this phase delivers:** A booting Lowdefy SSR app with a 5-layer tenant-isolation defense end-to-end. A new user can sign up via magic link, redeem an invite code, and land on an empty dashboard scoped to their tenant. Every cross-tenant probe returns 403 at the page layer, the query layer, the request handler layer, and the database layer (Postgres RLS). The full migration set 0001–0010 applies via the `migrate/migrate` compose service. The `shifty-audit-writer` custom Lowdefy request plugin scaffold works end-to-end, unlocking the plugin pattern that downstream phases will reuse for the notification dispatcher, webhook receivers, and signed-URL export endpoints. Operational baseline (nightly `pg_dump` + off-host copy + self-test + `docs/OPERATIONS.md` runbook stub + log-redaction middleware) is in place.

**Explicit out-of-scope for this phase** (these belong in later phases):
- Org tree CRUD beyond what's needed to demonstrate tenant scoping (Phase 2)
- Soldier roster CRUD (Phase 2)
- Shift slots, planning windows, availability, rules (Phase 3)
- Solver, draft schedules, publish lifecycle (Phase 4)
- Swaps, manager overrides, time clock (Phase 5)
- Notification dispatcher implementation (Phase 6) — plugin scaffold only in Phase 1
- Webhook receivers (Phase 6 — only the plugin pattern in Phase 1)
- Exports (Phase 7)

</domain>

<decisions>
## Implementation Decisions

### Smoke Test Before Fix Budget (Pitfall P1 mitigation)

- **D-01: Smoke test the existing Lowdefy runtime FIRST.** `app/Dockerfile` (HEAD) already contains the fix for the `ERR_MODULE_NOT_FOUND` blocker — it preserves `/build/.lowdefy/server` so the relative `../../../../..` symlinks in `.next/node_modules/@lowdefy/helpers-<hash>` resolve. The fix was committed at or before `b8afba1`. Phase 1's first task is to PROVE it works on hpg5: build the image via PsExec, deploy, `curl http://hpg5:8080/employees`, expect HTTP 200 with employees-table rows, expect zero `ERR_MODULE_NOT_FOUND` lines across 10 page loads in the container logs. If PASS → declare runtime stable, proceed. If FAIL → activate the 5-day escape-hatch timebox documented in SUMMARY.md (switch to npm; in extremis, re-open Lowdefy lock).
  - **Logged choice (auto):** Build + deploy via existing PsExec path, smoke-test with `curl` + 10 page loads + log grep. (recommended)

### NextAuth + Auth.js Integration Shape

- **D-02: NextAuth EmailProvider lives inside Lowdefy as a custom plugin** at `app/plugins/shifty-auth/`. Magic-link emails delivered via Resend (preferring HTTP API over SMTP; build a thin custom EmailProvider on top of `resend` SDK if NextAuth's built-in SMTP integration with Resend SMTP is flaky). KnexAdapter for session storage uses the same `shifts_db` connection. Invite-code redemption flow runs immediately after callback succeeds — separate page that consumes the 8-char Crockford base32 code and writes the `membership` + `invite_code_redemption` rows.
  - **Logged choice (auto):** Custom Lowdefy plugin housing NextAuth + EmailProvider + KnexAdapter + invite-code redemption. (recommended)

### Session Shape for Tenant Hydration

- **D-03: Session callback hydrates `tenant_id`, `roles[]`, `team_ids[]`, `locale` once at sign-in.** Loaded from `app_user` + `membership` rows via a single query keyed on the verified email. Same shape used by every server-side layer: page `auth` blocks check `roles`, request `properties.auth` re-checks `roles` AND `team_ids`, the Knex `afterCreate` hook (D-07 below) sets `app.current_tenant = session.tenant_id` per connection checkout. Session refresh on profile-locale change so language switches mid-session work.
  - **Logged choice (auto):** Full session shape `{user_id, tenant_id, roles[], team_ids[], locale}`. (recommended)

### Migration Runner

- **D-04: `migrate/migrate` (golang-migrate) as a one-shot compose service** named `migrate`. New service in `docker-compose.yml`; mounts `./db/migrations:/migrations:ro`; uses `DATABASE_URL=postgres://shifts:****@postgres:5432/shifts?sslmode=disable`. Runs `up` on `docker compose run --rm migrate up`. Re-runs are idempotent (uses `schema_migrations` table). Bootstrap `0001_init.sql` stays valid as the first migration; `0002`-`0010` extend it. Manual `psql` (per current CLAUDE.md "Common ops") deprecated for routine migration work but remains valid for ad-hoc queries.
  - **Logged choice (auto):** golang-migrate compose service per SUMMARY.md Decision #7. (recommended)

### Migration Sequence and Bootstrap Compatibility

- **D-05: Migration order for Phase 1**: `0001_init.sql` (existing — kept as-is); `0002_tenancy_and_org.sql` (tenant + org_unit + app_user + soldier + membership) — also ADDS the NextAuth KnexAdapter schema (`accounts`, `sessions`, `verification_tokens`, `users` aliased to `app_user` or as a separate table per Auth.js convention — pick at planning time); `0003_shifts_and_windows.sql`, `0004_availability_rules_swaps.sql`, `0005_auth_and_notifications.sql`, `0006_audit_and_solver_runs.sql`, `0007_imports_and_exports.sql`, `0008_assignment_state_and_legacy_drop.sql` (drops `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries` from 0001 — but **deferred to Phase 2 boundary**, NOT applied in Phase 1), `0009_rls_policies.sql`, `0010_audit_revokes.sql`.
- **D-06: Drop legacy `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries` only at Phase 2 boundary**, not in Phase 1. Reason: the bootstrap `app/lowdefy.yaml` `/employees` page is the smoke-test surface (D-01) — it must keep working through Phase 1's runtime verification. Migration `0008` is applied during Phase 2 once `soldier` CRUD writes are live.
  - **Logged choice (auto):** Migrations 0002-0007 + 0009-0010 applied in Phase 1; 0008 deferred to Phase 2. (recommended)

### 5th Defense Layer — Postgres RLS

- **D-07: Ship RLS in Phase 1 as the 5th defense layer.** Migration `0009_rls_policies.sql` enables RLS on every tenant-scoped domain table (`tenant`, `org_unit`, `app_user`, `soldier`, `membership`, `shift_slot`, `planning_window`, `shift_instance`, `assignment`, `availability`, `rule`, `rule_override`, `swap_request`, `invite_code`, `invite_code_redemption`, `notification_pref`, `notification_log`, `push_subscription`, `report_recipient`, `schedule_audit`, `solver_run`, `roster_import_log`, `ical_subscription_token`, `time_clock_entries`). Policy: `USING (tenant_id = current_setting('app.current_tenant')::uuid)`. `app.current_tenant` set per-connection-checkout via a Knex `afterCreate` hook inside the `connection-knex` configuration. Bypass available only via a separate superuser role used by the `migrate` service.
  - **Logged choice (auto):** Ship RLS day 1 per SUMMARY.md Critical Decision #1. (recommended)

### Custom Lowdefy Plugin Pattern — `shifty-audit-writer` First

- **D-08: Scaffold one custom Lowdefy request plugin in Phase 1: `app/plugins/shifty-audit-writer/`.** Minimum viable plugin: a request plugin that wraps a Knex INSERT into `schedule_audit` with a typed payload (from_state, to_state, actor_user_id, actor_kind, payload_json) and enforces server-side that `actor_user_id` comes from the session, never from request input. Demonstrated by adding it to a single mutating page (e.g., a "test mutation" page hidden behind `unit_admin` role). Proves the plugin pattern that downstream phases reuse for the notification dispatcher (Phase 6), webhook receivers (Phase 6), and signed-URL endpoints for iCal/CSV/PDF (Phase 7). Plugin published from `app/plugins/shifty-audit-writer/` via Lowdefy's local plugin mechanism (file-system reference in `lowdefy.yaml` plugins list).
  - **Logged choice (auto):** Audit-writer first; other plugins deferred to their consuming phases. (recommended)

### Operational Baseline (`docs/OPERATIONS.md` Stub)

- **D-09: Minimal Phase-1 runbook stub at `docs/OPERATIONS.md`.** Covers: (a) backup self-test verification (nightly `pg_restore --list` on the latest dump; alert on non-zero exit), (b) Windows Update active hours configured to avoid the 06:50–08:30 Israel window (defends daily-report cron from auto-reboot collisions), (c) AV exclusions for `C:\shifts-manager\` directory, (d) VHDX quarterly compaction note (forward-declared; first compaction calendared for Q3 2026), (e) Tailscale-bound WAHA UI port (forward-declared for Phase 6), (f) dedicated WAHA SIM (forward-declared for Phase 6), (g) Cloudflared user-account separation (already in place). Runbook grows phase-by-phase as new ops responsibilities land.
  - **Logged choice (auto):** Minimal stub now; grow with each phase. (recommended)

### Tenant-Isolation Verification — CI Gate + Pen-Test

- **D-10: Two verification mechanisms ship in Phase 1.**
  - (a) `tools/check-queries.mjs` — Node script run in CI that scans every `app/**/*.yaml` for `KnexRaw`/`Knex` request blocks and FAILS the build if any query string is missing a `tenant_id` filter (heuristic: SELECT/UPDATE/DELETE/INSERT statements without a `WHERE tenant_id = ` or `INSERT ... tenant_id ...` clause). Allowlist comments (`-- @gsd-allow-untenanted: reason`) for exceptional cases (e.g., public auth endpoints).
  - (b) Playwright fixture `tests/e2e/cross-tenant-leak.spec.ts` that seeds two tenants, signs in as tenant-A user, hits every list/detail/mutation route with tenant-B IDs, asserts 403 for every one. Runs in CI pre-release.
  - Both gates in place BEFORE Phase 2 starts.
  - **Logged choice (auto):** Both CI grep + Playwright pen-test; allowlist comment mechanism for exceptions. (recommended)

### Lowdefy App Build Distribution

- **D-11: Keep "build on hpg5" as the current default.** Continues CLAUDE.md "Common ops" pattern. Reason: CI doesn't exist yet, GHCR push adds friction without payoff at this stage. Phase 1 explicitly NOT setting up GitHub Actions. Revisit when CI exists for any reason (running `tools/check-queries.mjs`, Playwright suite, etc.) — at that point, push from CI becomes free.
  - **Logged choice (auto):** Build on hpg5 via existing PsExec path; defer CI to a later phase. (recommended)

### Repo Cleanup (`archive/appsmith-export/`)

- **D-12: Leave `archive/appsmith-export/` untouched in Phase 1.** CLAUDE.md preserves it intentionally for reference. Not a Phase 1 concern.
  - **Logged choice (auto):** No change. (recommended)

### Claude's Discretion

- Plugin file structure inside `app/plugins/shifty-audit-writer/` — adopt the canonical Lowdefy custom-plugin shape (plugin.js + types.js + tests/ + package.json) verified at planning time against the in-repo `.claude/skills/lowdefy/reference/09-plugins.md` skill.
- Exact set of routes the Playwright pen-test fixture covers — auto-derived from `app/pages/**` at test-write time so future page additions are picked up.
- Whether the NextAuth KnexAdapter schema lives in migration `0002` (recommended) or its own `0002a_nextauth.sql` — planning-time call, single-file is cleaner if no other PRs depend on staging the migrations separately.
- Backup self-test alert delivery channel for Phase 1 — likely email-to-omernesher@gmail.com via Resend (after D-02 is wired), or simply Windows Event Log entry the user checks manually.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & roadmap
- `docs/PRD.md` — Authoritative product spec; 1687 lines. For Phase 1, focus on §1 (Stack), §4 (Personas), §7.1 (Tenant & org), §7.2 (Auth & invite codes), §8.2 (Security), §8.3 (RBAC matrix — the 4-role permission cells), §8.4 (Test strategy), §8.8 (Backup & recovery), §10 (Data model — migrations 0002-0007), §15 (Risks R4 tenant isolation, R6/R7 hpg5 ops, R10 lock reminder).
- `.planning/PROJECT.md` — Active requirements, Constraints, Key Decisions (Lowdefy lock, UUID PKs everywhere, single source of truth = PRD).
- `.planning/REQUIREMENTS.md` §Tenant, §Authentication, §Security, §Operations, §i18n (I18N-07 only), §Performance (PERF-04 only) — Phase 1's 34 mapped REQ-IDs.
- `.planning/ROADMAP.md` §Phase 1 — Phase goal, success criteria, dependencies, requirements list, sequencing notes.

### Research outputs (Phase 1 implications)
- `.planning/research/SUMMARY.md` — §Implications for Roadmap → Phase 1; §Critical Decisions Surfaced During Research (entries #1, #2, #7, #8, #9 directly affect Phase 1); §Critical Pitfalls #1, #2, #6.
- `.planning/research/STACK.md` — Lowdefy 5.3.0 + Postgres 16 + pnpm 9.15.5 pinning; KnexAdapter for NextAuth; Resend email integration; Hebrew Postgres collation (`COLLATE "he-x-icu"`); custom-plugin authoring shape.
- `.planning/research/ARCHITECTURE.md` — §Pattern 1 (Tenant isolation — 5-layer defense including new RLS); §Pattern 5 (Audit log append-only via Postgres triggers + REVOKEs); §Pattern 6 (Migration runner — golang-migrate).
- `.planning/research/PITFALLS.md` — Pitfall 1 (Lowdefy runtime), Pitfall 2 (Tenant isolation), Pitfall 6 (hpg5 ops backbone).

### Deployment & ops
- `CLAUDE.md` — hpg5 deployment realities, PsExec wrapping for `docker compose build`, auto-login + autostart, Cloudflare Tunnel, the Lowdefy runtime open question (treat as resolved at `b8afba1` pending smoke test).
- `docker-compose.yml` — Existing 2-service compose; Phase 1 adds `migrate` service.
- `app/Dockerfile` — Multi-stage Lowdefy build with the symlink-preservation fix (read the file header comment for the rationale).

### Lowdefy in-repo skill
- `.claude/skills/lowdefy/SKILL.md` — Router. Phase 1 needs:
  - `.claude/skills/lowdefy/reference/08-auth.md` — NextAuth EmailProvider + KnexAdapter integration pattern.
  - `.claude/skills/lowdefy/reference/09-plugins.md` — Custom plugin authoring shape for `shifty-audit-writer`.
  - `.claude/skills/lowdefy/reference/10-deployment.md` — Dockerfile rationale, deployment patterns.
  - `.claude/skills/lowdefy/reference/06-operators.md` — `_user`, `_payload`, server-vs-client evaluation rules (critical for D-03 session shape and D-07 RLS hook).

### Bootstrap state (existing code)
- `db/migrations/0001_init.sql` — Bootstrap schema; `employees`/`shifts`/`assignments`/`availability`/`time_clock_entries`. Stays in place through Phase 1.
- `app/lowdefy.yaml` — Bootstrap home + employees page. Phase 1 keeps these as the smoke-test surface (D-01, D-06).
- `app/package.json` — Lowdefy 5.3.0 + connection-knex 5.3.0 + blocks-aggrid 5.3.0 pins.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`app/Dockerfile`** — Multi-stage build with the symlink-preservation fix (lines 1-15 contain a 10-line comment explaining the `/build/.lowdefy/server` path preservation). This file is the answer to Phase 1's biggest risk; do not modify it without understanding why the path layout matters. pnpm 9.15.5 pin in lines 18-21 is intentional (pnpm 11 refuses build scripts for `@sentry/cli`/`sharp`).
- **`app/lowdefy.yaml`** — Bootstrap home page + employees list page using `@lowdefy/blocks-aggrid` AgGridAlpine block; Knex connection `shifts_db` using `_secret: POSTGRES_CONNECTION_STRING`. Phase 1 keeps this working (smoke-test surface), then Phase 2 supersedes both pages with tenant-aware versions.
- **`app/package.json`** — `@lowdefy/connection-knex` already in deps. Phase 1 adds Auth.js + Resend SDK; planning will spec exact versions.
- **`docker-compose.yml`** — `lowdefy` + `postgres` services with health checks; `lowdefy.depends_on.postgres.condition=service_healthy`. Phase 1 adds `migrate` (one-shot) and prepares the slot for `solver`/`cron`/`waha` (added in later phases).
- **`db/migrations/0001_init.sql`** — `pgcrypto` extension already enabled (gives `gen_random_uuid()`). Phase 1 migrations follow this pattern.

### Established Patterns

- **Single-tenant initial schema** — `0001_init.sql` has no `tenant_id` columns; migration `0002` introduces tenancy by adding the parent tables (`tenant`, `org_unit`, `app_user`, `soldier`, `membership`). Existing tables get superseded in migration `0008` at the Phase 2 boundary; bootstrap data isn't migrated (no production data).
- **Knex `_secret: VAR_NAME`** — Connection strings sourced from env, not literal YAML. Pattern continues in Phase 1 for `RESEND_API_KEY`, `NEXTAUTH_SECRET`, etc.
- **Lowdefy `KnexRaw` request blocks** — Bootstrap uses parameterized SQL. Phase 1 establishes the convention that every domain query MUST include `WHERE tenant_id = ...` — enforced by D-10(a) CI grep gate.
- **Docker health checks** — Lowdefy container has a `node -e` HTTP probe; Postgres has `pg_isready`. Phase 1 adds health checks for the new `migrate` service (success on completion, not liveness).

### Integration Points

- **NextAuth + Lowdefy** — No existing integration; Phase 1 adds `app/plugins/shifty-auth/` plugin that registers the NextAuth handler routes (`/api/auth/*`) and exposes the session to Lowdefy operators via `_user`.
- **Knex `afterCreate` hook** — `connection-knex` exposes the hook; Phase 1 wires it to `SET app.current_tenant = ?` using the session's `tenant_id`. This is the Layer-5 (RLS) wiring.
- **Cloudflare Tunnel** — Already routing `apps.nesher.co` → hpg5:8080. No Phase 1 change required; the tunnel agent runs in a separate Windows user account out of scope for SSH.
- **PsExec wrapping** — Required for `docker compose build` (anything that pulls/builds images, due to Docker Desktop credential helper needing an interactive session). Phase 1 build invocations must wrap with PsExec per CLAUDE.md "Common ops".

</code_context>

<specifics>
## Specific Ideas

- **The Lowdefy runtime fix is already in the repo** (file header comment on `app/Dockerfile`). Phase 1 verifies it, doesn't reinvent it. If smoke test fails, the 5-day timebox escape hatch from SUMMARY.md activates — switch to npm, or re-open the Lowdefy lock.
- **The smart-quote bug fixture (`tools/fixtures/kibbutz.sql`) gets seeded in Phase 1** so Phase 4 solver tests have it available; the fixture intentionally includes one soldier with U+2019 in the display name (per PRD §8.4 "kibbutz fixture" semantics).
- **Hebrew collation (`COLLATE "he-x-icu"`)** declared on every Hebrew-text column in migrations 0002-0007 from day 1 — easier than retrofitting later. Default codepoint collation is wrong for Hebrew names (Pitfall P5).
- **The `shifty-audit-writer` plugin is the canary** — if Lowdefy's plugin system can host a Knex-writing request handler, it can host the dispatcher (Phase 6), webhook receivers (Phase 6), and signed-URL endpoints (Phase 7). Validating the plugin shape in Phase 1 de-risks all three downstream phases.

</specifics>

<deferred>
## Deferred Ideas

- **GitHub Actions CI setup** — Deferred until a Phase needs it. First trigger: when `tools/check-queries.mjs` and the Playwright pen-test should run pre-merge. Probably Phase 2 or Phase 3.
- **`docker-compose.solver.yml` / `docker-compose.waha.yml` split** — Considered for keeping the main compose file clean as services accumulate. Defer; revisit if `docker-compose.yml` exceeds ~150 lines (currently <100).
- **`docs/PRIOR_ART_BUGS.md`** — SUMMARY.md gap-list calls for capturing the specific "today view" bug from the prior-art sheet (Pitfall P10 mitigation). That's a Phase D (Dashboard, Phase 7) prerequisite — ask the user during Phase 7 planning kick-off, not now.
- **`docs/OPERATIONS.md` full coverage** — Phase 1 ships a minimal stub (D-09); fleshed out phase-by-phase as new ops responsibilities land.
- **Tenant #1 migration script (`tools/migrate-from-sheet/`)** — Phase M parallel track. Can start any time after Phase 2's `soldier` table lands.

</deferred>

---

*Phase: 1-Foundations*
*Context gathered: 2026-05-12*
