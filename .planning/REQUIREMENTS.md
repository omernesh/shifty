# Requirements: Shifty

**Defined:** 2026-05-12
**Core Value:** Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks, in a Hebrew-first RTL UI.
**Source:** `docs/PRD.md` (1687 lines, authoritative). PROJECT.md and research (`SUMMARY.md`) shape Active scope.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases via Traceability (populated by roadmapper).

### Tenant & Org Management (PRD §7.1)

- [x] **TEN-01**: Anyone with a valid email can self-sign-up and create a tenant; founding admin's account becomes `unit_admin` automatically without an invite code
- [x] **TEN-02**: At tenant creation, admin chooses org depth (1, 2, or 3 levels); depth is immutable except by adding deeper levels
- [x] **TEN-03**: Admin can add, rename, and delete org units within their unit's tree (`org_unit` rows with self-referential `parent_id`; leaf nodes are where teams/schedules live)
- [x] **TEN-04**: Admin can view the org tree across all teams in their unit
- [x] **TEN-05**: All schedules and assignments live at the leaf (team) level always; a 1-level org has its root as the team

### Authentication & Invite Codes (PRD §7.2)

- [x] **AUTH-01**: User signs up via NextAuth EmailProvider magic link delivered by Resend (no passwords)
- [x] **AUTH-02**: Sessions stored in HTTP-only secure cookies; CSRF protection on all state-changing endpoints
- [x] **AUTH-03**: Admin can generate invite code for a specific `(org_unit_id, role)` pair, optionally with `expires_at` and `max_uses`
- [x] **AUTH-04**: Invite codes are 8 chars Crockford base32 (no I, L, O, U), case-insensitive on redemption, copyable to clipboard
- [x] **AUTH-05**: User redeems invite code on first sign-in; creates `membership` row tying soldier to org unit with target role; audit row written to `invite_code_redemption`
- [x] **AUTH-06**: Revoked, expired, or used-up invite codes reject redemption with a Hebrew error message
- [x] **AUTH-07**: Four-role RBAC matrix enforced server-side per PRD §8.3 (`unit_admin`, `team_manager`, `member`, `viewer`); session carries `tenant_id`, `roles`, `team_ids`, `locale`

### People & Roster (PRD §7.3, §7.3.1)

- [ ] **ROST-01**: Soldier entity has `id` (UUID PK), `tenant_id`, `display_name`, `color` (hex), `seniority` (0-10), `role_tags` (TEXT[]), `phone_e164` (nullable), `status` (`active`/`archived`), `notes` (manager-visible only)
- [x] **ROST-02**: All joins use UUID; display names are mutable and NEVER used as join keys (smart-quote bug defense)
- [ ] **ROST-03**: Admin can CRUD soldiers at unit level; team manager can edit seniority/role_tags/notes within their team scope
- [ ] **ROST-04**: Soldier can be a member of multiple teams within the same tenant via `membership` rows
- [ ] **ROST-05**: Archived soldiers preserve historical assignments; absent from pickers and rosters
- [x] **ROST-06**: Color assigned from 24-color preset palette (round-robin, avoiding adjacent-color collisions within team); soldier can override in profile
- [x] **ROST-07**: Role tags are tenant-defined, lowercase kebab-case (`medic`, `driver`); UI autocompletes from existing tags but allows new ones
- [ ] **ROST-08**: Admin or team_manager uploads CSV at "Roster import" page with required columns `name, email, role_tags, seniority, team_id`
- [ ] **ROST-09**: CSV import previews row-by-row with per-row validation status (✓/⚠/✗), allowing inline edits before confirm
- [ ] **ROST-10**: Duplicate emails within tenant flagged and skipped by default; manager can opt to re-invite (regenerates magic link)
- [x] **ROST-11**: Import canonicalizes smart-quote variants in names (strips U+2019, U+200E, U+200F, U+202A-U+202E) before writing `soldier.display_name`
- [ ] **ROST-12**: Import dispatches magic-link invite emails via Resend; writes summary row to `roster_import_log` with rows_created/skipped/errored + JSON error details
- [ ] **ROST-13**: A 50-row CSV imports in <10 seconds

### Teams & Shift Schemas (PRD §7.4)

- [ ] **SHFT-01**: Manager defines `shift_slot` rows per team with `name` (Hebrew default), `start_time`/`end_time` (TIME, may cross midnight), `headcount` (≥1), `required_role_tags`, `min_seniority`, `display_order`
- [ ] **SHFT-02**: Team creation offers templates: `2x12h` (06:00-18:00 בוקר + 18:00-06:00 לילה), `3x8h` (בוקר/ערב/לילה), and Custom
- [ ] **SHFT-03**: `required_role_tags` are AND-combined; soldier must have ALL listed tags to be eligible
- [ ] **SHFT-04**: `min_seniority` uses `>=` comparison; NULL = no requirement
- [ ] **SHFT-05**: Headcount > 1 produces N parallel `shift_instance` rows for the same slot+date with different `headcount_index`
- [ ] **SHFT-06**: Manager opens a `planning_window` (start_date, end_date, constraint_lock_at); `shift_instance` rows auto-generate as cross-product of (slot × date × headcount_index)
- [ ] **SHFT-07**: Default `constraint_lock_at` is 3 days before window start, admin-configurable per window

