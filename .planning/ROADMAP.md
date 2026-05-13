# Roadmap: Shifty — Miluim Shift Planning SaaS

## Overview

Shifty's v1 is a Hebrew-RTL, multi-tenant shift-planning SaaS for Israeli reserve units, self-hosted on a single Windows desktop via Docker Compose. The journey runs from a hard-locked **Foundations** phase (Lowdefy runtime + tenancy + RBAC + 5-layer tenant defense + custom-plugin scaffold) through a sequential build of the schedule-producing core (Org & People → Availability & Rules → Solver & Schedule), then fans out into parallel sub-streams for **Lifecycle features**, **Notifications & Reports**, and **Polish & Exports**. A **parallel migration track** for tenant #1's Google Sheet runs alongside the platform build without blocking the critical path. Phase shape follows PRD §13.1 (locked) with architecture-research amendments (Postgres RLS as 5th defense layer; custom Lowdefy request plugin as a Foundations prerequisite; assumption-based unsat-core for solver infeasibility; dedicated SIM as a Phase-6 OPS prerequisite).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Letter phase (M): Parallel track, not on critical path

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundations** - Lowdefy runtime + tenancy + RBAC + 5-layer tenant defense + custom-plugin scaffold + ops baseline (completed 2026-05-12)
- [ ] **Phase 2: Org & People** - Units/teams CRUD, soldier roster CRUD, CSV roster import with smart-quote canonicalization
- [ ] **Phase 3: Availability & Rules** - Shift slots, planning windows, hybrid availability UI, 8-rule catalog with per-soldier tightening
- [ ] **Phase 4: Solver & Schedule** - FastAPI CP-SAT solver with unsat-core infeasibility, draft → publish lifecycle, manager hand-edit
- [ ] **Phase 5: Lifecycle Features** - Swap workflow + manager manual override + time clock (3 parallel sub-streams)
- [ ] **Phase 6: Notifications & Reports** - Dispatcher plugin + Email/WhatsApp/Push/in-app + webhooks + cron service (partially parallel)
- [ ] **Phase 7: Polish & Exports** - Dashboard charts + iCal/CSV/PDF exports + English locale parity (4 parallel sub-streams + locale)
- [ ] **Phase M: Tenant #1 Migration** - Idempotent Google Sheet → Shifty migration tool (parallel track, not on critical path)

## Phase Details

### Phase 1: Foundations
**Goal**: Tenancy, auth, and the 5-layer cross-tenant defense are end-to-end correct — a new user can sign up via magic link, see an empty dashboard scoped to their tenant, and every cross-tenant probe returns 403.
**Depends on**: Nothing (first phase)
**Requirements**: TEN-01, TEN-02, TEN-03, TEN-04, TEN-05, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, I18N-07, PERF-04
**Success Criteria** (what must be TRUE):
  1. A new user signs up via magic-link email, redeems an invite code, lands on an empty dashboard scoped to their tenant; second tenant's data is invisible at every level (page, query, request handler, RLS).
  2. The full migration set 0001–0010 (NextAuth tables in 0002, RLS policies in 0009, audit REVOKEs in 0010) applies via the `migrate/migrate` compose service and re-runs are idempotent.
  3. Playwright cross-tenant pen-test asserts every list/detail/mutation route returns 403 for cross-tenant access; CI grep gate (`tools/check-queries.mjs`) fails the build on any YAML query missing `tenant_id`.
  4. `curl http://hpg5:8080/employees` returns 200 with a live Postgres-backed row visible; no `ERR_MODULE_NOT_FOUND` in container logs across 10 page loads (smoke test).
  5. Nightly `pg_dump` runs via Task Scheduler, off-host copy to neshernas succeeds, and `pg_restore --list` self-test alerts on failure; `docs/OPERATIONS.md` runbook stub exists.
  6. The `shifty-audit-writer` Lowdefy custom request plugin scaffold loads and writes a `schedule_audit` row from a mutating page (proves the plugin pattern that unlocks layer-4 RBAC, dispatcher, webhooks, and signed-URL endpoints downstream).
