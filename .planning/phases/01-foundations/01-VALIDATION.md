---
phase: 1
slug: foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Source: `01-RESEARCH.md` §Validation Architecture (research-derived). Planner promotes this into per-task `<automated>` verify hooks.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (E2E + cross-tenant pen-test) + Node built-in `node:test` (CLI tools) |
| **Config file** | `playwright.config.ts` — Wave 0 gap |
| **Quick run command** | `node tools/check-queries.mjs` |
| **Full suite command** | `npx playwright test tests/e2e/` (requires seeded DB at `localhost:5432` via compose) |
| **Estimated runtime** | quick: <5s; full: ~60s with cold-start, ~30s subsequent |

---

## Sampling Rate

- **After every task commit:** Run `node tools/check-queries.mjs` (static analysis; <5s)
- **After every plan wave:** Run `npx playwright test tests/e2e/` (integration + pen-test)
- **Before `/gsd-verify-work`:** Full suite must be green AND `docker compose run --rm migrate up` exits 0 on a second invocation (idempotency proof) AND `curl http://hpg5:8080/employees` returns 200 with row data
- **Max feedback latency:** 5s (CI grep) / 60s (full E2E)

---

## Per-Task Verification Map

The planner will assign specific Task IDs; this is the requirement→test-type map.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| **AUTH-01** | Magic-link email delivered via Resend after `signIn(email)` | Manual (live Resend in staging) | Manual smoke in staging | N/A (live integration) |
| **AUTH-02** | Session cookie is HTTP-only + Secure; CSRF token on state-changing POSTs | Integration (Playwright) | `npx playwright test tests/e2e/auth-cookies.spec.ts` | ❌ Wave 0 |
| **AUTH-03** | Admin generates invite code; UI shows 8-char Crockford base32 string | Integration | `npx playwright test tests/e2e/invite-flow.spec.ts` | ❌ Wave 0 |
| **AUTH-04** | Invite code regex matches `^[0-9A-HJKMNPQRSTVWXYZ]{8}$` and rejects lowercase variants | Unit | `node --test tools/test/invite-code.test.mjs` | ❌ Wave 0 |
| **AUTH-05** | Redeeming invite creates `membership` + `invite_code_redemption` audit row | Integration | `npx playwright test tests/e2e/invite-flow.spec.ts` | ❌ Wave 0 |
| **AUTH-06** | Revoked/expired/used-up invite codes return Hebrew error | Integration | `npx playwright test tests/e2e/invite-flow.spec.ts` | ❌ Wave 0 |
| **AUTH-07** | Session JSON contains `{tenant_id, roles[], team_ids[], locale}` after sign-in | Integration | `npx playwright test tests/e2e/session-shape.spec.ts` | ❌ Wave 0 |
| **TEN-01..05** | Sign-up flow creates tenant; org tree CRUD works at the admin level | Integration | `npx playwright test tests/e2e/tenant-bootstrap.spec.ts` | ❌ Wave 0 |
| **SEC-01** | No YAML query in `app/**/*.yaml` is missing `tenant_id` (without allowlist comment) | Static analysis | `node tools/check-queries.mjs` | ❌ Wave 0 |
| **SEC-02..03** | Pages declare `auth` block; mutating requests declare `properties.auth` | Static analysis | `node tools/check-queries.mjs --auth-blocks` | ❌ Wave 0 |
| **SEC-04** | RLS blocks SELECT/UPDATE/DELETE across tenants when `app.current_tenant` is set | Integration | `npx playwright test tests/e2e/rls-cross-tenant.spec.ts` | ❌ Wave 0 |
| **SEC-05** | CI grep gate fails build on YAML query missing `tenant_id` (mutation test) | Static analysis | `node tools/check-queries.mjs --self-test` | ❌ Wave 0 |
| **SEC-06** | Every list/detail/mutation route returns 403 when called with cross-tenant IDs | E2E pen-test | `npx playwright test tests/e2e/cross-tenant-leak.spec.ts` | ❌ Wave 0 |
| **SEC-07** | UPDATE/DELETE/TRUNCATE on `schedule_audit`/`roster_import_log` fails with permission denied | Integration (psql) | `npx playwright test tests/e2e/audit-immutable.spec.ts` | ❌ Wave 0 |
| **SEC-08** | `.env` file is in `.gitignore`; no secret in committed code | Static analysis | `git ls-files | grep -E '\.env$'` (must return empty) | ✅ existing |
| **SEC-09** | Listing endpoint for `invite_code` requires `unit_admin` role | E2E | Included in `tests/e2e/cross-tenant-leak.spec.ts` | ❌ Wave 0 |
| **SEC-10** | Log output contains no `*_SECRET`/`*_PASSWORD`/`*_KEY` env values | Integration | `npx playwright test tests/e2e/log-redaction.spec.ts` | ❌ Wave 0 |
| **OPS-01** | Compose stack includes services: `lowdefy`, `postgres`, `migrate`, plus forward-declared slots for `solver`/`cron`/`waha` (commented stubs) | Static | `docker compose config | grep -E 'lowdefy|postgres|migrate'` | N/A (compose) |
| **OPS-02** | Migrations 0001–0010 apply via `migrate` service; re-runs are idempotent | Schema/migration | `docker compose run --rm migrate up` twice (second must exit 0) | N/A (compose) |
| **OPS-03** | Nightly `pg_dump` Windows Task Scheduler job creates `YYYY-MM-DD.dump` in `C:\shifts-manager\backups\pg\` | Manual + script | `Get-ScheduledTask -TaskName 'shifty-backup'` + sample dump verification | ❌ Wave 0 |
| **OPS-04** | Nightly off-host copy to neshernas succeeds (or alerts on failure) | Manual + script | `rclone listremotes` on hpg5 (must include neshernas) | ❌ Wave 0 + rclone install gate |
| **OPS-05** | `pg_restore --list` self-test runs daily and alerts on non-zero exit | Manual + script | Output line count > 0 on latest dump | ❌ Wave 0 |
| **OPS-06** | Quarterly restore drill produces a working staging Lowdefy at signin → dashboard → schedule view | Manual | Quarterly drill protocol in `docs/OPERATIONS.md` | N/A (manual) |
| **OPS-07** | External Uptime Kuma monitor returns "up" for `https://apps.nesher.co/` from neshernas | Manual + monitor | Uptime Kuma dashboard probe | N/A (external) |
| **OPS-08** | `docs/OPERATIONS.md` exists with all required sections per D-09 | Static | `test -f docs/OPERATIONS.md && grep -c '^## ' docs/OPERATIONS.md` | ❌ Wave 0 |
| **OPS-09** | Test strategy documented per PRD §8.4 in `docs/OPERATIONS.md` §Test Strategy | Static | Section exists | ❌ Wave 0 |
| **OPS-10** | Kibbutz fixture (`tools/fixtures/kibbutz.sql`) exists with 12 soldiers including one smart-quoted name | Unit | `psql -f tools/fixtures/kibbutz.sql && SELECT count(*) FROM soldier WHERE display_name LIKE '%’%'` (must be ≥1) | ❌ Wave 0 |
| **I18N-07** | Hebrew-text columns use `COLLATE "he-x-icu"`; ORDER BY produces correct Hebrew alphabetic order | Integration | `npx playwright test tests/e2e/hebrew-collation.spec.ts` | ❌ Wave 0 |
| **PERF-04** | `(tenant_id, ...)` composite indexes exist on hot tables (verified via `\d+`) | Integration | `psql -c '\d+ assignment' | grep idx_assignment_tenant` | N/A (psql) |
| **D-01** | Lowdefy runtime smoke test passes on hpg5 (HTTP 200 + zero `ERR_MODULE_NOT_FOUND`) | Manual + script | `curl http://hpg5:8080/employees && docker logs shifty-lowdefy 2>&1 | grep -c 'ERR_MODULE_NOT_FOUND'` (last must be 0) | N/A (smoke) |
| **D-08** | `shifty-audit-writer` plugin writes a `schedule_audit` row from a mutating page | Integration (Playwright) | `npx playwright test tests/e2e/audit-writer.spec.ts` | ❌ Wave 0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ❌ Wave 0 = file does not yet exist; created by Wave 0 of plans*

