# Phase 1: Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 1-foundations
**Mode:** --auto (no interactive prompts; recommended option selected for every area; logged inline)
**Areas discussed:** Smoke-test method, NextAuth integration shape, Session shape, Migration runner, Migration sequence + legacy drop timing, Postgres RLS, Custom plugin scaffold, OPERATIONS.md scope, Tenant-isolation verification, Build distribution, Repo cleanup

---

## Smoke-test method

| Option | Description | Selected |
|--------|-------------|----------|
| Build + deploy via existing PsExec path on hpg5; `curl http://hpg5:8080/employees`; verify HTTP 200 + zero `ERR_MODULE_NOT_FOUND` across 10 page loads in container logs | Matches Phase 1 success criterion #4. Uses the already-fixed Dockerfile. (recommended) | ✓ |
| Build locally first for faster feedback, then deploy | Cuts a hpg5 round-trip but obscures any deploy-target differences | |
| Skip smoke test; assume the runtime works | Highest risk; defeats Pitfall P1 mitigation | |

**Selection rationale (auto):** The `ERR_MODULE_NOT_FOUND` fix is documented in `app/Dockerfile` header comment and committed at/before `b8afba1`. The Phase-1 risk is that the fix is broken on the deploy target, not that it's broken in principle — smoke-test on hpg5 is the right validation surface.

---

## NextAuth + Auth.js integration shape

| Option | Description | Selected |
|--------|-------------|----------|
| NextAuth EmailProvider as a custom Lowdefy plugin in `app/plugins/shifty-auth/`; KnexAdapter for sessions; magic links via Resend | Cleanest fit with the Lowdefy plugin pattern (D-08) that downstream phases will reuse anyway. (recommended) | ✓ |
| Hand-rolled Auth.js outside Lowdefy; Lowdefy reverse-proxied behind it | Splits the deployment surface; loses single-binary simplicity | |
| Defer auth to Phase 2 | Violates Phase 1 success criterion #1 (new user signs up via magic link) | |

---

## Session shape for tenant hydration

| Option | Description | Selected |
|--------|-------------|----------|
| Full hydration at sign-in: `{user_id, tenant_id, roles[], team_ids[], locale}` from `app_user` + `membership` rows | Required by PRD §8.3 4-layer defense. Single query at sign-in; refresh on locale change. (recommended) | ✓ |
| Carry `user_id` only; resolve tenant/roles per request from DB | Adds a query to every request — kills the <500ms p95 budget | |
| Signed JWT with all claims encoded | Reasonable but adds JWT verification complexity; revisit if NextAuth's database-backed session adds latency | |

---

## Migration runner

| Option | Description | Selected |
|--------|-------------|----------|
| `migrate/migrate` (golang-migrate) as one-shot compose service | Industry-standard for Postgres+Docker; 10MB binary; idempotent; supports up/down/force. (recommended) | ✓ |
| Sqitch (Perl-based) | More features but adds Perl runtime; weaker fit for Docker Compose | |
| Manual `psql` via `docker compose exec` per CLAUDE.md "Common ops" | Works but error-prone at scale; not idempotent | |

---

## Migration sequence + legacy drop timing

| Option | Description | Selected |
|--------|-------------|----------|
| Apply 0002-0007 + 0009-0010 in Phase 1; defer 0008 (drop legacy `employees`/etc.) to Phase 2 boundary | Keeps `app/lowdefy.yaml` `/employees` page live as the smoke-test surface (D-01). (recommended) | ✓ |
| Drop legacy tables in Phase 1 along with 0002-0010 | Cleaner, but removes the smoke-test surface before runtime is validated | |
| Keep legacy tables permanently (dual-write) | Migration debt; not justified — no production data | |

---

## Postgres RLS (5th defense layer)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship RLS in Phase 1 — migration `0009_rls_policies.sql` on every tenant-scoped table; `app.current_tenant` session variable via Knex `afterCreate` hook | SUMMARY.md Critical Decision #1; cheap insurance against the catastrophic "forgot a WHERE tenant_id" bug (PRD R4). (recommended) | ✓ |
| Ship CI grep gate + Playwright pen-test in Phase 1; defer RLS to v1.1 | Same as PRD R4's original posture; loses defense-in-depth | |
| Skip RLS entirely; rely on layers 1-4 only | Violates the "treat tenant isolation as a release-blocking concern" principle from PRD §8.3 | |

---