**Plans**: 5 plans
  - [x] 01-01-PLAN.md — Wave 0 scaffolding + smoke test + migrate compose service + migration 0002 (tenancy + NextAuth schema) [COMPLETE: c422fbb, 0a6dd56, ab23155]
  - [x] 01-02-PLAN.md — Migrations 0003-0007 (shifts/availability/auth/audit/imports) + shifty-audit-writer plugin
  - [x] 01-03-PLAN.md — shifty-auth plugin (NextAuth + KnexAdapter + RLS hook + log-redact stub) + auth pages + migrations 0009 (RLS) + 0010 (audit REVOKEs)
  - [x] 01-04-PLAN.md — Tenant isolation verification (check-queries hardening + 11 Playwright pen-test specs, 45 tests) [COMPLETE: bbed11f, 4277d34, a884e38, f41f826]
  - [x] 01-05-PLAN.md — Ops baseline (backup scripts + Task Scheduler installer + log-redaction middleware + OPERATIONS.md runbook)
**Sequencing notes**: Strictly sequential — no shortcuts. Smoke-test Lowdefy runtime FIRST (CLAUDE.md open question may already be resolved at commit `b8afba1`); 5-day timebox with documented escape hatch (switch to npm, or escalate Lowdefy-lock re-open) if smoke test fails.
**Avoids pitfalls**: P1 (Lowdefy runtime bus factor), P2 (tenant isolation gaps), P6 (hpg5 ops — backup self-test + log redaction).
**Research flag**: SMOKE-TEST Lowdefy runtime FIRST — CLAUDE.md open question may already be resolved at commit `b8afba1`.

### Phase 2: Org & People
**Goal**: Admins and team managers can populate the roster end-to-end — single-row CRUD for small adds and CSV import for bootstrapping a 50-soldier unit in under 10 seconds, with smart-quote bug defenses baked in.
**Depends on**: Phase 1
**Requirements**: ROST-01, ROST-02, ROST-03, ROST-04, ROST-05, ROST-06, ROST-07, ROST-08, ROST-09, ROST-10, ROST-11, ROST-12, ROST-13
**Success Criteria** (what must be TRUE):
  1. Admin creates a 1-3-level org tree (units → platoons → teams), adds soldiers via single-row form, edits seniority/role_tags/notes within team scope, and archives soldiers (preserving historical assignments).
  2. CSV roster import previews row-by-row with ✓/⚠/✗ status, allows inline edits, skips duplicate emails by default with a re-invite opt-in, and writes a summary row to `roster_import_log`.
  3. CSV import canonicalizes smart-quote variants (strips U+2019, U+200E, U+200F, U+202A–U+202E) before writing `soldier.display_name`; a 50-row CSV imports in under 10 seconds and dispatches magic-link invites via Resend.
  4. Each soldier gets a calendar color from the 24-color preset palette (round-robin, no adjacent-color collisions within a team); the soldier can override in profile.
  5. Soldier can be a member of multiple teams within the same tenant via `membership` rows; role tags autocomplete from existing tenant tags but allow new ones (lowercase kebab-case).
**Plans**: 10 plans
  - [x] 02-01-PLAN.md — Wave 0 migrations 0011_role_tag + 0012_org_unit_last_color_index (schema + RLS)
  - [x] 02-02-PLAN.md — Wave 0 shifty-roster plugin scaffold (palette, canonicalize, role-tag helpers + 7 request stubs + unit tests)
  - [x] 02-03-PLAN.md — Wave 1 manage_org_units tree-table upgrade (D-01, D-02, D-04 grow-depth)
  - [x] 02-04-PLAN.md — Wave 1 manage_soldiers admin tenant-wide soldier roster + Add-soldier Modal
  - [x] 02-05-PLAN.md — Wave 1 manage_role_tags read-only autocomplete viewer
  - [ ] 02-06-PLAN.md — Wave 2 soldier_detail + color_swatches block + CreateSoldier/UpdateSoldier/ArchiveSoldier/InviteLater bodies
  - [ ] 02-07-PLAN.md — Wave 2 team_detail (Add/Remove member) + my_profile color override + CreateMembership body
  - [ ] 02-08-PLAN.md — Wave 3 CSV import wizard + ParseCsvAndValidate + CommitRosterImport (Auth.js spike + Resend dispatch loop)
  - [ ] 02-09-PLAN.md — Wave 4 lowdefy.yaml wiring + 0008_legacy_drop (UI ships before migration)
  - [ ] 02-10-PLAN.md — Wave 4 E2E specs (roster-csv-import + soldier-crud + tenant-isolation) + 4 CSV fixtures + phase-gate smoke
**Sequencing notes**: Sequential FK chain — org_unit CRUD → soldier CRUD → role tags + seniority → membership. CSV import path builds in parallel with the single-row form once `soldier.display_name` write semantics are settled.
**Avoids pitfalls**: P5 (CSV direction-mark stripping at write time), P10 (display-name normalization, 24-color palette spec).

