# Shifty — Miluim Shift Planning SaaS

## What This Is

Shifty is a multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. It wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first, RTL web app — soldiers self-declare availability, the manager runs the solver to produce a draft schedule, publishes it, and from there it's a living document (swap workflow with audit, manager overrides, multi-channel notifications, calendar exports). The product replaces the spreadsheet workflows that miluim units improvise during call-ups.

**Authoritative contract: `docs/PRD.md`** (1687 lines, locked decisions in §1–§14, open questions confined to §15). PROJECT.md is the GSD-facing summary; PRD is the source of truth for product-level decisions.

## Core Value

**Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks.** The schedule must be correct by construction (rules engine), fair by default (solver objective), and adapt to reality (swap workflow with audit) — all in Hebrew RTL, on the manager's commodity hardware.

## Requirements

### Validated

<!-- Existing infrastructure only — product surface is all greenfield. -->

- ✓ Docker Compose stack on hpg5 (post-pivot 2026-05-16: Budibase 3.38.4 + Postgres 16; Lowdefy killed)
- ✓ Full v2 multi-tenant schema applied (all 14 migrations including Layer-5 RLS at migration 0014); Lowdefy-era helpers + tests preserved at `legacy/shifty-handlers/`
- ✓ Public reachability via Cloudflare Tunnel (`apps.nesher.co` → hpg5:8080) — existing
- ✓ hpg5 deployment path: PsExec wrapping for `docker compose build`/`pull`, Sysinternals Autologon, Docker Desktop autostart — existing (documented in `CLAUDE.md`)
- ✓ Git repo at `github.com/omernesh/shifty` — existing

### Active

<!-- v1 scope from PRD §13. Hypotheses until shipped and validated. -->

- [ ] **Foundations** — Tenancy, org tree (1-3 levels), Auth.js magic-link, invite codes, RBAC matrix (4 roles), full v2 schema migrations (0002–0007)
- [ ] **Org & people** — Units/platoons/teams CRUD, soldier roster CRUD, role tags + seniority, CSV roster import with preview + dedup
- [ ] **Availability & rules** — Hybrid availability UI (range blockout + per-slot override), constraint lock, 8-rule catalog with per-soldier override (tightening only)
- [ ] **Solver service** — FastAPI + OR-Tools CP-SAT, stateless `/solve` endpoint, <10s p95 for 30 soldiers × 30 days × 4 rules, infeasibility report names offending rules
- [ ] **Schedule lifecycle** — Draft → publish state machine, manager hand-edit, manager manual override post-publish (audited, with `force_override` on rule violation), close on window-end
- [ ] **Swap workflow** — 1-for-1 proposal, counterparty accept/decline, auto-approve when rules pass with per-soldier overrides applied, manager review queue otherwise, atomic assignment patch, full audit
- [ ] **Time clock** — Opt-in per soldier, button (mobile) + manual pickers, midnight-spanning one-row model, no geofencing
- [ ] **Notifications** — Four channels (Email/Resend, WhatsApp/WAHA, Web Push/VAPID, in-app), per-user × per-event opt-in, per-recipient locale, 3-retry with backoff, full `notification_log` audit
- [ ] **Reports** — Daily email (cron), weekly Monday digest, event-driven notifications, external auditor recipients (P4), per-recipient locale
- [ ] **Dashboard** — Today/week/open-requests soldier view; team calendar, leaderboard (ASCII bars + accessible bar chart), uncovered slots, pending swaps for manager; aggregated views + invite code stats for admin; four analytical chart views
- [ ] **Schedule exports** — iCal (one-shot + signed long-lived subscription URL with HMAC), CSV (UTF-8 BOM for Excel-Hebrew), PDF (Puppeteer-rendered Hebrew RTL, A4/A3)
- [ ] **i18n** — Hebrew default RTL + English LTR alt, ICU MessageFormat, CI parity check between locale files
- [ ] **Cron service** — Node container in compose stack for daily reports, weekly digests, constraint-lock reminders
- [ ] **Tenant #1 migration** — One-off Python script in `tools/migrate-from-sheet/` to import user's existing Google Sheet (12 soldiers, single team) into Shifty's schema with smart-quote canonicalization

### Out of Scope (v1)