### Availability & Constraints (PRD §7.5)

- [ ] **AVAL-01**: Every soldier × shift_instance defaults to `available` when a window opens
- [ ] **AVAL-02**: Soldier can declare date-range blockouts in <30 seconds for a 2-week window (UI primitive: from/to date picker)
- [ ] **AVAL-03**: Soldier can drill into a single date and toggle individual slot availability (per-slot override)
- [ ] **AVAL-04**: Per-slot overrides take precedence over range-blockouts; manager overrides take precedence over both (`availability.source ∈ {range_blockout, per_slot, manager_override}`)
- [ ] **AVAL-05**: Per-slot drill-down works on mobile with no horizontal scroll
- [ ] **AVAL-06**: Constraint lock (`planning_window.constraint_lock_at`) prevents writes by non-managers after the lock time
- [ ] **AVAL-07**: Manager can write availability after lock; every write produces a `schedule_audit` row with `to_state=availability_manager_override`
- [ ] **AVAL-08**: Soldier joining mid-window defaults to "available" for remaining instances; can declare constraints up to the lock
- [ ] **AVAL-09**: 24h before `constraint_lock_at`, `availability.lock_approaching` notification fires to all team soldiers who haven't fully declared

### Rules Engine (PRD §7.6)

- [ ] **RULE-01**: Rule catalog frozen at 8 rules: `no_same_day_double`, `no_consecutive_shift2_then_shift1`, `max_consecutive_nights` (default 3), `weekend_separation`, `max_weekly_hours` (default 60), `min_rest_hours_between_shifts` (default 8), `max_shifts_per_period`, `fairness_objective` (enum: `count_variance`/`hours_variance`/`night_variance`/`off`, default `count_variance`)
- [ ] **RULE-02**: Rule rows persisted in `rule` table per team with `rule_key`, `enabled`, `value` JSONB
- [ ] **RULE-03**: Manager toggles rules and sets numeric limits via UI form; changes immediately consumed by next solver run
- [ ] **RULE-04**: Per-soldier overrides persisted in `rule_override` table; can ONLY tighten the team-level rule (boolean false→true and integer-lower); loosening is silently ignored with a UI warning
- [ ] **RULE-05**: Per-soldier override UI shows team baseline alongside the soldier's tightening
- [ ] **RULE-06**: "Weekend" hardcoded to Friday+Saturday for `weekend_separation` (Israeli weekend, v1)
- [ ] **RULE-07**: `fairness_objective` is the solver's minimization target; hard rules are constraints, fairness is variance-minimized; `off` = feasibility-only

### Solver Service (PRD §7.8)

- [ ] **SOLV-01**: FastAPI service exposes `POST /solve` with the JSON request schema from PRD §7.8 (draft-07: tenant_id, team_id, window, shift_slots, soldiers, availability, rules, rule_overrides, max_seconds, random_seed)
- [ ] **SOLV-02**: Solver returns response with `status` (`optimal`/`feasible`/`infeasible`/`error`), `solver_run_id`, `solve_time_seconds`, `assignments`, `soldier_shift_counts`, `objective_value`, `infeasibility_report`
- [ ] **SOLV-03**: Solver is stateless — does not read or write the database; Lowdefy owns request assembly and response persistence to `solver_run`
- [ ] **SOLV-04**: Solver authenticates with `Bearer SOLVER_SHARED_SECRET`; bound to internal docker network only (no host port)
- [ ] **SOLV-05**: p95 solve latency <10 seconds for 30 soldiers × 30 days × 4 active rules
- [ ] **SOLV-06**: Determinism — same input + same `random_seed` produces bit-for-bit identical output (`num_search_workers=1` pinned in v1)
- [ ] **SOLV-07**: Infeasibility response includes `offending_rules` extended via `solver.SufficientAssumptionsForInfeasibility()` with affected soldier IDs and dates per offending rule, plus Hebrew explanation; flat rule-name list is insufficient for a non-technical מפקד
- [ ] **SOLV-08**: Solver returns HTTP 504 with `TIMEOUT` error envelope if `max_seconds` elapses with no feasible result; HTTP 400 `INVALID_INPUT` for unknown soldier/slot IDs; HTTP 413 `WINDOW_TOO_LARGE` over scalability ceiling
- [ ] **SOLV-09**: `random_seed` is hidden from manager UI; Lowdefy generates server-side and persists to `solver_run.request_payload`
- [ ] **SOLV-10**: Kibbutz fixture (12 soldiers × 64-day window × all 8 rules × PRD defaults) returns `optimal` or `feasible` in <10s — CI gate

### Schedule Lifecycle (PRD §7.7)