### Phase 3: Availability & Rules
**Goal**: Managers and soldiers can fully specify a planning window's inputs — shift slots configured, the window opened with auto-generated shift instances, soldiers declaring availability via the hybrid range-blockout + per-slot UI, and the 8-rule catalog tuned with per-soldier tightenings — so the solver has everything it needs to run.
**Depends on**: Phase 2
**Requirements**: SHFT-01, SHFT-02, SHFT-03, SHFT-04, SHFT-05, SHFT-06, SHFT-07, AVAL-01, AVAL-02, AVAL-03, AVAL-04, AVAL-05, AVAL-06, AVAL-07, AVAL-08, RULE-01, RULE-02, RULE-03, RULE-04, RULE-05, RULE-06, RULE-07
**Success Criteria** (what must be TRUE):
  1. Manager defines `shift_slot` rows using `2x12h` / `3x8h` / Custom templates with required role tags (AND-combined), min seniority, headcount, and midnight-spanning times; opens a `planning_window` with `constraint_lock_at`; `shift_instance` rows auto-generate as the cross-product of (slot × date × headcount_index).
  2. Soldier declares date-range blockouts in under 30 seconds for a 2-week window, drills into individual dates for per-slot toggles on mobile without horizontal scroll, and per-slot overrides take precedence over range-blockouts (precedence: manager_override > per_slot > range_blockout).
  3. Constraint lock prevents writes by non-managers after the lock time; manager writes after lock produce `schedule_audit` rows with `to_state=availability_manager_override`; soldiers joining mid-window default to "available" and can declare up to the lock.
  4. Manager toggles all 8 rules with numeric limits via UI form (changes immediately consumed by next solver run); per-soldier overrides can ONLY tighten (boolean false→true and integer-lower); loosening is silently ignored with a UI warning showing team baseline alongside the soldier's tightening.
  5. Rule semantics are encoded (not just documented): "Weekend" hardcoded to Friday+Saturday for `weekend_separation`; `fairness_objective` defaults to `count_variance` and acts as the solver's minimization target, with hard rules as constraints.
**Plans**: TBD
**Sequencing notes**: Sequential within phase — shift_slot CRUD → planning_window + shift_instance generation → availability UI → rules config UI. The 24h-pre-lock notification (AVAL-09) is wired in Phase 6 since it requires the dispatcher.
**Avoids pitfalls**: P10 (preserve prior-art beloved feature — availability declaration must be fast).

### Phase 4: Solver & Schedule
**Goal**: A manager triggers the solver from an `open` planning window and gets back a draft schedule that respects all 8 active rules — or, if infeasible, an actionable Hebrew report naming affected soldiers and dates. The manager can hand-edit the draft (rule violations highlighted but non-blocking) and publish it, locking the schedule as the source of truth for swap proposals.
**Depends on**: Phase 3
**Requirements**: SOLV-01, SOLV-02, SOLV-03, SOLV-04, SOLV-05, SOLV-06, SOLV-07, SOLV-08, SOLV-09, SOLV-10, LIFE-01, LIFE-02, LIFE-03, LIFE-04, PERF-01
**Success Criteria** (what must be TRUE):
  1. Manager runs the solver from an `open` planning window; window transitions to `draft`; assignments respect all 8 PRD rules at default values; `solver_run` row persisted with `request_payload` (including server-generated `random_seed`) and `response_payload`.
  2. Kibbutz fixture (12 soldiers × 64-day window × all 8 rules × PRD defaults) returns `optimal` or `feasible` in under 10 seconds — gated in CI; two consecutive runs with identical input + seed produce bit-for-bit identical assignments (`num_search_workers=1` pinned).
  3. On infeasibility, the report names affected soldier IDs and dates per offending rule (via `solver.SufficientAssumptionsForInfeasibility()`), with a Hebrew explanation — not just a flat rule-name list.
  4. Solver authenticates with `Bearer SOLVER_SHARED_SECRET`, is bound to the internal docker network only (no host port), returns HTTP 504 `TIMEOUT` / 400 `INVALID_INPUT` / 413 `WINDOW_TOO_LARGE` envelopes correctly; Playwright renders each of the 4 statuses × 4 error codes distinctly in the UI.
  5. Manager hand-edits draft via drag-drop or row-edit (rule violations highlighted but non-blocking); publish transition (`draft → published`) writes `schedule_audit` row and stages `schedule.published` notifications (actually fired in Phase 6); assignment table becomes the source of truth.