---

## Wave 0 Requirements

Files Plan 01 (Infrastructure scaffolding) MUST create before any other plan can run its tests:

- [ ] `playwright.config.ts` — Playwright base config with `baseURL=http://localhost:8080`, sequence mode, project for cross-tenant pen-test
- [ ] `tests/e2e/_fixtures/seed-tenants.ts` — Seeds tenant-A and tenant-B with one user each + one membership each
- [ ] `tests/e2e/_fixtures/teardown.ts` — TRUNCATE everything between tests (preserves the migrate-applied schema)
- [ ] `tools/check-queries.mjs` — CI grep gate (see Plan 04 detail)
- [ ] `tools/fixtures/kibbutz.sql` — 12-soldier fixture with one U+2019 smart-quoted name (per PRD §8.4)
- [ ] `tools/backup/backup-postgres.ps1` — PowerShell `pg_dump` + retention script
- [ ] `tools/backup/restore-test.ps1` — `pg_restore --list` self-test script
- [ ] `package.json` (root or `app/`) — `playwright`, `@playwright/test`, `node-pg-migrate` not needed (we use golang-migrate), and any other dev deps
- [ ] `app/plugins/shifty-audit-writer/package.json`, `plugin.js`, `tests/` — first custom plugin scaffold

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend magic-link email delivery | AUTH-01 | Live SMTP/HTTP integration; not mockable in unit tests | Trigger sign-in flow in staging; check inbox of `omernesher+staging@gmail.com`; verify link redirects to `/auth/callback` |
| Cloudflare Tunnel external reachability | (implicit — used in OPS-07) | External network dependency; not under repo control | Open `https://apps.nesher.co/` from a mobile device on cellular (not Tailscale); verify TLS + reachability |
| Windows Update active hours configured | OPS-08 (runbook) | Windows GPO setting on hpg5 | `Get-WindowsUpdateLog` + check active hours via `gpedit.msc` |
| Quarterly restore drill | OPS-06 | Spin-up procedure with disposable Postgres + staging Lowdefy | Documented in `docs/OPERATIONS.md` §Restore Drill Protocol |
| Uptime Kuma external monitor configured on neshernas | OPS-07 | Out-of-repo dependency (separate host, separate stack) | Add HTTP push monitor + email alert on neshernas Uptime Kuma instance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies declared
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references in the Per-Task Verification Map
- [ ] No watch-mode flags (`--watch`, `--ui`) in CI commands
- [ ] Feedback latency: <5s for quick (grep), <60s for full E2E
- [ ] `nyquist_compliant: true` set in frontmatter after planner verifies coverage

**Approval:** pending (planner sets `nyquist_compliant: true` after all per-task `<automated>` blocks reference rows in the Per-Task Verification Map above)

---

## Open Wave 0 Gaps (from RESEARCH.md)

These are environment prerequisites, not code tasks — they must be resolved before the corresponding REQ can be verified:

1. **`rclone` installation on hpg5** — Plan 06 (ops baseline) must include either an install step OR document as a human prerequisite that blocks OPS-04 verification.
2. **`RESEND_API_KEY` provisioned in `.env`** — Plan 03 (auth) cannot verify AUTH-01 end-to-end without the key. Human prerequisite or staging-stub fallback.
3. **`fonts-noto-core` in the Lowdefy runtime image** — Forward-declared for Phase 7 (PDF rendering); not Phase 1. NOT a Wave 0 gap for Phase 1.
4. **Dedicated WAHA SIM** — Forward-declared for Phase 6 (notifications); not Phase 1. NOT a Wave 0 gap for Phase 1.