- [ ] **LIFE-01**: `planning_window.state` transitions follow `open → draft → published → closed`; every transition writes `schedule_audit` row with `from_state`, `to_state`, `actor_user_id`, `actor_kind`, `payload`
- [ ] **LIFE-02**: Solver run on `open` window transitions to `draft` and writes assignments
- [ ] **LIFE-03**: Manager can hand-edit draft via drag-drop or row-edit; rule violations highlighted but not blocking
- [ ] **LIFE-04**: Publish transition (`draft → published`) fires `schedule.published` notifications to every assigned soldier; assignment table becomes source of truth for swap proposals
- [ ] **LIFE-05**: Post-publish manager manual override: manager edits any assignment cell (replace soldier or clear); writes `schedule_audit` row with `payload={previous_value, new_value, reason}` and `to_state=manager_override`
- [ ] **LIFE-06**: Manager override validates against team's active rules WITH per-soldier overrides applied; violation surfaces inline rule names; "Override anyway" click captured in `payload.force_override: true`
- [ ] **LIFE-07**: Affected soldiers (removed + added) notified via `schedule.manual_override` on all preferred channels within 60 seconds
- [ ] **LIFE-08**: Window auto-closes on `end_date + 1 day` via cron; closed windows immutable except for time-clock corrections
- [ ] **LIFE-09**: Audit log UI surfaces "manual override by {manager}" distinctly from "approved swap" entries

### Swap Requests (PRD §7.10)

- [ ] **SWAP-01**: Initiator soldier picks one of their own published assignments AND one of another soldier's assignments (1-for-1 swap only in v1)
- [ ] **SWAP-02**: `swap_request` row created with `state=proposed`; counterparty notified via `swap.proposed` on all channels
- [ ] **SWAP-03**: Counterparty accepts or declines via in-app inbox; accept transitions to `awaiting_mgr` or directly to `approved` if auto-approve-eligible
- [ ] **SWAP-04**: Auto-approve eligibility evaluated against team's active rules WITH per-soldier overrides applied to BOTH soldiers; zero violations → state=approved + assignment patch + notifications
- [ ] **SWAP-05**: If violations exist, swap moves to `pending_manager`; manager queue shows the swap, violated rules, and approve/reject controls
- [ ] **SWAP-06**: On approval (manual or auto), assignments table is patched atomically; `schedule_audit` row written; `swap.approved` notifications fire to A, B, manager
- [ ] **SWAP-07**: State history captured in `swap_request.state_history JSONB` as array of `{from, to, actor, at, payload}` entries

### Time Clock (PRD §7.9)

- [ ] **CLCK-01**: Soldier can opt in via `soldier.time_clock_enabled = true`
- [ ] **CLCK-02**: Big mobile-friendly button toggles between "Check in" (כניסה) and "Check out" (יציאה); tap captures `now()`
- [ ] **CLCK-03**: Manual time pickers let soldier type/pick start and end times to create or amend a `time_clock_entries` row
- [ ] **CLCK-04**: Midnight-spanning entries stored as one row with `started_at` and `ended_at` crossing the date boundary (timestamptz handles it; no special split logic)
- [ ] **CLCK-05**: Soldier can edit a past entry's times; manager can view team-level time-clock summary
- [ ] **CLCK-06**: NO location data captured (no geofencing)
- [ ] **CLCK-07**: `time_clock_entries.source` distinguishes `button` vs `manual`; `assignment_id` nullable for linking to a shift instance; `note` field optional

### Notifications (PRD §7.11)

- [ ] **NOTF-01**: Four channels supported: Email (Resend), WhatsApp (WAHA), Web Push (VAPID), in-app inbox
- [ ] **NOTF-02**: Every system event in PRD §7.11 catalog (invite.sent, signup.welcome, availability.lock_approaching, availability.locked, schedule.draft_ready, schedule.published, schedule.manual_override, swap.proposed, swap.accepted_by_counterparty, swap.declined, swap.approved, swap.rejected, report.daily_briefing, report.weekly_digest, waha.session_down, cron.failure) fires the matching notification with PRD-listed default channels
- [ ] **NOTF-03**: Per-user × per-event channel preferences persisted in `notification_pref` (user_id, event_type, channels JSONB); user toggles channels in profile UI
- [ ] **NOTF-04**: Each user's preferred locale stored on `app_user.locale` (defaults from `APP_DEFAULT_LOCALE=he`); outbound notifications use the recipient's locale at send time
- [ ] **NOTF-05**: Dispatcher implemented as a custom Lowdefy request plugin (`app/plugins/shifty-notification-dispatcher/`); loads per-user prefs + locale, builds message, dispatches to each channel
- [ ] **NOTF-06**: Every delivery logged to `notification_log` with `status ∈ {queued, sent, delivered, failed, bounced}` and `provider_response`; status transitions through webhooks (Resend Svix-verified, WAHA HMAC-SHA512) — never declared "sent" on HTTP 200 alone
- [ ] **NOTF-07**: Failed sends retry up to 3 times with exponential backoff (1s, 4s, 16s)
- [ ] **NOTF-08**: Delivery SLOs: Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant
- [ ] **NOTF-09**: Each event has Hebrew and English template files in `app/templates/`; Hebrew templates use `dir="rtl"` on body; plaintext fallback for emails uses U+200F prefix to set Hebrew base direction
- [ ] **NOTF-10**: VAPID public/private/subject keys stored in env vars; service worker at `app/public/sw.js` registered on first load; 410 Gone from push service deletes the subscription row
- [ ] **NOTF-11**: Phone number stored on `soldier.phone_e164` (E.164 format) for WhatsApp delivery; soldier opts in by providing number and enabling WhatsApp channel
- [ ] **NOTF-12**: WAHA dashboard UI bound to Tailscale interface only (never public Cloudflare tunnel); WhatsApp account uses dedicated SIM separate from user's personal number