## Custom plugin scaffold (`shifty-audit-writer` first)

| Option | Description | Selected |
|--------|-------------|----------|
| Scaffold one minimum-viable plugin: `shifty-audit-writer` that wraps Knex INSERT into `schedule_audit`; demonstrated on a single mutating page | Proves the pattern that Phase 6 dispatcher and webhooks, and Phase 7 signed-URL endpoints will reuse. (recommended) | ✓ |
| Skip plugin scaffold; build first plugin in Phase 5/6 when first needed | Pushes structural risk into a phase already crowded with parallel sub-streams | |
| Build all four plugins upfront (audit-writer + dispatcher + webhooks + signed-URL) | Scope creep; pulls Phase 6/7 work into Phase 1 | |

---

## `docs/OPERATIONS.md` scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal stub: backup self-test, Windows Update active hours, AV exclusions, VHDX quarterly note, Tailscale-bound WAHA UI port (forward-declared), dedicated WAHA SIM (forward-declared) | Documents what's relevant NOW; grows phase-by-phase. (recommended) | ✓ |
| Full runbook upfront covering every PRD R-risk and every SUMMARY pitfall | Premature documentation; most sections would be forward-declarations | |
| Skip in Phase 1; defer entirely to Phase 6 (when WAHA enters) | Loses the backup self-test discipline that Phase 1 must establish | |

---

## Tenant-isolation verification

| Option | Description | Selected |
|--------|-------------|----------|
| Two gates: (a) `tools/check-queries.mjs` CI grep that fails on YAML queries missing `tenant_id` (with allowlist comment escape); (b) Playwright `cross-tenant-leak.spec.ts` fixture that hits every route as tenant-A with tenant-B IDs and asserts 403 | Defense in depth; both gates BEFORE Phase 2 starts. (recommended) | ✓ |
| CI grep only; skip Playwright | Static analysis catches the easy case; misses session-derived bugs | |
| Playwright only; skip grep gate | Test catches runtime leaks; misses dead-code paths and YAML that hasn't been hit yet | |

---

## Lowdefy app build distribution

| Option | Description | Selected |
|--------|-------------|----------|
| Build on hpg5 (current default per CLAUDE.md) | Works today via PsExec wrapping; defer registry push until CI exists. (recommended) | ✓ |
| Set up GitHub Actions + push to GHCR right now | Premature; no other CI work yet | |
| Build on dev machine, push manually to GHCR | Manual labor; no benefit over hpg5 build | |

---

## Repo cleanup (`archive/appsmith-export/`)

| Option | Description | Selected |
|--------|-------------|----------|
| Leave untouched | CLAUDE.md preserves it intentionally for reference. Not Phase 1 concern. (recommended) | ✓ |
| Move to `historical/` directory | Cosmetic; deferrable | |
| Delete | Irreversible (recoverable from git history but adds friction) | |

---

## Claude's Discretion

- **Plugin file structure for `app/plugins/shifty-audit-writer/`** — adopt the canonical Lowdefy custom-plugin shape verified at planning time against `.claude/skills/lowdefy/reference/09-plugins.md`.
- **Playwright pen-test fixture route discovery** — auto-derive from `app/pages/**` at test-write time so future page additions are picked up.
- **NextAuth KnexAdapter schema placement** — migration `0002` (single file) vs. `0002a_nextauth.sql` (split). Planning-time call; single file preferred if no other PRs need staged migrations.
- **Backup self-test alert delivery channel** — likely email-to-omernesher@gmail.com via Resend (after D-02 is wired), or Windows Event Log entry the user checks manually. Planning-time pick.

## Deferred Ideas

- GitHub Actions CI setup — first trigger is when `tools/check-queries.mjs` + Playwright must run pre-merge (probably Phase 2 or Phase 3).
- `docker-compose.yml` split into separate files for solver/waha — defer; revisit if main file exceeds ~150 lines.
- `docs/PRIOR_ART_BUGS.md` — capture the specific prior-art "today view" bug; that's a Phase 7 (Dashboard) prerequisite.
- Full `docs/OPERATIONS.md` content — grow phase-by-phase.
- Tenant #1 migration script (`tools/migrate-from-sheet/`) — Phase M parallel track; can start after Phase 2's `soldier` table lands.

---

*Auto-mode session — no interactive turns. Decisions logged with rationale tied to PRD, ROADMAP, SUMMARY, PITFALLS.*