From PRD §14 — explicit deferrals with reasoning:

- Native mobile apps — PWA + Web Push covers the v1-scale mobile use case
- Cross-team / cross-tenant coverage — adds membership + availability complexity; not validated by discovery
- Multi-org membership for one user — one-user-one-tenant simplifies auth/RLS
- Payroll integration — out of domain; time-clock data is CSV-exportable
- Geofenced time-clock — privacy + ops cost; no compelling v1 use case
- SMS auth — magic link works; SMS adds carrier integrations
- Phone-call notifications — out of domain
- Rules expression DSL — 8-rule catalog covers prior-art needs; DSL is a future escape valve
- Google Calendar two-way sync — iCal subscription covers the read-side; bidirectional is v1.1
- Calendar widget via Lowdefy npm plugin — defer to v1.1; v1 uses simpler day-list view
- Multi-language UI beyond Hebrew + English — no discovery signal for other languages
- PITR (point-in-time recovery) — nightly `pg_dump` + 24h RPO acceptable for v1; WAL archiving deferred to v1.1
- WAHA QR-session automation — admin manually re-pairs on session drop; documented operational risk (R2)

## Context

**Prior art**: User has a working Google Sheet with 12 soldiers / 1 team / two 12h shifts/day, hand-typed assignments, formula-driven dashboards. The sheet works at that scale and is the seed dataset for tenant #1. Shifty must beat it without losing the beloved features: per-person calendar colors, ASCII-bar leaderboard, draft-then-promote workflow, Hebrew daily email.

**Critical prior-art bug to prevent recurring**: Smart-quote variants (`'` U+0027 vs `'` U+2019) in soldier display names broke spreadsheet `COUNTIF` lookups and silently dropped counters. **Hard rule**: every domain table uses UUID PKs; display names are mutable and NEVER used as join keys. The "kibbutz fixture" (`tools/fixtures/kibbutz.sql`) intentionally seeds a smart-quoted soldier to enforce this rule in tests.

**Stack pivot history**: (1) Appsmith CE — abandoned; "Powered by Appsmith" branding paywall (preserved at `archive/appsmith-export/`). (2) Lowdefy 5.3 — chosen as the only Apache-2.0 free-form builder without branding paywall; Phase 1 + 2 shipped on it (v0.2.0-phase2 tag). (3) **Lowdefy killed 2026-05-16** — friction accumulated past the point of diminishing returns (silent plugin-registration bug, `_state:` UI-only testing trap, missing antd block exports, build-time FATAL on Link to not-yet-existent pageIds, ECharts no native RTL). **Budibase 3.38.4 deployed same day** as replacement (Apache-2.0 CE, self-hosted, no branding paywall on CE). Business logic preserved at `legacy/shifty-handlers/`.

**Deployment reality**: Lives on hpg5 — a Windows 11 Pro desktop in the user's home, Tailscale IP `100.92.65.46`, public via Cloudflare Tunnel at `https://apps.nesher.co`. Single-host single-tenant infrastructure operationally; multi-tenant in software. This is acceptable for v1 (R6 documented as known risk); v1.1 considers cloud move.

**Post-pivot state (2026-05-17)**: Budibase stack running (8 containers); schema fully migrated; Builder UI authoring model replaces YAML-as-code; Layer-5 RLS inactive for Budibase clients (superuser bypass — see `docs/BUDIBASE-CONVENTIONS.md` §2 + PRD §8.3 amendment). Layer 2 (query-level `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid`) is the new top defense, enforced by a CI gate that ships in Phase 03 Wave 0. Phase 3 is the first phase to execute on Budibase.

**Personas (PRD §4)**: P1 unit admin (מפקד יחידה, medium tech savvy), P2 team manager (מפקד צוות, medium-low), P3 soldier (חייל/חיילת, low/mobile-first), P4 auditor (משקיף, no login — email only).

## Constraints