### Reporting (PRD §7.12)

- [ ] **RPT-01**: Daily email fires at admin-configured hour (default 07:00 Israel) to subscribed recipients in their preferred locale
- [ ] **RPT-02**: Daily report content: date header (RTL for Hebrew), today's assignments grouped by team and slot, soldiers not assigned today with their constraints (`constraint_summary`), link to today's calendar view
- [ ] **RPT-03**: Weekly Monday digest fires at admin-configured hour (default 08:00 Israel); content includes week range, day-by-day mini-table, leaderboard with ASCII bars, uncovered slots flagged red
- [ ] **RPT-04**: Recipients managed in `report_recipient` rows with `email`, `display_name`, optional `locale`, `subscriptions JSONB`
- [ ] **RPT-05**: External (email-only, login-less) recipients supported for P4 auditor persona
- [ ] **RPT-06**: Daily-report cron has make-up logic: if a cron fire was missed (e.g., Windows reboot at 07:00), the next successful fire backfills

### Dashboard (PRD §7.13)

- [ ] **DASH-01**: Soldier dashboard shows: today view (bug-free version of prior-art today view), this week (7-day calendar with my color highlighted), open requests (inbound + outbound swaps), constraint status (current window lock state, declared/not), time clock button (if enabled)
- [ ] **DASH-02**: Manager dashboard shows: all soldier-dashboard features PLUS team calendar (all soldiers color-coded), leaderboard with ASCII bars (preserved from prior art), uncovered slots in next 7 days, pending-swap queue
- [ ] **DASH-03**: Admin dashboard aggregates manager-dashboard features across teams PLUS tenant health (active users, active soldiers, current planning windows) and live invite codes with redemption counts
- [ ] **DASH-04**: Per-person calendar colors used consistently in calendar cell backgrounds, leaderboard bars, swap-request avatars
- [ ] **DASH-05**: Four analytical chart views: Unit-level (active-window totals, coverage %, slot distribution, swap counts, top-swapped soldiers), Team-level (same scoped to team plus Gantt — DEFERRED to v1.1 per ECharts RTL limitation), Per-soldier (current+cumulative shifts, slot-type breakdown, swap history, punctuality stats, monthly sparkline), Leaderboard (ASCII bars + accessible horizontal bar chart twin)
- [ ] **DASH-06**: All charts render Hebrew labels; bar-chart layout direction is LTR (ECharts limitation, acceptable since ASCII-bar leaderboard is the primary view); leaderboard counts in ASCII bars must match counts in the bar chart (Playwright parity test)
- [ ] **DASH-07**: Per-soldier punctuality handles missing check-in records gracefully — shows "אין נתונים" (no data), never silently zero

### Schedule Exports (PRD §7.14)

- [ ] **EXPT-01**: iCal export — manager picks date range and scope (per-soldier or per-team); one-shot download generates `.ics` with one `VEVENT` per assignment, timezone `Asia/Jerusalem` baked in
- [ ] **EXPT-02**: iCal subscription — per-soldier signed long-lived URL backed by `ical_subscription_token` row (token = tenant_id + soldier_id + HMAC); generated lazily on first request; revocable from soldier profile
- [ ] **EXPT-03**: iCal subscription endpoint rate-limited (5 req/min per token); access logged; `X-Robots-Tag: noindex` header
- [ ] **EXPT-04**: CSV export — UTF-8 with BOM for Excel-Hebrew compatibility; columns `date, shift_slot_name, start_time, end_time, soldier_id, soldier_name, soldier_role_tags, team_id, team_name`; ISO-8601 dates, 24h times
- [ ] **EXPT-05**: PDF export — Puppeteer-rendered Hebrew RTL calendar grid; manager picks week or month view; soldier color as cell background; DD/MM/YYYY dates; A4 default + A3 option for wider monthly views
- [ ] **EXPT-06**: PDF Docker image includes `fonts-noto-core` + `fonts-noto-cjk` + `fontconfig`; Hebrew CI test page asserts no tofu glyphs
- [ ] **EXPT-07**: Each export format generates without errors for typical 30-soldier × 30-day window in <5 seconds
- [ ] **EXPT-08**: iCal opens in Google Calendar, Apple Calendar, and Outlook without warnings; CSV opens in Excel-on-Windows with Hebrew names intact; PDF prints to A4 with no clipped columns

### Internationalization & RTL (PRD §8.5)

- [ ] **I18N-01**: Two locales: `he` (default, RTL) and `en` (alt, LTR); ICU MessageFormat files at `app/locales/he.json` and `app/locales/en.json`
- [ ] **I18N-02**: Locale source is `app_user.locale` (or `report_recipient.locale` for external recipients); session carries it; every server-rendered output (Lowdefy pages, email, PDF) picks the recipient's locale at render time
- [ ] **I18N-03**: Lowdefy `config.theme.direction` set per-request based on user locale
- [ ] **I18N-04**: All dates use `Asia/Jerusalem`; format derives from locale (`he` → DD/MM/YYYY; `en` → YYYY-MM-DD); time is 24h in both
- [ ] **I18N-05**: Numbers use Latin numerals in both locales (Israeli convention)
- [ ] **I18N-06**: CI check fails build if any key in `he.json` is missing in `en.json` or vice versa (`tools/check-locales.mjs`)
- [x] **I18N-07**: Postgres Hebrew-text columns declared `COLLATE "he-x-icu"` (default codepoint sort is wrong)

