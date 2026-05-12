# Project Research Summary — Shifty

**Project:** Shifty — Miluim Shift Planning SaaS
**Domain:** Multi-tenant Hebrew-first workforce-scheduling SaaS for Israeli reserve units, self-hosted on a single Windows 11 host (hpg5) via Docker Compose, with a constraint-aware CP-SAT solver and multi-channel notifications (Email + WhatsApp + Web Push + in-app)
**Researched:** 2026-05-12
**Confidence:** MEDIUM-HIGH overall — HIGH on stack, features, and pitfalls; MEDIUM on a handful of Lowdefy-specific architecture patterns that have no canonical reference (verified through GitHub discussions and the in-repo `.claude/skills/lowdefy/` skill)

---

## Executive Summary

Shifty is a **niche-positioned SaaS in a crowded category**. The shift-scheduling space is mature (When I Work, Deputy, Sling, Shiftboard, Snap Schedule, etc.) but every viable competitor is English-first with RTL bolted on at best, sells WhatsApp as an enterprise add-on, and gates self-host/no-branding behind a paid Business plan. Shifty's wedge is the combination of Hebrew-RTL-as-default + Apache-2.0 self-host + Israeli weekend semantics + WhatsApp as a first-class channel — none of which any existing product ships natively. The PRD v1 scope was validated against industry norms and **no v1 gap was surfaced that required re-elevation** (10 candidate gaps from competitor research were evaluated and dismissed, with 3 already correctly placed in v1.1).

The stack is **locked and the research confirms each pin is current and viable** (Lowdefy 5.3.0 + Postgres 16 + Python 3.12 + OR-Tools 9.15.6755 + WAHA 2026.4 + Resend 6.12.3 + Web Push 3.6.7 + Puppeteer 23 + node-cron 4.2.1, all on `node:22-bookworm` / `python:3.12-slim-bookworm` — no Alpine for the app or solver). The architecture is **clean and PRD-consistent**: a 5-service Docker Compose (Lowdefy, Postgres, Solver, Cron, WAHA), the Lowdefy app calls everything, Solver/Cron/WAHA never call back into Lowdefy except through the explicit webhook endpoints. The biggest architectural amendment surfaced during research is that **a custom Lowdefy request plugin scaffold becomes a Foundations-phase prerequisite** because layer-4 RBAC, the notification dispatcher, the webhook receivers, and the iCal/CSV/PDF export endpoints all need the same primitive — Lowdefy does not validate request payloads server-side natively ([discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409)), so the custom-plugin escape hatch is on the critical path, not an afterthought.

The critical risks are **operational, not technical**. The single highest is the Lowdefy runtime blocker (`ERR_MODULE_NOT_FOUND` on hash-suffixed `@lowdefy/helpers-*` packages), which the STACK research suggests **may already be fixed in repo commit `b8afba1`** — Phase 1 must SMOKE TEST first, with a 5-day timebox and a documented escape hatch (switch to npm, or in extremis revisit the Lowdefy lock). Beyond that, the four risks to internalize in the roadmap are: (1) CP-SAT becomes infeasible-by-default when all 8 PRD rules activate against a 12-soldier roster (kibbutz-fixture feasibility is a Phase-S gate, not a smoke test); (2) WAHA session drops are likely-high without a dedicated SIM and `WHATSAPP_RESTART_ALL_SESSIONS=true` (Phase-N OPS prerequisite); (3) tenant isolation needs a 5th defense layer (Postgres RLS migration 0009) on top of PRD's prescribed four; (4) ECharts has no native RTL support and the Gantt timeline view is unworkable in v1 — pair the ASCII-bar leaderboard with an LTR accessible bar chart and defer Gantt to v1.1.

---

## Key Findings

### Recommended Stack

The stack is **PRD-locked**; the research's contribution is the **exact version pins** (HIGH confidence on every pin via Context7 + npm registry + project skill cross-checks) and the **must-have configuration details** (e.g., pnpm 9.15.5 not 11.x; Debian-base not Alpine for the app and solver; `node-cron` v4 API; ECharts has no RTL).