- **Tech stack (post-pivot 2026-05-16)**: **Budibase 3.38.4 CE** on Postgres 16 (Lowdefy retired; see Context); FastAPI+OR-Tools CP-SAT solver (Phase 04, not yet built), Docker Compose on hpg5, Budibase built-in auth (Auth.js / KnexAdapter retired with Lowdefy), WAHA for WhatsApp, Web Push for browser push, Cloudflare Tunnel for public reachability. PRD §1 reflects the Lowdefy era; see CLAUDE.md "Budibase Deployment on hpg5" + `docs/BUDIBASE-CONVENTIONS.md` for current canonical stack.
- **Language**: Hebrew RTL default, English LTR alternative. ICU MessageFormat. Asia/Jerusalem timezone everywhere. DD/MM/YYYY in he, YYYY-MM-DD in en, 24h time in both.
- **Tenant isolation (post-pivot effective layer map)**: every domain table has `tenant_id`; every Budibase Query filters by session-derived tenant_id via `'{{ Current User.tenantId }}'::uuid` (never request input); four active layers (session → query filter → page auth → request-role); Layer 5 RLS preserved in schema for future non-Budibase direct-DB clients (e.g., the FastAPI solver) but INACTIVE for Budibase clients (Postgres superuser bypass — framework constraint). Layer 2 is the new top defense, enforced by `tools/check-bb-queries.mjs` (Phase 03 Wave 0). Goal G5 unchanged: zero cross-tenant data leaks.
- **Solver SLO**: <10s p95 for 30 soldiers × 30 days × 4 active rules. Stateless. Same seed = same output.
- **Notification SLOs**: Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant.
- **Hardware**: single hpg5 desktop (Windows 11 Pro + Docker Desktop + WSL2). PsExec required for any docker command that needs the credential helper (pull, build).
- **Budget**: self-hosted; no commercial WhatsApp Business API in v1, no paid email provider beyond Resend's free tier early on.
- **Authoritative document precedence**: when PRD §15 lists an option as "Open", planning may choose; when PRD lists a decision (any section other than §15), the decision is locked and re-opening it requires explicit user discussion.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Lowdefy over Appsmith/Budibase/ToolJet | Only Apache-2.0 free-form builder without "Powered by" branding paywall (PRD §1) | ⚠ Superseded 2026-05-16 — see next row |
| **Stack pivot: Budibase 3.38.4 over Lowdefy 5.3 (2026-05-16)** | Lowdefy friction accumulated past breakeven (silent plugin-registration bug, `_state:` testing trap, missing antd blocks, build-time FATAL on stub Links, ECharts no native RTL). Budibase CE self-hosted has no branding paywall, more mature data-source/automation/permission model, and a credible Builder UI. Trade-offs accepted: (a) source-of-truth shifts from git-YAML to CouchDB, (b) Layer 5 RLS inactive for Budibase clients (framework constraint). | ✓ Good — chosen mid-build; Phase 1 + 2 outputs at `legacy/`; Phase 3+ executes on Budibase |
| Single source of truth = `docs/PRD.md` | One contract for product intent; PROJECT.md is a summary, ROADMAP.md is execution | ✓ Good — established at init |
| UUID PKs everywhere; display names never as join keys | Prior-art smart-quote bug broke spreadsheet COUNTIFs silently | ✓ Good — encoded in `tools/fixtures/kibbutz.sql` |
| Solver is stateless; Lowdefy owns persistence and dispatch | Clean failure isolation; solver can be restarted/replaced independently | — Pending |
| Auto-approve swaps when rules pass WITH per-soldier overrides applied | Overrides are tightenings, so passing the strictest check is the correct gate | — Pending |
| Roster CSV import elevated from v1.1 to v1 | Single-row "add soldier" form doesn't scale beyond 5-10 entries; existing rosters need a one-shot import | — Pending |
| Manager manual override post-publish (escape hatch) | Reality of reserve duty — no-shows, last-minute pulls — needs unilateral edit distinct from swap negotiation | — Pending |
| `cron` as separate compose service (not in-app) | Restart-safe, stateless, decoupled from Lowdefy runtime issues | — Pending |
| VAPID key rotation NOT in v1 | Rotation invalidates all push subs; acceptable trade-off pre-launch | — Pending |
| "Weekend" = Friday + Saturday, hardcoded in solver | Israeli weekend; tenant-configurable deferred to v2 | — Pending |
| Per-recipient locale (not per-tenant) | Mixed-locale tenants real; locale stored on `app_user.locale` / `report_recipient.locale` | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-17 (stack pivot reflected); original 2026-05-12 (Lowdefy era)*