### Security & Tenant Isolation (PRD §8.2, §8.3)

- [x] **SEC-01**: Every domain table has `tenant_id` FK; every backend query filters by `tenant_id` derived from session (NEVER request input); cross-tenant access returns 403 with no information leak
- [x] **SEC-02**: RBAC matrix from PRD §8.3 enforced server-side; client-side gating is for UX only, never for security
- [x] **SEC-03**: Lowdefy pages declare top-level `auth` block with minimum required role; mutating `request` blocks set `properties.auth` with server-side role re-check
- [x] **SEC-04**: Migration `0009_rls_policies.sql` enables Postgres RLS on every domain table; `app.current_tenant` session variable set per-connection-checkout via Knex `afterCreate` hook (5th defense layer)
- [x] **SEC-05**: CI grep gate (`tools/check-queries.mjs`) fails build on any YAML query missing `tenant_id` filter
- [x] **SEC-06**: Playwright pen-test fixture asserts every list/detail/mutation route returns 403 for cross-tenant access; manual penetration of `?tenant_id=` overrides returns 403
- [x] **SEC-07**: Audit tables (`schedule_audit`, `roster_import_log`) are append-only — migration `0010_audit_revokes.sql` REVOKEs UPDATE/DELETE/TRUNCATE from the app role
- [ ] **SEC-08**: All secrets in `.env` on hpg5; never in code or committed YAML; Postgres credentials never exposed beyond docker network
- [x] **SEC-09**: Invite codes are not enumerable (no listing endpoint without auth + role check)
- [x] **SEC-10**: Log-redaction middleware scrubs `*_SECRET`, `*_PASSWORD`, `*_KEY` env-var values from any structured log

### Operations & Observability (PRD §8.4, §8.8)

- [ ] **OPS-01**: Docker Compose stack includes services: `lowdefy`, `postgres`, `solver`, `cron`, `waha`, `migrate` (one-shot)
- [x] **OPS-02**: `migrate/migrate` (golang-migrate) compose service runs `db/migrations/0001-0010` in order; idempotent re-runs via `schema_migrations` table
- [x] **OPS-03**: Nightly `pg_dump --format=custom` to `C:\shifts-manager\backups\pg\YYYY-MM-DD.dump` via Windows Task Scheduler; retention 14 daily + 8 weekly + 6 monthly
- [x] **OPS-04**: Off-host nightly copy to neshernas (192.168.1.121) or S3-compatible bucket via `rclone`/`restic`
- [x] **OPS-05**: Backup self-test (`pg_restore --list` on latest dump) runs daily; alerts on failure
- [x] **OPS-06**: Quarterly restore drill: spin up parallel postgres from dump, point staging Lowdefy at it, verify signin → dashboard → schedule view works end-to-end
- [x] **OPS-07**: External uptime monitor (Uptime Kuma on neshernas) watches hpg5 from outside the host; push monitors for cron jobs catch silent-failure case
- [x] **OPS-08**: `docs/OPERATIONS.md` runbook covers Windows Update active hours, VHDX compaction (quarterly), AV exclusions, Cloudflared user account, Tailscale-bound WAHA UI port, dedicated WAHA SIM number, backup self-test verification
- [x] **OPS-09**: Test strategy per PRD §8.4: unit (pytest+vitest), integration (testcontainers), schema/migration, RBAC (Playwright + seeded fixtures), E2E golden path (Playwright), RTL/Hebrew (Litmus+visual diff), load (Locust), notification delivery (live staging)
- [ ] **OPS-10**: "Kibbutz fixture" (`tools/fixtures/kibbutz.sql`) — 12 soldiers / 1 team / 64-day window with one intentionally smart-quoted name — is the seed for both local dev and CI integration tests

### Performance (PRD §8.1)

- [ ] **PERF-01**: Solver <10s p95 for 30 soldiers × 30 days × 4 active rules (also gated by SOLV-05/SOLV-10)
- [ ] **PERF-02**: Dashboard page load <2s p95 on 4G mobile
- [ ] **PERF-03**: API roundtrip (Lowdefy → Postgres) <500ms p95 for typical queries
- [x] **PERF-04**: Composite indexes on `(tenant_id, ...)` for hot query paths (already partially in PRD §10 schemas)

### Accessibility (PRD §8.6)

- [ ] **A11Y-01**: WCAG 2.1 AA target for all interactive elements
- [ ] **A11Y-02**: Keyboard navigation throughout
- [ ] **A11Y-03**: Color is never the only signifier — leaderboard pairs color with soldier name and bar length; uncovered slots flagged with both red color and a warning icon
- [ ] **A11Y-04**: Sufficient color contrast on calendar cells (verify against WCAG AA)

### Tenant #1 Migration (PRD §13.2)