**Core technologies (pinned):**
- **Lowdefy 5.3.0** (`node:22-bookworm` base) — UI + thin business logic + Next.js SSR; KnexAdapter for NextAuth; the consumer install MUST use pnpm 9.15.5 (pnpm 11 refuses build scripts for `@sentry/cli` and `sharp` that Lowdefy's server pulls)
- **Postgres 16** — single source of truth; `citext` extension required for `app_user.email`; **declare Hebrew-collated columns with `COLLATE "he-x-icu"`** (default collation gives Unicode-codepoint order, not Hebrew alphabetic — silent UX bug)
- **OR-Tools `ortools==9.15.6755`** on Python 3.12 (slim-bookworm, NOT Alpine — OR-Tools wheels are glibc-based) — CP-SAT with **`num_search_workers=1` pinned** for determinism (PRD §7.8 "same seed = same output" breaks at >1 worker; v1.1 may switch to `interleave_search`)
- **WAHA `devlikeapro/waha:2026.4`** with `WHATSAPP_DEFAULT_ENGINE=NOWEB` — Apache-2.0, lower memory than WEBJS; requires `WHATSAPP_RESTART_ALL_SESSIONS=true` + a **dedicated SIM separate from the user's personal number**
- **Resend `resend@6.12.3`** + `web-push@3.6.7` + Puppeteer 23 (Debian base with `fonts-noto-core` + `fonts-noto-cjk` + `fontconfig` — Hebrew renders as tofu otherwise) + `node-cron@4.2.1` (v4 API; v3 tutorials are stale)
- **`@lowdefy/blocks-echarts@5.3.0`** — Apache-2.0 chart library; **ECharts has no native RTL support** ([issue #19609](https://github.com/apache/echarts/issues/19609) unresolved). PRD §7.13 leaderboard pairs ASCII bars + LTR bar chart, which is acceptable; the Gantt timeline view is the pain point and is a v1.1 candidate (replace ECharts Gantt with `vis-timeline`, which has documented RTL support, or drop in v1)
- **`migrate/migrate:v4.17.0`** (golang-migrate) — new compose service for ordered SQL migration runs; replaces the manual `psql` approach in CLAUDE.md "Common ops"

See `.planning/research/STACK.md` for full installation manifests, version-pin rationale, and recipes per integration (ECharts Hebrew strategy in §8, Puppeteer Hebrew fonts in §7, OR-Tools rule encodings in §3).

### Expected Features

Every PRD v1 table-stake is industry-standard (HIGH confidence, multi-source). The differentiators are tightly coupled to the wedge — they are the features that make a 12-soldier miluim unit stay vs. churning back to a spreadsheet.

**Must have (table stakes — all already in PRD v1, no gaps):**
- Roster CRUD + CSV import (elevated from v1.1 to v1.0 — single-row form doesn't scale beyond 5-10 entries)
- Shift schemas with templates + custom slots; auto-scheduling with constraints; manual hand-edit + drag-and-drop
- Self-service availability declaration; publish/unpublish state machine
- 1-for-1 swap workflow with manager-approved auto-approve when rules pass
- Email + push notifications on schedule events; in-app inbox; mobile-friendly UI (PWA)
- Calendar view; time clock; iCal export; CSV export; role-based access control; audit trail on critical state changes; self-signup with invite codes

**Should have (differentiators — the wedge):**
- Hebrew RTL UI default + Asia/Jerusalem timezone + DD/MM/YYYY (no global SaaS does this end-to-end)
- Miluim weekend semantics (Fri+Sat hardcoded; `weekend_separation` rule — "worked weekend N → skip N+1")
- Hebrew daily email replicating prior-art Google Sheet shape (auditor P4 lives on this)
- ASCII-bar leaderboard + per-person calendar colors (24-color preset, soldier-overridable)
- WhatsApp as first-class channel via WAHA self-hosted (no Twilio cost, no Meta Business verification)
- Solver infeasibility report names offending rules (PRD §7.8); **research recommends extending to soldier-level + date-level attribution via CP-SAT assumption-based unsat-core extraction** (`solver.SufficientAssumptionsForInfeasibility()` — see Critical Decision #4 below)
- Per-soldier rule overrides that can ONLY tighten; swap auto-approve evaluates with overrides applied
- Manager manual override post-publish with `force_override` audit + reason field
- Per-recipient locale (not per-tenant) — mixed-locale tenants (Hebrew manager + English auditor) are real
- Hebrew-aware PDF rendering via Puppeteer with `fonts-noto-core` (wkhtmltopdf is unmaintained + flaky on RTL)
- Roster CSV import with smart-quote canonicalization at write time (defends against the prior-art-sheet COUNTIF bug)

**Anti-features (explicitly NOT building):**
- Geofenced time clock + photo-verified clock-in (privacy-hostile in military context)
- Payroll integration; predictive scheduling / fair-workweek compliance (US-laws-only)
- Shift bidding marketplace + open-shift broadcast (conflicts with chain-of-command model)
- In-app chat (soldiers already use WhatsApp groups)
- SMS auth + phone-call notifications + rules expression DSL (8-rule frozen catalog suffices)
- Multi-language UI beyond Hebrew + English; cross-tenant coverage; multi-org membership

See `.planning/research/FEATURES.md` for the 21 table-stakes (§1), 16 differentiators (§2), 19 anti-features (§3), 10 evaluated-and-dismissed gaps (§4), and PRD cross-reference table.

### Architecture Approach

Five-service Docker Compose stack on hpg5; direction-of-calls is strictly Lowdefy → {Postgres, Solver, WAHA, Resend, Web Push}, Cron → Lowdefy, **no cycles**. Solver is **stateless** (does not know Postgres exists; Lowdefy owns persistence and `solver_run` audit). Cron is a 20-line wrapper around `node-cron` that POSTs to `/api/internal/cron/<job>` with `CRON_SHARED_SECRET`. Postgres is the single source of truth; all secrets live only in `.env` on hpg5.

**Major components:**
1. **`lowdefy`** (Next.js SSR, port 8080:3000) — UI, auth, persistence orchestration, notification dispatch, exports, audit writes, webhook receivers (`/api/webhook/resend`, `/api/webhook/waha`), internal cron endpoints
2. **`postgres:16`** — tenant data, audit logs, NextAuth tables; only Lowdefy connects
3. **`solver`** (FastAPI + OR-Tools, internal-only) — `/solve` endpoint with `Bearer SOLVER_SHARED_SECRET`; stateless; gunicorn 2 workers for crash resilience
4. **`cron`** (node-cron alpine, internal-only) — daily report 07:00, weekly Monday 08:00, hourly lock-reminder check, 00:05 window archiver — all `Asia/Jerusalem`
5. **`waha`** (`devlikeapro/waha:2026.4`, internal-only) — WhatsApp gateway; dashboard UI bound to Tailscale only for QR re-pairing (NEVER the public tunnel)
6. **`migrate`** (one-shot `migrate/migrate`) — runs `db/migrations/0001–0010` in order; idempotent

See `.planning/research/ARCHITECTURE.md` for tenant-isolation patterns (§Pattern 1 — five layers including new RLS), solver HTTP contract (§Pattern 2), cron at-least-once + idempotency (§Pattern 3), notification dispatcher as a custom Lowdefy request plugin (§Pattern 4), append-only audit enforcement via triggers (§Pattern 5), and the migration-runner decision (§Pattern 6).

### Critical Pitfalls (top 5, keyed to phase below)

1. **Lowdefy runtime `ERR_MODULE_NOT_FOUND` is the project bus factor** — `.claude/skills/lowdefy/reference/10-deployment.md` documents the fix; the open question in `CLAUDE.md` may already be resolved at commit `b8afba1`. **Phase 1 must smoke-test first** (curl the home page, see a live Postgres row) before declaring "Lowdefy works." If the smoke test fails, 5-day timebox + day-5 hard checkpoint to escape: (a) switch package manager to npm, (b) escalate to a Lowdefy-lock re-open conversation. *(PITFALLS Pitfall 1)*

2. **Tenant isolation fails open via a single missing `WHERE tenant_id`** in any YAML query. PRD §8.3 prescribes a 4-layer defense; research adds a **5th defense layer: Postgres RLS** (migration `0009_rls_policies.sql`) on every domain table, with `app.current_tenant` set per-connection-checkout via a Knex `afterCreate` hook. Also: **CI grep gate** (`tools/check-queries.mjs`) fails the build on YAML queries missing `tenant_id`; **Playwright pen-test fixture** asserts every list/detail/mutation route 403s for cross-tenant access. PRD G5 zero-leak is non-negotiable. *(PITFALLS Pitfall 2 + ARCHITECTURE Pattern 1)*

3. **CP-SAT solver becomes infeasible against the user's actual 12-soldier kibbutz fixture** once all 8 PRD rules activate at default values. Two non-negotiables for Phase S: (a) **kibbutz-fixture feasibility gate in CI** — 12 soldiers × 64-day window × all 8 rules × PRD defaults must return `optimal` or `feasible` in <10s, or rule defaults need retuning BEFORE launch; (b) **promote `infeasibility_report` beyond rule names** — use `solver.SufficientAssumptionsForInfeasibility()` to extract a minimal unsat core with affected soldier IDs + dates per offending rule, not just a list of rule names. This is the only UX that makes infeasibility actionable for a non-technical מפקד. Also: **pin `num_search_workers=1` for determinism**; canonical input ordering before solving (`ORDER BY id` everywhere). *(PITFALLS Pitfall 3)*

4. **WAHA session drops + sent-vs-delivered semantics** are the highest-likelihood delivery risk. The user's personal phone number used both for personal WhatsApp Web and WAHA on hpg5 triggers WhatsApp's one-active-Web-session-per-number rule — **the user themselves is the most likely cause of WAHA drops**. Phase N requires three OPS prerequisites: (a) **dedicated SIM** (not the user's personal number), (b) `WHATSAPP_RESTART_ALL_SESSIONS=true` + WAHA dashboard bound to Tailscale (never the public tunnel), (c) **`notification_log.status` MUST transition through the WAHA webhook** (queued → accepted → delivered, not "sent on HTTP 200"). *(PITFALLS Pitfall 4)*

5. **Hebrew display bugs from BiDi mixing + Postgres collation + Outlook RTL bugs + Puppeteer fonts** — Pitfall 5 in PITFALLS.md catalogs 8 specific bug classes. The non-obvious ones: Postgres default `text` collation sorts Hebrew by Unicode codepoint not alphabetically (declare `COLLATE "he-x-icu"`); CSV import must strip U+200E/U+200F/U+202A–U+202E direction marks; Puppeteer Hebrew PDF needs `fonts-noto-core` (renders tofu otherwise); plaintext email fallback in Hebrew must prefix lines with U+200F to set base direction; Outlook 2013/2016/2019 + Mac break on `dir="rtl"` with cell padding (Litmus snapshot tests required). *(PITFALLS Pitfall 5)*

See `.planning/research/PITFALLS.md` for the full 10-pitfall catalog with warning signs, recovery strategies, and phase mapping.

---

## Critical Decisions Surfaced During Research

These are decisions the PRD does NOT spell out, that research has now resolved or escalated. Each should be reflected in the roadmap.

| # | Decision | PRD status before | Research resolution | Roadmap impact |
|---|----------|-------------------|----------------------|----------------|
| 1 | **Postgres RLS as 5th defense layer** | PRD §15 R4 deferred RLS "once Lowdefy supports it cleanly" | Ship `0009_rls_policies.sql` in Foundations phase; YAML cost is low (one Knex `afterCreate` hook), red-team test added to CI | Add to Foundations phase; ARCHITECTURE Pattern 1 |
| 2 | **Custom Lowdefy request plugin scaffold is a Foundations prerequisite** | PRD doesn't mention plugins | Lowdefy doesn't validate request payloads server-side ([discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409)); layer-4 RBAC, notification dispatcher, webhook receivers, iCal/CSV/PDF endpoints all share this primitive — build once in Foundations | Foundations phase has a new line item: `app/plugins/shifty-*/` scaffolding + first plugin (`shifty-audit-writer`) |
| 3 | **CP-SAT `num_search_workers=1` pinned for determinism** | PRD §7.8 says "same seed = same output"; doesn't pin worker count | Multi-worker CP-SAT is seed-deterministic but NOT bit-for-bit identical across CPU loads ([or-tools #3590](https://github.com/google/or-tools/issues/3590)); pin `num_search_workers=1` in v1, switch to `interleave_search` if scale demands it in v1.1 | Phase S definition of done; documented in `solver/README.md` |
| 4 | **Assumption-based unsat-core for infeasibility report** | PRD §7.8 schema lists `offending_rules` as a list of rule names | Promote to `offending_rules: [{rule_name, affected_soldier_ids[], affected_dates[], explanation_he}]` via `solver.SufficientAssumptionsForInfeasibility()` ([or-tools #973](https://github.com/google/or-tools/issues/973)) — managers cannot act on rule names alone | Phase S scope grows; budget extra time; new UX in `manual_override` and `run_solver` pages |
| 5 | **ECharts has NO native RTL support** | PRD §7.13 leaning on `@lowdefy/blocks-echarts` | Keep ECharts (Apache-2.0; AmCharts/Highcharts are commercial for SaaS); **ASCII-bar leaderboard pairs with LTR accessible bar chart, which is acceptable**; **Gantt-style team timeline is the pain point — defer to v1.1 or replace with `vis-timeline`** | Phase 7 (Polish): scope Gantt OUT of v1 or budget for `vis-timeline` custom block |
| 6 | **WAHA dedicated SIM is a Phase N prerequisite, not a v1.1 nice-to-have** | PRD §15 R2 accepts "high likelihood" session drops | Personal-number drop cycle is daily-frequency once the user does anything on WhatsApp Web; defer is unacceptable | Phase N pre-flight checklist; document in `docs/OPERATIONS.md` |
| 7 | **`migrate/migrate` (golang-migrate) compose service** | CLAUDE.md uses manual `psql` | Industry-standard for Postgres+Docker stacks; 10MB binary, idempotent, version-pinned, supports `up/down/force`; PRD's "never edit a committed migration" rule maps directly | Foundations phase: add to `docker-compose.yml`; deploy script |
| 8 | **NextAuth KnexAdapter requires its own schema tables** | Implicit in PRD migrations, not numbered | Add `users`, `accounts`, `sessions`, `verification_tokens` to migration `0002` alongside `app_user` (tenant-aware shadow) | Foundations phase migration sequencing |
| 9 | **Audit-log immutability via Postgres triggers + REVOKEs** | PRD §8.2 mandates append-only, doesn't prescribe enforcement | Migration `0010_audit_revokes.sql` REVOKEs UPDATE/DELETE/TRUNCATE on `schedule_audit` / `roster_import_log`; trigger-enforced column-immutability on `notification_log` (queued→sent→delivered status lifecycle requires UPDATE) | Foundations phase last migration |
| 10 | **PRD §13.1 build order amended** | PRD §13.1 has 7 phases | Two amendments: (a) Foundations expands to include Lowdefy runtime smoke test + plugin scaffold + migrations 0008–0010 (legacy-drop + RLS + audit-revokes); (b) Phase 5 (Swap + Override + Time Clock) is now formally **parallelizable** across 3 sub-agents | Roadmap parallelism markers below |

---

## Implications for Roadmap

PRD §13.1 phasing is correct in shape; research validates the 7-phase collapse and adds **internal parallelism markers** for sub-agent dispatch. Suggested phases below extend PRD §13.1 with the architecture-research amendments.

### Phase 1: Foundations
**Rationale:** Nothing user-visible exists until tenant isolation works end-to-end. Every downstream phase depends on this. Lowdefy runtime smoke test is the bus factor.
**Delivers:** Booting Lowdefy SSR with live Postgres rows, four roles, RBAC enforced at four code layers + Postgres RLS, all schema migrations 0001–0010 applied via `migrate` service, custom-plugin scaffold ready for downstream phases.
**Build order (SEQUENTIAL — blocks all downstream):**
1. **Smoke test Lowdefy runtime first** — `curl http://hpg5:8080/employees` returns 200 with live row. If broken, 5-day timebox.
2. `migrate` compose service + migrations `0002_tenancy_and_org.sql` (+ NextAuth adapter tables) → `0003_shifts_and_windows` → `0004_availability_rules_swaps` → `0005_auth_and_notifications` → `0006_audit_and_solver_runs` → `0007_imports_and_exports` → `0008_assignment_state_and_legacy_drop` → `0009_rls_policies` → `0010_audit_revokes`
3. NextAuth EmailProvider (Resend SMTP) + KnexAdapter + SessionCallback that hydrates `tenant_id` + `roles` + `team_ids` + `locale`
4. **`app/plugins/shifty-audit-writer/` scaffold** (first custom Lowdefy request plugin; unlocks layer-4 RBAC + dispatcher + webhooks + signed-URL endpoints downstream)
5. CI grep gate `tools/check-queries.mjs` + Playwright cross-tenant pen-test fixture
6. Kibbutz fixture (12-soldier smart-quote-containing seed) — unblocks Phase 4 solver tests
7. Log-redaction middleware for `*_SECRET` / `*_PASSWORD` / `*_KEY` env-vars
8. Backup self-test script (`pg_restore --list` on the dump)
**Addresses:** PRD G5 (zero cross-tenant leaks), unblocks every downstream phase.
**Avoids pitfalls:** P1 (Lowdefy runtime), P2 (tenant isolation), P6 (backup self-test + log redaction).
**Research flag:** SMOKE-TEST Lowdefy first; CLAUDE.md open question may already be resolved at commit `b8afba1`.

### Phase 2: Org & people
**Rationale:** The roster is the precondition for every other domain operation. CSV import is a long-pole feature (gates every tenant onboarding) — prioritize early.
**Delivers:** Units/platoons/teams CRUD (sequential FK chain), soldier CRUD, role tags + seniority, CSV roster import with smart-quote canonicalization + direction-mark stripping + preview + duplicate detection.
**Build order:** Mostly sequential FK chain; CSV import can parallel-build with Phase 3 IF soldier CRUD is complete.
**Avoids pitfalls:** P5 (CSV direction-mark stripping); P10 (display-name normalization, 24-color palette spec).

### Phase 3: Availability & rules
**Rationale:** Solver needs availability + rule config + closed planning window to chew on; this phase produces all three inputs.
**Delivers:** Hybrid availability UI (range blockout + per-slot override), constraint lock + 24h-pre-lock notification, 8-rule catalog config UI with per-soldier override (tightening only — encoded semantics, not a wiki note), planning-window CRUD with `shift_instance` generation, shift-slot CRUD.
**Build order:** Sequential within (shift_slot → planning_window+shift_instance → availability UI → rules config → constraint-lock cron-fired event).

### Phase 4: Solver & schedule
**Rationale:** The headline value of the product. Manager goes from 4 hours of spreadsheet to 30 minutes of solver + review.
**Delivers:** FastAPI `/solve` endpoint (Apache-2.0 stack: ortools 9.15.6755), CP-SAT encoding for all 8 rules with **`num_search_workers=1` pinned**, **assumption-based unsat-core infeasibility report** (soldier IDs + dates + Hebrew explanation per offending rule), `solver_run` audit table + `random_seed` reproducibility, draft generation page, manager hand-edit with real-time rule re-check, publish state transition with audit.
**Build order (SEQUENTIAL):** (a) stateless `/solve` + kibbutz-fixture black-box test in CI; (b) Lowdefy → solver wiring + `solver_run` persistence + UI rendering for all 4 statuses × 4 error codes; (c) draft page; (d) manager hand-edit; (e) publish transition.
**Phase definition of done — non-negotiable gates:**
- Kibbutz fixture (12 soldiers × 64 days × all 8 rules × PRD defaults) returns `optimal` or `feasible` in <10s
- Two consecutive runs with identical `request_payload` + `random_seed` produce identical assignments (determinism)
- Infeasibility report names affected soldiers + dates, NOT just rule names
- Playwright tests render every (status × error-code) combination distinctly
**Avoids pitfalls:** P3 (solver), P7 (Lowdefy ↔ solver contract drift).
**Research flag:** Needs deeper research during planning — the unsat-core technique extending PRD §7.8 schema; budget extra time.

### Phase 5: Lifecycle features [PARALLEL — 3 sub-agents]
**Rationale:** Three independent surfaces that mutate published assignments through different policies. All depend on Phase 4 publish being live; none depend on each other after that.
**Delivers (parallel):**
- **Swap workflow** — 1-for-1 proposal + counterparty accept/decline + auto-approve when rules pass (with per-soldier overrides applied) + manager review queue otherwise + atomic assignment patch + audit
- **Manager manual override** — unilateral edit post-publish with `force_override` on rule violation + reason field + audit (same audit code path as swap)
- **Time clock** — opt-in per soldier; button (mobile) + manual pickers; midnight-spanning one-row model; NO geofencing
**Avoids pitfalls:** P10 (Draft → Publish UX check — don't make promotion too friction-ful).

### Phase 6: Notifications & reports [PARTIALLY PARALLEL — see below]
**Rationale:** Dispatcher is on critical path for cron-driven reports (cron handler calls dispatcher). PRD §7.11 four channels; per-recipient locale; full `notification_log` audit.
**Build order:**
1. (SEQUENTIAL) `shifty-notification-dispatcher` plugin + Email channel (Resend) with Svix webhook verification + bounce-rate monitoring
2. **(PARALLEL — 3 sub-agents)** WhatsApp (WAHA NOWEB engine; HMAC-SHA512 webhook signing; **dedicated SIM operational prerequisite**) + Web Push (VAPID, no key rotation in v1; `event.waitUntil(showNotification(...))` in service worker for iOS) + in-app inbox
3. (SEQUENTIAL) Webhook receivers (`/api/webhook/resend` Svix-verified, `/api/webhook/waha` HMAC-SHA512) for sent → delivered → bounced status transitions
4. (SEQUENTIAL) `cron` compose service + daily-report 07:00 + weekly-Monday-08:00 + hourly lock-reminder check + 00:05 window archiver + **daily-report make-up logic** (Windows-Update-reboot recovery)
**Avoids pitfalls:** P4 (WAHA — dedicated SIM, `WHATSAPP_RESTART_ALL_SESSIONS=true`, sent-vs-delivered via webhook), P5 (Outlook RTL email + plaintext fallback U+200F prefix), P8 (per-channel atomic logging + dispatcher recovery + locale resolution at event-time).
**Research flag:** Needs research during planning — WAHA webhook integration depth (WAHA-side retries config; `message-status` event consumption beyond `session-status`).

### Phase 7: Polish & exports [PARALLEL — 4 sub-agents + English locale]
**Rationale:** All depend only on published-schedule data being present. Last-mile delight features.
**Delivers (parallel):**
- **Dashboard charts** — Today / Week / Open-requests soldier view; team calendar; **ASCII-bar leaderboard + LTR accessible bar chart** (Playwright parity test — counts must agree); uncovered slots; pending swaps; admin invite-code stats; 4 analytical chart views
- **iCal export** — one-shot + signed long-lived subscription URL with HMAC + per-token revocable from soldier profile + per-token access log + rate-limit (5/min) + `X-Robots-Tag: noindex`
- **CSV export** — UTF-8 BOM for Excel-Hebrew; session-auth (not signed-URL); test against Hebrew Windows locale
- **PDF export** — Puppeteer with `fonts-noto-core` + `fonts-noto-cjk` + `fontconfig` (Hebrew CI test page); A4/A3; DD/MM/YYYY dates
- **English locale completeness** — ICU MessageFormat parity check between `he.json` and `en.json` (`tools/check-locales.mjs` in CI)
**Deliberate v1.1 deferrals from this phase:**
- Gantt-style team timeline (ECharts RTL pain — defer or replace with `vis-timeline` in v1.1)
- Calendar widget via FullCalendar Lowdefy npm plugin (PRD §14 #10 — v1 uses day-list)
- Mobile PWA install prompt (PRD §13.1.1 — iOS Safari supports add-to-home-screen anyway)
**Avoids pitfalls:** P5 (Puppeteer Hebrew fonts; Excel-CSV BOM), P8 (iCal token access log + rate-limit), P10 (ASCII-bar ↔ bar-chart parity).

### Phase M (Tenant #1 migration) — PARALLEL TRACK, NOT ON CRITICAL PATH
**Rationale:** One-off Python script in `tools/migrate-from-sheet/`. Source-of-truth stays on the sheet until migration verified by sample-check. Can develop concurrently with the platform.
**Delivers:** Idempotent migration with smart-quote canonicalization + role-tag-map.json + Soldier-archive bridge for deleted-mid-window names + sample-check script + rollback path.
**Avoids pitfalls:** P9 (timezone interpretation, formula errors, idempotency).

### Phase Ordering Rationale

- **Foundations sequential, no shortcuts.** PRD G5 (zero cross-tenant leak) plus the Lowdefy runtime bus factor make this non-negotiable. The 5-day Lowdefy timebox is a forcing function, not a suggestion.
- **CSV import in Phase 2, not v1.1.** Single-row form doesn't scale beyond 5-10 entries; existing rosters need a one-shot import. Already elevated in PRD; research validates.
- **Phase 4 hardest single milestone.** Solver + draft-publish-edit lifecycle + audit log + UI for 8 (status × error) combinations all converge here. Most likely place a sub-phase research dive pays off.
- **Phase 6 most-likely-first-to-fail.** WAHA self-hosted is the highest delivery-risk dependency. Build fallback (push + email + in-app always present) before WhatsApp confidence is validated.
- **Phases 5, 6, 7 have explicit parallelism.** Roadmapper should structure these phases as parent-phase + N sub-agent tasks per the markers above.

### Research Flags

| Phase | Needs further research during planning? | Reason |
|-------|----------------------------------------|--------|
| **Phase 1 (Foundations)** | SMOKE TEST first | Lowdefy runtime open question may already be resolved at `b8afba1`; smoke test before allocating 5-day fix budget |
| **Phase 2 (Org & people)** | Standard patterns | CRUD + CSV import are well-trodden; FEATURES + ARCHITECTURE provide enough |
| **Phase 3 (Availability & rules)** | Standard patterns | Hybrid availability UI is uncommon but PRD §7.5 fully specifies it; rule config is YAML-driven |
| **Phase 4 (Solver)** | Deep research needed | Unsat-core technique (`SufficientAssumptionsForInfeasibility`) extends PRD §7.8 schema; CP-SAT encoding for `min_rest_hours_between_shifts` perf-pre-filter; rule defaults need feasibility-tuning against kibbutz fixture |
| **Phase 5 (Lifecycle)** | Standard patterns | Swap + override + time-clock are well-defined in PRD §7.7/7.9/7.10 |
| **Phase 6 (Notifications)** | Research needed | WAHA webhook depth (`message-status` events); dispatcher backpressure/queueing semantics under fan-out; Outlook RTL email Litmus testing harness |
| **Phase 7 (Polish & exports)** | Research for ECharts | ECharts RTL workaround quality in practice; reassess Gantt necessity; Puppeteer concurrency limits |
| **Phase M (Migration)** | Standard patterns | One-off Python; well-understood; not on critical path |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | Every version pin verified against npm registry / PyPI / GitHub releases on 2026-05-12; the in-repo `.claude/skills/lowdefy/` skill cross-checks. Only MEDIUM is the ECharts RTL strategy (no canonical Hebrew + ECharts case study — confirmed via the open ECharts RTL issue and inference from other RTL libraries) |
| **Features** | MEDIUM-HIGH | HIGH on category norms (multiple competitor sources converge — When I Work, Deputy, Sling, Shiftboard, Snap Schedule, Connecteam, Homebase, Workforce.com all examined); LOW on direct miluim competition (no direct competitor found — confirms the wedge, doesn't undermine it) |
| **Architecture** | HIGH for PRD-locked decisions; MEDIUM for Lowdefy-specific patterns | The 5-service compose layout and direction-of-calls invariant are PRD-locked; the Lowdefy plugin patterns (custom request plugin for dispatcher + RBAC layer-4) are MEDIUM because there's no canonical reference — verified via [Lowdefy discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409) and the in-repo skill |
| **Pitfalls** | HIGH | All ecosystem-specific findings corroborated by primary issue trackers ([next.js#48017](https://github.com/vercel/next.js/issues/48017), [or-tools#3590](https://github.com/google/or-tools/issues/3590), WAHA docs, Outlook RTL bug reports). MEDIUM only on precise contingency thresholds (15msg/min WAHA rate-limit, 5-day Lowdefy timebox — these are recommendations not industry constants) |

**Overall confidence:** MEDIUM-HIGH. The PRD is unusually well-developed (1687 lines, locked decisions, named risks), and the stack is already in place. The remaining uncertainty is concentrated in (a) the Lowdefy runtime smoke test, (b) the assumption-based unsat-core implementation feasibility against PRD's solve-time budget, and (c) the in-practice severity of ECharts RTL pain.

### Gaps to Address

- **Lowdefy runtime smoke test outcome** — Phase 1 first task. If `b8afba1` resolved the blocker, no contingency needed. If not, the 5-day timebox + escape hatch logic activates.
- **Today-view-bug capture from the user** — Phase D prerequisite per Pitfall 10. Without explicit user input on "what broke about the today view in the prior-art sheet?", the bug-free-today-view requirement is unfalsifiable. Ask the user during Phase D planning; capture in `docs/PRIOR_ART_BUGS.md`.
- **Migration script tenant-#1 sample-check protocol** — Phase M deliverable per Pitfall 9. User must run sample-check.py and confirm before migration is considered complete.
- **Hpg5 OPS runbook (`docs/OPERATIONS.md`)** — Pitfall 6 prerequisite. Should be drafted during Phase 1 with sections for: Windows Update active hours, VHDX compaction quarterly, AV exclusions, Cloudflared user account, Tailscale-bound WAHA UI port, dedicated WAHA SIM number, backup self-test verification.
- **Auth model decision (PRD §15 open)** — magic-link via Resend is the current direction; revisit if SSO becomes useful. No gap for v1.
- **Calendar widget decision (PRD §15 open)** — v1 ships day-list (per PRD §14 #10); npm-plugin FullCalendar is v1.1.
- **Lowdefy app build distribution (CLAUDE.md open)** — current default is "build on hpg5"; switch to docker-registry push from CI when CI exists. No gap for v1.

---

## Sources

### Primary (HIGH confidence)
- `C:\Projects\shifts manager\docs\PRD.md` — authoritative product spec; §13.1 build dependency graph this SUMMARY extends
- `C:\Projects\shifts manager\.planning\PROJECT.md` — GSD-facing summary; Active/Validated/Out-of-Scope tracking
- `C:\Projects\shifts manager\CLAUDE.md` — deployment realities, hpg5 ops, Lowdefy runtime open question
- `C:\Projects\shifts manager\.claude\skills\lowdefy\` — in-repo Lowdefy skill (`reference/06-operators.md`, `08-auth.md`, `09-plugins.md`, `10-deployment.md`)
- [Lowdefy 5.3.0 release notes](https://github.com/lowdefy/lowdefy/releases)
- [Lowdefy discussion #1409 — request data payload validation](https://github.com/lowdefy/lowdefy/discussions/1409)
- [OR-Tools `shift_scheduling_sat` example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/shift_scheduling_sat.ipynb)
- [OR-Tools #973 — finding infeasible constraints (`SufficientAssumptionsForInfeasibility`)](https://github.com/google/or-tools/issues/973)
- [OR-Tools #3590 — CP-SAT non-determinism with `num_workers > 1`](https://github.com/google/or-tools/issues/3590)
- [WAHA releases + 2026.4 announcement](https://github.com/devlikeapro/waha/releases)
- [WAHA Sessions API + Configuration docs](https://waha.devlike.pro/docs/how-to/config/)
- [Resend webhook verify (Svix)](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [`web-push` README — VAPID + `aes128gcm`](https://github.com/web-push-libs/web-push)
- [`node-cron` v4 migration guide](https://nodecron.com/migrating-from-v3)
- [Next.js #48017 / #65636 / #50072 — pnpm + standalone + Docker symlink class of bugs](https://github.com/vercel/next.js/issues/48017)
- [AWS multi-tenant RLS guide](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Crunchy Data — RLS for tenants in Postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres/)
- [ECharts RTL feature request #19609 (unresolved)](https://github.com/apache/echarts/issues/19609)

### Secondary (MEDIUM confidence)
- Competitor research: When I Work, Sling, Deputy, Shiftboard, Snap Schedule, Connecteam, Workforce.com, Microsoft Shifts, Shyft, Evolia, WorkJam, Homebase — full source list in `.planning/research/FEATURES.md` §8
- Hebrew RTL design: Tomedes, Gett Engineering Medium, PageOneFormula, Placeholder Text — `.planning/research/FEATURES.md` §8 / `.planning/research/STACK.md` §5
- Outlook RTL email bugs: Litmus community discussion 6372, hteumeuleu/email-bugs #97, Microsoft Q&A on Outlook Mac 16.102
- Puppeteer Hebrew fonts: Browserless blog, OneUptime fonts-in-Docker guide
- iOS Web Push 3-notification revocation: progressier dev.to writeup
- AutoShiftPlanner (open-source heuristic), OptaWeb (OptaPlanner), Staffjoy (abandoned) — confirms the open-source wedge

### Tertiary (LOW confidence; verify at implementation)
- Resend SMTP via NextAuth EmailProvider — documented but not exercised in this repo's Lowdefy skill yet; small spike during Foundations
- The 15-msg/min WAHA per-account rate-limit recommendation — based on community guidance, not WhatsApp's published policy
- The 5-day Lowdefy runtime fix timebox — a recommendation forcing function, not an industry constant

---

*Research completed: 2026-05-12*
*Ready for roadmap: yes*