**Plans**: TBD
**Sequencing notes**: Sequential — stateless `/solve` + kibbutz-fixture CI test → Lowdefy wiring + `solver_run` persistence → draft page → manager hand-edit → publish transition. The solver service itself is the highest-risk single milestone.
**Avoids pitfalls**: P3 (solver determinism + infeasibility actionability + scaling), P7 (Lowdefy ↔ solver contract drift).
**Research flag**: Needs deeper research during planning — unsat-core technique extending PRD §7.8 schema (`SufficientAssumptionsForInfeasibility()`); CP-SAT encoding for `min_rest_hours_between_shifts` perf-pre-filter; rule-defaults feasibility-tuning against kibbutz fixture. Budget extra time.

### Phase 5: Lifecycle Features
**Goal**: Once a schedule is published, it becomes a living document — soldiers propose 1-for-1 swaps that auto-approve when rules pass with per-soldier overrides applied, managers unilaterally override assignments post-publish (with audited reason + force_override on rule violations), and soldiers opt-in to a mobile-friendly time clock that captures actual worked hours without geofencing.
**Depends on**: Phase 4 (publish state must exist)
**Requirements**: SWAP-01, SWAP-02, SWAP-03, SWAP-04, SWAP-05, SWAP-06, SWAP-07, LIFE-05, LIFE-06, LIFE-07, LIFE-09, CLCK-01, CLCK-02, CLCK-03, CLCK-04, CLCK-05, CLCK-06, CLCK-07
**Success Criteria** (what must be TRUE):
  1. Soldier A proposes a 1-for-1 swap with soldier B's published assignment; B accepts in their in-app inbox; if zero rule violations with per-soldier overrides applied to BOTH soldiers, the swap auto-approves, assignments are patched atomically, and `swap.approved` notifications stage for A, B, and the manager.
  2. If swap rules don't pass, the swap moves to `pending_manager`; the manager queue shows the swap, the specific violated rules, and approve/reject controls; state history is captured in `swap_request.state_history JSONB`.
  3. Manager post-publish manual override edits any assignment cell (replace soldier or clear); the UI validates against active rules with per-soldier overrides applied, surfaces inline rule names on violation, captures "Override anyway" as `payload.force_override: true` + reason; writes `schedule_audit` row with `to_state=manager_override`; affected soldiers (removed + added) notified within 60s.
  4. Audit log UI surfaces "manual override by {manager}" distinctly from "approved swap" entries — same audit table, different display.
  5. Soldier opts in to time clock; big mobile-friendly "Check in" / "Check out" (כניסה / יציאה) button captures `now()`; midnight-spanning entries stored as one row crossing the date boundary; manual time pickers allow create/amend; `source` distinguishes `button` vs `manual`; no location data captured.