- [ ] **MIGR-01**: One-off Python CLI script in `tools/migrate-from-sheet/` reads Google Sheet `1GlT_Qu4Fi3gl0qSMp798mg0wKEEG1_-iSNrVjQkV8wI` (publicly readable, via `/gviz/tq?tqx=out:csv&gid=<tab_gid>`)
- [ ] **MIGR-02**: Migrates soldiers from `groups` tab through Roster CSV Import path; constraints from rows 14-29 to `availability_blockout` rows; rules from `settings` tab to team `rule` rows; existing assignments to `assignment` rows with `schedule_audit.payload.source='imported'`
- [ ] **MIGR-03**: Smart-quote canonicalization (strip U+2019 etc.) at write time; emits SQL INSERTs ordered by FK dependency
- [ ] **MIGR-04**: Idempotent re-runs: running the migration twice on the same input produces identical state (no duplicates)
- [ ] **MIGR-05**: Sample-check script lets user compare a sample week's schedule between sheet and Shifty side-by-side; rollback path via `TRUNCATE` on the tenant's rows if mismatch
- [ ] **MIGR-06**: On successful verification, original sheet is set to read-only at Drive level; Shifty becomes canonical

## v2 Requirements (deferred to v1.1+)

Tracked but not in current roadmap. From PRD §13.1.1 and research-identified deferrals.

### Calendar widget & sync

- **V2-CAL-01**: Google Calendar two-way sync (iCal export covers one-way needs in v1)
- **V2-CAL-02**: FullCalendar Lowdefy npm plugin replacing v1 day-list view
- **V2-CAL-03**: Gantt-style team timeline (ECharts RTL pain — replace with `vis-timeline` or drop)

### Operations & scale

- **V2-OPS-01**: PITR (point-in-time recovery) — WAL archiving deferred from v1's 24h-RPO pg_dump model
- **V2-OPS-02**: Background job queue for notifications (extract from synchronous dispatch — PRD §8.7 known bottleneck)
- **V2-OPS-03**: VAPID key rotation
- **V2-OPS-04**: CP-SAT `interleave_search` for deterministic parallelism (replaces `num_search_workers=1` pin)
- **V2-OPS-05**: Solver as a job queue with workers (PRD §8.7, when ≫100 tenants)

### Mobile & UX

- **V2-MOB-01**: Mobile PWA install prompt
- **V2-MOB-02**: Native mobile apps (or PWA hardening if PWA proves sufficient)

### Features

- **V2-FEAT-01**: Bulk operations beyond CSV import (bulk invite-code generation, bulk archive)
- **V2-FEAT-02**: Soldier-level "preferred days off" soft preference (informs fairness, not a hard rule)
- **V2-FEAT-03**: Multi-week recurring shift templates ("alternating weekends" pattern)
- **V2-FEAT-04**: Advanced reporting (custom date ranges, exportable analytics queries)
- **V2-FEAT-05**: Tenant-configurable "weekend" definition (Fri+Sat hardcoded in v1)
- **V2-FEAT-06**: Soldier-level attribution in infeasibility report's UI (beyond v1's data-level attribution)

## Out of Scope

Explicitly excluded from any version unless reopened. From PRD §14.

| Feature | Reason |
|---------|--------|
| Native mobile apps | PWA + Web Push covers the v1-scale mobile use case |
| Cross-team / cross-tenant coverage | Adds membership + availability complexity; not validated by discovery |
| Multi-org membership for one user | One-user-one-tenant simplifies auth/RLS |
| Payroll integration | Out of domain; time-clock data is CSV-exportable |
| Geofenced time-clock | Privacy-hostile in military context; no compelling v1 use case |
| SMS auth | Magic link works; SMS adds carrier integrations |
| Phone-call notifications | Out of domain |
| Rules expression DSL | 8-rule catalog covers prior-art needs; DSL is a future escape valve |
| Multi-language UI beyond Hebrew + English | No discovery signal for other languages |
| Shift bidding marketplace / open-shift broadcast | Conflicts with chain-of-command model |
| In-app team chat | Soldiers already use WhatsApp groups |
| Photo-verified clock-in | Privacy-hostile in military context |
| Predictive scheduling / Fair-Workweek compliance | US-laws-only; not applicable to Israeli reserve duty |

## Traceability

Each v1 requirement maps to exactly one phase. Phase assignment follows the rule "pick the phase where each REQ first becomes testable" for cross-cutting requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEN-01 | Phase 1 (Foundations) | Complete |
| TEN-02 | Phase 1 (Foundations) | Complete |
| TEN-03 | Phase 1 (Foundations) | Complete |
| TEN-04 | Phase 1 (Foundations) | Complete |
| TEN-05 | Phase 1 (Foundations) | Complete |
| AUTH-01 | Phase 1 (Foundations) | Complete |
| AUTH-02 | Phase 1 (Foundations) | Complete |
| AUTH-03 | Phase 1 (Foundations) | Complete |
| AUTH-04 | Phase 1 (Foundations) | Complete |
| AUTH-05 | Phase 1 (Foundations) | Complete |
| AUTH-06 | Phase 1 (Foundations) | Complete |
| AUTH-07 | Phase 1 (Foundations) | Complete |
| ROST-01 | Phase 2 (Org & People) | Pending |
| ROST-02 | Phase 2 (Org & People) | Complete |
| ROST-03 | Phase 2 (Org & People) | Pending |
| ROST-04 | Phase 2 (Org & People) | Pending |
| ROST-05 | Phase 2 (Org & People) | Pending |
| ROST-06 | Phase 2 (Org & People) | Complete |
| ROST-07 | Phase 2 (Org & People) | Complete |
| ROST-08 | Phase 2 (Org & People) | Pending |
| ROST-09 | Phase 2 (Org & People) | Pending |
| ROST-10 | Phase 2 (Org & People) | Pending |
| ROST-11 | Phase 2 (Org & People) | Complete |
| ROST-12 | Phase 2 (Org & People) | Pending |
| ROST-13 | Phase 2 (Org & People) | Pending |
| SHFT-01 | Phase 3 (Availability & Rules) | Pending |
| SHFT-02 | Phase 3 (Availability & Rules) | Pending |
| SHFT-03 | Phase 3 (Availability & Rules) | Pending |
| SHFT-04 | Phase 3 (Availability & Rules) | Pending |
| SHFT-05 | Phase 3 (Availability & Rules) | Pending |
| SHFT-06 | Phase 3 (Availability & Rules) | Pending |
| SHFT-07 | Phase 3 (Availability & Rules) | Pending |
| AVAL-01 | Phase 3 (Availability & Rules) | Pending |
| AVAL-02 | Phase 3 (Availability & Rules) | Pending |
| AVAL-03 | Phase 3 (Availability & Rules) | Pending |
| AVAL-04 | Phase 3 (Availability & Rules) | Pending |
| AVAL-05 | Phase 3 (Availability & Rules) | Pending |
| AVAL-06 | Phase 3 (Availability & Rules) | Pending |
| AVAL-07 | Phase 3 (Availability & Rules) | Pending |
| AVAL-08 | Phase 3 (Availability & Rules) | Pending |
| AVAL-09 | Phase 6 (Notifications & Reports) | Pending |
| RULE-01 | Phase 3 (Availability & Rules) | Pending |
| RULE-02 | Phase 3 (Availability & Rules) | Pending |
| RULE-03 | Phase 3 (Availability & Rules) | Pending |
| RULE-04 | Phase 3 (Availability & Rules) | Pending |
| RULE-05 | Phase 3 (Availability & Rules) | Pending |
| RULE-06 | Phase 3 (Availability & Rules) | Pending |
| RULE-07 | Phase 3 (Availability & Rules) | Pending |
| SOLV-01 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-02 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-03 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-04 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-05 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-06 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-07 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-08 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-09 | Phase 4 (Solver & Schedule) | Pending |
| SOLV-10 | Phase 4 (Solver & Schedule) | Pending |
| LIFE-01 | Phase 4 (Solver & Schedule) | Pending |
| LIFE-02 | Phase 4 (Solver & Schedule) | Pending |
| LIFE-03 | Phase 4 (Solver & Schedule) | Pending |
| LIFE-04 | Phase 4 (Solver & Schedule) | Pending |
| LIFE-05 | Phase 5 (Lifecycle Features) | Pending |
| LIFE-06 | Phase 5 (Lifecycle Features) | Pending |
| LIFE-07 | Phase 5 (Lifecycle Features) | Pending |
| LIFE-08 | Phase 6 (Notifications & Reports) | Pending |
| LIFE-09 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-01 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-02 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-03 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-04 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-05 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-06 | Phase 5 (Lifecycle Features) | Pending |
| SWAP-07 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-01 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-02 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-03 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-04 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-05 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-06 | Phase 5 (Lifecycle Features) | Pending |
| CLCK-07 | Phase 5 (Lifecycle Features) | Pending |
| NOTF-01 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-02 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-03 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-04 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-05 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-06 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-07 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-08 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-09 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-10 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-11 | Phase 6 (Notifications & Reports) | Pending |
| NOTF-12 | Phase 6 (Notifications & Reports) | Pending |
| RPT-01 | Phase 6 (Notifications & Reports) | Pending |
| RPT-02 | Phase 6 (Notifications & Reports) | Pending |
| RPT-03 | Phase 6 (Notifications & Reports) | Pending |
| RPT-04 | Phase 6 (Notifications & Reports) | Pending |
| RPT-05 | Phase 6 (Notifications & Reports) | Pending |
| RPT-06 | Phase 6 (Notifications & Reports) | Pending |
| DASH-01 | Phase 7 (Polish & Exports) | Pending |
| DASH-02 | Phase 7 (Polish & Exports) | Pending |
| DASH-03 | Phase 7 (Polish & Exports) | Pending |
| DASH-04 | Phase 7 (Polish & Exports) | Pending |
| DASH-05 | Phase 7 (Polish & Exports) | Pending |
| DASH-06 | Phase 7 (Polish & Exports) | Pending |
| DASH-07 | Phase 7 (Polish & Exports) | Pending |
| EXPT-01 | Phase 7 (Polish & Exports) | Pending |
| EXPT-02 | Phase 7 (Polish & Exports) | Pending |
| EXPT-03 | Phase 7 (Polish & Exports) | Pending |
| EXPT-04 | Phase 7 (Polish & Exports) | Pending |
| EXPT-05 | Phase 7 (Polish & Exports) | Pending |
| EXPT-06 | Phase 7 (Polish & Exports) | Pending |
| EXPT-07 | Phase 7 (Polish & Exports) | Pending |
| EXPT-08 | Phase 7 (Polish & Exports) | Pending |
| I18N-01 | Phase 7 (Polish & Exports) | Pending |
| I18N-02 | Phase 7 (Polish & Exports) | Pending |
| I18N-03 | Phase 7 (Polish & Exports) | Pending |
| I18N-04 | Phase 7 (Polish & Exports) | Pending |
| I18N-05 | Phase 7 (Polish & Exports) | Pending |
| I18N-06 | Phase 7 (Polish & Exports) | Pending |
| I18N-07 | Phase 1 (Foundations) | Complete |
| SEC-01 | Phase 1 (Foundations) | Complete |
| SEC-02 | Phase 1 (Foundations) | Complete |
| SEC-03 | Phase 1 (Foundations) | Complete |
| SEC-04 | Phase 1 (Foundations) | Complete |
| SEC-05 | Phase 1 (Foundations) | Complete |
| SEC-06 | Phase 1 (Foundations) | Complete |
| SEC-07 | Phase 1 (Foundations) | Complete |
| SEC-08 | Phase 1 (Foundations) | Pending |
| SEC-09 | Phase 1 (Foundations) | Complete |
| SEC-10 | Phase 1 (Foundations) | Complete |
| OPS-01 | Phase 1 (Foundations) | Pending |
| OPS-02 | Phase 1 (Foundations) | Complete |
| OPS-03 | Phase 1 (Foundations) | Complete |
| OPS-04 | Phase 1 (Foundations) | Complete |
| OPS-05 | Phase 1 (Foundations) | Complete |
| OPS-06 | Phase 1 (Foundations) | Complete |
| OPS-07 | Phase 1 (Foundations) | Complete |
| OPS-08 | Phase 1 (Foundations) | Complete |
| OPS-09 | Phase 1 (Foundations) | Complete |
| OPS-10 | Phase 1 (Foundations) | Pending |
| PERF-01 | Phase 4 (Solver & Schedule) | Pending |
| PERF-02 | Phase 7 (Polish & Exports) | Pending |
| PERF-03 | Phase 7 (Polish & Exports) | Pending |
| PERF-04 | Phase 1 (Foundations) | Complete |
| A11Y-01 | Phase 7 (Polish & Exports) | Pending |
| A11Y-02 | Phase 7 (Polish & Exports) | Pending |
| A11Y-03 | Phase 7 (Polish & Exports) | Pending |
| A11Y-04 | Phase 7 (Polish & Exports) | Pending |
| MIGR-01 | Phase M (Tenant #1 Migration) | Pending |
| MIGR-02 | Phase M (Tenant #1 Migration) | Pending |
| MIGR-03 | Phase M (Tenant #1 Migration) | Pending |
| MIGR-04 | Phase M (Tenant #1 Migration) | Pending |
| MIGR-05 | Phase M (Tenant #1 Migration) | Pending |
| MIGR-06 | Phase M (Tenant #1 Migration) | Pending |

**Coverage:**
- v1 requirements: 155 total (across 20 categories)
- Mapped to phases: 155
- Unmapped: 0 ✓
- Coverage: 100% ✓

**Phase-level distribution:**

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 1 (Foundations) | TEN, AUTH, SEC, OPS, I18N-07, PERF-04 | 34 |
| Phase 2 (Org & People) | ROST | 13 |
| Phase 3 (Availability & Rules) | SHFT, AVAL (1-8), RULE | 22 |
| Phase 4 (Solver & Schedule) | SOLV, LIFE (1-4), PERF-01 | 15 |
| Phase 5 (Lifecycle Features) | SWAP, LIFE (5,6,7,9), CLCK | 18 |
| Phase 6 (Notifications & Reports) | NOTF, RPT, AVAL-09, LIFE-08 | 20 |
| Phase 7 (Polish & Exports) | DASH, EXPT, I18N (1-6), A11Y, PERF (2,3) | 27 |
| Phase M (Tenant #1 Migration) | MIGR | 6 |
| **Total** | | **155** |

**Cross-cutting assignment notes:**
- `I18N-07` (Postgres `COLLATE "he-x-icu"` on Hebrew-text columns) → Phase 1: lives in initial migrations 0001–0007.
- `PERF-04` (composite indexes on `(tenant_id, ...)`) → Phase 1: indexes ship with initial schema migrations.
- `AVAL-09` (24h-pre-lock notification) → Phase 6: trigger logic + table flag are in Phase 3 schema, but the test "notification fires" requires the dispatcher (Phase 6).
- `LIFE-04` (publish fires `schedule.published` notifications) → Phase 4: the state-transition + event-stage is testable in Phase 4 against a stub dispatcher; live notification firing is wired in Phase 6.
- `LIFE-08` (window auto-close via cron) → Phase 6: cron service is built in Phase 6.
- `LIFE-09` (audit-log UI distinguishes override from swap) → Phase 5: the swap audit and override audit are written in Phase 5; the UI surfaces them in the same audit-log component built here.
- `PERF-01` (solver p95 <10s) → Phase 4: gated by the CI kibbutz-fixture test in Phase 4 definition of done.
- `PERF-02` and `PERF-03` (dashboard <2s, API <500ms) → Phase 7: the dashboard surface that exercises these is built in Phase 7.

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 — roadmap-driven traceability populated; 155/155 v1 requirements mapped (100% coverage).*