**Plans**: TBD
**Parallelism**: 3 PARALLEL SUB-STREAMS — Swap workflow, Manager manual override, Time clock. All depend on Phase 4 publish being live; none depend on each other after that. Sub-agents can build concurrently.
**Avoids pitfalls**: P10 (Draft → Publish UX shouldn't be friction-ful; override audit must be visibly distinct from swap).

### Phase 6: Notifications & Reports
**Goal**: Every system event in the PRD §7.11 catalog (16 event types) fires to the correct channels per recipient preferences and locale, with delivery confirmed via webhooks (not assumed from HTTP 200), full audit in `notification_log`, and cron-driven daily/weekly reports that survive a Windows-reboot via make-up logic.
**Depends on**: Phase 4 (publish events to notify); Phase 5 (swap + override events to notify)
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06, NOTF-07, NOTF-08, NOTF-09, NOTF-10, NOTF-11, NOTF-12, RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, AVAL-09, LIFE-08
**Success Criteria** (what must be TRUE):
  1. The `shifty-notification-dispatcher` custom Lowdefy request plugin loads per-user preferences and locale, fans out to Email (Resend) / WhatsApp (WAHA NOWEB) / Web Push (VAPID) / in-app inbox per `notification_pref`, retries failures with exponential backoff (1s, 4s, 16s), and meets SLOs (Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant).
  2. `notification_log.status` transitions through webhooks (Resend Svix-verified, WAHA HMAC-SHA512) — `queued → sent → delivered → bounced`; never declared "sent" on HTTP 200 alone.
  3. Hebrew email template renders with `dir="rtl"` on body, plaintext fallback prefixes lines with U+200F; Litmus snapshots cover Outlook 2013/2016/2019 + Mac; service worker at `app/public/sw.js` registers on first load; 410 Gone from push service deletes the subscription row; WAHA dashboard UI is bound to Tailscale only (never the public tunnel) with a dedicated SIM separate from the user's personal number.
  4. Cron compose service fires daily report at 07:00 Israel, weekly Monday digest at 08:00, hourly lock-reminder check that fires `availability.lock_approaching` 24h before `constraint_lock_at`, and 00:05 window archiver that auto-closes windows on `end_date + 1 day`; daily-report make-up logic backfills missed fires after a Windows Update reboot.
  5. Each recipient (including login-less P4 auditor recipients in `report_recipient`) gets messages in their stored locale at send time; daily-email layout preserves prior-art "Hebrew daily email" shape (RTL header, today's assignments grouped by team/slot, soldiers-not-assigned list, link to today's calendar view).
**Plans**: TBD
**Parallelism**: PARTIALLY PARALLEL — Sequential phase 1 (dispatcher plugin + Email channel + Svix webhook + bounce-rate monitoring) → PARALLEL phase 2 (3 sub-streams: WhatsApp + Web Push + in-app inbox) → Sequential phase 3 (webhook receivers for sent → delivered → bounced) → Sequential phase 4 (cron service + daily/weekly/lock-reminder/window-archiver with make-up logic).
**OPS prerequisite (call out at planning time)**: WAHA needs a dedicated SIM separate from the user's personal number — the personal-number-drop cycle is daily-frequency once the user does anything on WhatsApp Web. Document in `docs/OPERATIONS.md` before WAHA goes live.
**Avoids pitfalls**: P4 (WAHA session drops + rate limits + sent-vs-delivered), P5 (Outlook RTL email + plaintext U+200F prefix), P8 (per-channel atomic logging + dispatcher recovery + locale resolution at event-time), P10 (daily email layout preserves prior art).
**Research flag**: Needs research during planning — WAHA webhook depth (`message-status` events beyond `session-status`; WAHA-side retries config); dispatcher backpressure/queueing semantics under fan-out; Outlook RTL email Litmus testing harness.

### Phase 7: Polish & Exports
**Goal**: The last-mile delight features that make Shifty beat the spreadsheet — soldier/manager/admin dashboards with the ASCII-bar leaderboard + accessible bar chart twin, four analytical chart views, iCal one-shot + signed-subscription exports, Excel-Hebrew-compatible CSV, A4/A3 Hebrew PDF via Puppeteer with bundled Noto fonts, and full English locale parity enforced in CI.
**Depends on**: Phase 6 (notifications need to be wired; chart data needs published schedules)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, EXPT-01, EXPT-02, EXPT-03, EXPT-04, EXPT-05, EXPT-06, EXPT-07, EXPT-08, I18N-01, I18N-02, I18N-03, I18N-04, I18N-05, I18N-06, A11Y-01, A11Y-02, A11Y-03, A11Y-04, PERF-02, PERF-03
**Success Criteria** (what must be TRUE):
  1. Soldier dashboard shows today / this week (7-day calendar with their color highlighted) / open requests (inbound + outbound swaps) / constraint status / time clock button; manager dashboard adds team calendar + ASCII-bar leaderboard + LTR accessible bar chart (Playwright parity test — counts agree) + uncovered slots in next 7 days + pending-swap queue; admin dashboard aggregates manager view across teams + invite-code stats. Per-soldier punctuality shows "אין נתונים" when records are missing, never silently zero.
  2. Four analytical chart views render: Unit-level (active-window totals, coverage %, slot distribution, swap counts, top-swapped soldiers), Team-level (same scoped to team — Gantt **DEFERRED to v1.1** per ECharts RTL limitation), Per-soldier (current+cumulative shifts, slot-type breakdown, swap history, punctuality, monthly sparkline), Leaderboard (ASCII bars paired with LTR accessible bar chart).
  3. iCal export — one-shot download generates `.ics` with `VEVENT` per assignment, `Asia/Jerusalem` baked in; per-soldier signed subscription URL backed by `ical_subscription_token` (HMAC, revocable from soldier profile, rate-limited 5/min, access-logged, `X-Robots-Tag: noindex`); opens in Google Calendar / Apple Calendar / Outlook without warnings.
  4. CSV export is UTF-8 with BOM (opens in Excel-on-Windows with Hebrew names intact); PDF export is Puppeteer-rendered Hebrew RTL calendar grid with `fonts-noto-core` / `fonts-noto-cjk` / `fontconfig` (CI test page asserts no tofu glyphs), DD/MM/YYYY dates, A4 default + A3 option, prints without clipping; each export generates in under 5 seconds for a 30-soldier × 30-day window.
  5. English locale (`en.json`) is at parity with Hebrew (`he.json`) — CI gate `tools/check-locales.mjs` fails the build on any missing key in either direction; Lowdefy `config.theme.direction` flips per-request based on `app_user.locale`; dates format from locale (he → DD/MM/YYYY, en → YYYY-MM-DD); Latin numerals in both locales; WCAG 2.1 AA on interactive elements with keyboard navigation and color never being the only signifier (uncovered slots flagged with both red and a warning icon).
**Plans**: TBD
**Parallelism**: 4 PARALLEL SUB-STREAMS + LOCALE — Dashboard charts, iCal export, CSV+PDF exports, English locale parity. All depend only on published-schedule data being present.
**Deliberate v1.1 deferrals** (out of this phase's scope): Gantt-style team timeline (ECharts RTL pain — replace with `vis-timeline` in v1.1 or drop), FullCalendar Lowdefy npm plugin (v1 uses simpler day-list view), Mobile PWA install prompt (iOS Safari supports add-to-home-screen natively).
**Avoids pitfalls**: P5 (Puppeteer Hebrew fonts; Excel-CSV BOM), P8 (iCal token access log + rate-limit), P10 (ASCII-bar ↔ bar-chart parity preserves prior art).
**Research flag**: Reassess Gantt necessity at planning time — ECharts RTL feature request #19609 is unresolved; Puppeteer concurrency limits under simultaneous PDF generation; `vis-timeline` viability as ECharts Gantt replacement.
**UI hint**: yes

### Phase M: Tenant #1 Migration (INSERTED — parallel track, not on critical path)
**Goal**: The user's existing Google Sheet (12 soldiers, 1 team, ongoing window) is imported into Shifty's schema idempotently, with smart-quote canonicalization at write time, sample-check verification against a real week, and a tested rollback path — so the user can switch their unit from the sheet to Shifty without losing data.
**Depends on**: Phase 2 (Roster CSV import path), Phase 3 (availability_blockout, rules), Phase 4 (assignment table)
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05, MIGR-06
**Success Criteria** (what must be TRUE):
  1. One-off Python CLI in `tools/migrate-from-sheet/` reads Google Sheet `1GlT_Qu4Fi3gl0qSMp798mg0wKEEG1_-iSNrVjQkV8wI` via `gviz/tq?tqx=out:csv&gid=<tab_gid>`; migrates soldiers from `groups` tab through the Roster CSV Import path, constraints from rows 14–29 to `availability_blockout`, rules from `settings` tab to team `rule` rows, existing assignments to `assignment` rows with `schedule_audit.payload.source='imported'`.
  2. Smart-quote canonicalization happens at write time (strips U+2019 etc.); SQL `INSERT`s are emitted ordered by FK dependency (tenant → org_unit → soldier → shift_slot → planning_window → shift_instance → availability → assignment → rule).
  3. Two consecutive runs of the migration on the same input produce byte-equal DB state (idempotent — no duplicates).
  4. User runs sample-check script comparing a sample week's schedule between sheet and Shifty side-by-side; rollback path via `TRUNCATE` on the tenant's rows is tested and works.
  5. On successful verification, the original sheet is set to read-only at the Drive level and Shifty becomes canonical; tool is deleted from `tools/` after tenant #1 confirms success.
**Plans**: TBD
**Parallelism**: PARALLEL TRACK — Not on critical path for v1 launch. Sub-agent can develop concurrently with Phases 2–7 once dependencies are ready.
**Avoids pitfalls**: P9 (timezone interpretation in sheet → DB; formula-error data; idempotency under re-runs).

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Phase M runs in parallel with 2–7 once its dependencies (Phase 2 import path + Phase 3 availability tables + Phase 4 assignment table) are in place.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 5/5 | Complete   | 2026-05-12 |
| 2. Org & People | 2/10 | In progress | - |
| 3. Availability & Rules | 0/TBD | Not started | - |
| 4. Solver & Schedule | 0/TBD | Not started | - |
| 5. Lifecycle Features | 0/TBD | Not started | - |
| 6. Notifications & Reports | 0/TBD | Not started | - |
| 7. Polish & Exports | 0/TBD | Not started | - |
| M. Tenant #1 Migration | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-12*
*Source: PRD §13.1 (locked) + research/SUMMARY.md amendments + REQUIREMENTS.md v1 scope*
*Granularity: standard; Parallelization: enabled*
