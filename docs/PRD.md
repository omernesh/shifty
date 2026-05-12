# Shifty — Product Requirements Document

**Status**: Draft v1
**Last updated**: 2026-05-12
**Audience**: Engineering (build), Product (review), Future contributors (onboard)

This document is the contract between product intent and the codebase. Locked decisions are stated as decisions, not options. Open questions live in §15 only.

---

## 1. Executive Summary

Shifty is a multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. The product replaces the spreadsheet-based workflows that miluim units improvise during call-ups — typically a hand-typed Google Sheet maintained by one overworked מפקד (commander), with constraints collected over WhatsApp and a daily report copy-pasted into a unit group chat.

The product wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first, RTL web app. Soldiers self-declare availability inside a planning window; the manager runs the solver to produce a draft schedule, reviews it, publishes it, and from there the schedule is a living document — soldiers can request swaps, the manager approves (auto-approves when no rules are violated), and notifications fan out via Email, WhatsApp, Push, and in-app inbox. Soldiers can subscribe to their personal schedule from any calendar app (iCal), and managers can hand a printed PDF schedule to the unit board on day one — removing the two largest adoption barriers from the existing spreadsheet workflow.

The animating insight from discovery: **people are dynamic creatures**. A schedule that's perfect on Sunday is broken by Wednesday because someone's kid got sick or someone got pulled into a separate task. The lifecycle model (draft → publish → swap with audit) and the constraint-lock model (firm cutoff for availability changes, manager-only edits after lock) are the core mechanics for absorbing that volatility without losing accountability.

**Non-goals for v1**: native mobile apps, cross-tenant coverage, payroll, geofencing, SMS, phone-call notifications, rules DSL, Google Calendar sync, multi-org membership. See §14.

**Stack** (locked, not under review): Lowdefy 5.3 on Postgres 16, FastAPI+OR-Tools solver, Docker Compose on hpg5, public via Cloudflare Tunnel, Auth.js for auth, Resend for email, WAHA for WhatsApp, Web Push for browser push.

---

## 2. Problem Statement

Reserve unit schedules are managed today on a spectrum from "one shared Google Sheet" to "a printed paper that the מפקד updates with a pen." Both ends suffer the same failure modes:

- **Constraints are collected ad-hoc over WhatsApp** and lost in chat scrollback. Soldiers say "I can't do Tuesday" in a thread of 200 unread messages, the מפקד misses it, the schedule ships with Tuesday assigned to that person, and the conflict surfaces at handover.
- **No system of record for changes**. When soldier A swaps with soldier B, nobody knows if the swap was approved, who else was affected, or whether anyone reset the rules check.
- **Fairness is invisible**. The most senior or most reliable soldier ends up carrying disproportionate night shifts and weekends, but the data is never aggregated, so the unfairness compounds across multiple weeks of reserve duty.
- **Rule violations are caught at handover**, not at planning time. "Wait, you assigned me a night Tuesday and a morning Wednesday — that's 5 hours of rest" — the rule existed in the מפקד's head, not the schedule.
- **Reporting is manual**. The daily "who's on today" message is hand-typed every morning. Skipped on busy days.
- **Display-name fragility**. Real bug from prior art: smart-quote variants in soldier names (`'` U+0027 vs `'` U+2019) broke spreadsheet `COUNTIF` lookups and silently dropped counters. Names cannot be join keys.

The user has a working Google Sheet with 12 soldiers on a single team, two 12h shifts/day, hand-typed assignments and formula-driven dashboards. The sheet works at that scale and is the prior art Shifty must beat without losing what's loved: per-person calendar colors, a leaderboard with ASCII-bar visualization, the draft-then-promote workflow, and a Hebrew daily email.

Shifty's job: take everything good about the sheet, fix everything that fails as units grow past 12 soldiers and one team, and package it as a SaaS where any miluim unit can sign up and have a working schedule the same day.

---

## 3. Vision & Goals

### Vision (v2+ horizon)

A self-service planning tool that any miluim unit — from a 6-person squad to a 200-person company — can adopt without an admin, an account manager, or a contract. Schedules are correct by construction (rules engine), fair by default (variance-minimizing solver objective), and adapt to reality (swap workflow with audit). Manager spends 30 minutes per planning window instead of 4 hours.

### v1 goals (this PRD)

| # | Goal | Success signal |
|---|------|----------------|
| G1 | Single-team unit can self-onboard, define shifts, collect constraints, run solver, publish a schedule in <30 minutes from signup | Cold-start time-to-published-schedule measured on first 5 onboarded units |
| G2 | Solver produces a feasible, rule-respecting schedule in <10s for 30 soldiers / 30 days / 4 active rules | Median + p95 solve latency under load |
| G3 | Swap requests are processed (proposed → counter-accepted → manager-reviewed → published) within one notification round-trip, with full audit | 100% of swaps in production have an audit row per state transition |
| G4 | Daily email report is delivered every morning to subscribers, in Hebrew, RTL-correct, with today's assignments and unscheduled-constraint visibility | Zero missed days in first 30 days post-launch (excluding planned downtime) |
| G5 | Multi-tenant isolation is provably correct: zero cross-tenant data leaks | Integration test suite covers every domain table; manual penetration of `?tenant_id=` overrides returns 403 |

### Non-goals for v1

Listed in §14. The big ones: no mobile native, no cross-tenant, no payroll, no rules DSL.

---

## 4. Personas

| ID | Persona | Hebrew title | Primary jobs | Tech savvy |
|----|---------|--------------|--------------|------------|
| P1 | Unit admin / commander | מפקד יחידה | Configure org, manage roster, issue invite codes, generate reports | Medium |
| P2 | Team manager | מפקד צוות | Define shift schema, run solver, publish/edit schedule, approve swaps | Medium-low |
| P3 | Soldier | חייל / חיילת | Declare availability, view schedule, request swaps, log time | Low; mobile-first |
| P4 | Auditor / external recipient | משקיף | Receive daily/weekly reports; no login required | None (email only) |

Personas can be combined. A small unit's מפקד is often P1 + P2. In a 3-level org, P2 exists per צוות; P1 exists once per יחידה. P4 is typically a senior officer outside the unit (e.g., a battalion commander) who wants daily visibility without operating the app.

### Persona pain points (from discovery)

- **P1 (admin)**: spends nights hand-typing the sheet, gets blamed for unfairness they can't see in the data, loses constraints to WhatsApp scrollback, has no way to share the schedule beyond pasting an image.
- **P2 (team manager)**: identical to P1 in single-team units; in larger units, blocked on P1 for roster changes and rule overrides.
- **P3 (soldier)**: doesn't know when constraints are due, doesn't know when the schedule is finalized, finds out about changes from a friend's WhatsApp before getting the official update.
- **P4 (auditor)**: gets reports inconsistently, often after the relevant shift has already started.

---

## 5. Domain Model & Glossary

### Hebrew terms used in code and docs

| Hebrew | Transliteration | English | Used in code as |
|--------|-----------------|---------|------------------|
| יחידה | yechida | Unit (top of org tree) | `org_unit` with `level=1` |
| מחלקה | machlaka | Platoon (middle) | `org_unit` with `level=2` |
| צוות | tzevet | Team (bottom; schedules live here) | `org_unit` with `level=3` (or whatever the deepest level is for that tenant) |
| משמרת | mishmeret | Shift | `shift_slot` (template) and `shift_instance` (concrete date) |
| שיבוץ | shibutz | Assignment | `assignment` row in `assignments` table |
| אילוץ | ilutz | Constraint / availability statement | `availability` row, possibly with per-slot detail |
| חייל / חיילת | chayal / chayelet | Soldier | `soldier` (replaces `employees` from v1 schema after migration) |
| מפקד | mefaked | Commander (a role, not a table) | `membership.role IN ('unit_admin', 'team_manager')` |
| תורנות | toranut | Duty / shift rotation | Synonym for shift in casual UI copy |

### Core entities

- **Tenant**: one signup = one tenant. Strictly isolated. Every domain row has a `tenant_id` FK; every query is tenant-scoped.
- **Org unit**: a node in the org tree. 1–3 levels deep. `parent_id` is null for the root (יחידה). Leaf nodes are where schedules live; in a flat org, the root is also the leaf (single team).
- **Soldier**: a person. Belongs to a tenant, can be a member of one or more org units. Has display name, role tags, seniority, optional contact info.
- **Membership**: links a `soldier` (or `user`) to an `org_unit` with a `role` (e.g., `unit_admin`, `team_manager`, `member`). A soldier can be a member of multiple teams within their tenant.
- **User**: an authenticated identity (email). One-to-one with `soldier` for app users. Auditors (P4) are `user` rows without a `soldier` link (or with one — both supported).
- **Shift slot**: a template (name, start time, end time, headcount, optional required role tags, optional min seniority). Lives at the team level.
- **Shift instance**: a concrete occurrence of a slot on a specific date. Generated when the planning window is created.
- **Assignment**: a row pairing a `shift_instance` with a `soldier`. The schedule is the set of all assignments in a planning window.
- **Availability**: a soldier's statement of constraints — date-range blockouts and per-slot overrides — for a planning window.
- **Rule**: a named toggle or numeric limit attached to a team, optionally overridden per soldier.
- **Swap request**: a state machine for two soldiers exchanging assignments, with manager review and audit.
- **Notification**: an event-typed message dispatched on one or more channels to one or more recipients.
- **Invite code**: a short string admin generates for (unit, role) onboarding.

### Relationship summary

```
tenant ──┬── org_unit (tree)
         ├── soldier ── membership ── org_unit
         ├── shift_slot (per team)
         │     └── shift_instance ── assignment ── soldier
         ├── availability (per soldier × window)
         ├── rule (per team, per soldier override)
         ├── swap_request
         ├── invite_code
         └── notification_pref (per user × event)
```

---

## 6. User Stories

Organized by persona. Each story has a one-line acceptance hint; full acceptance lives in §7.

### P1 — Unit admin

| ID | Story | Acceptance hint |
|----|-------|------------------|
| U1.1 | As an admin, I sign up with my email, create a unit, and pick the org depth (1 / 2 / 3 levels). | Magic link delivered, tenant created, org root created |
| U1.2 | As an admin, I add teams under my unit. | New `org_unit` rows with correct `parent_id` |
| U1.3 | As an admin, I generate an invite code for (team, role) and share it via clipboard. | Code is 8 chars, base32 Crockford, copyable to clipboard, optional expiry/max-uses honored |
| U1.4 | As an admin, I see the roster across all teams in my unit. | Aggregated `soldier` list, filterable by team |
| U1.5 | As an admin, I configure who receives daily/weekly/event reports. | `report_recipient` rows updated; first daily email lands within 24h |
| U1.6 | As an admin, I revoke a soldier's access without deleting their historical assignments. | `soldier.status='archived'`; past assignments preserved |

### P2 — Team manager

| ID | Story | Acceptance hint |
|----|-------|------------------|
| U2.1 | As a manager, I define the shift schema for my team (slots, headcount, optional role tags, min seniority). | YAML or UI form persists `shift_slot` rows; can pick from 2x12h / 3x8h / custom templates |
| U2.2 | As a manager, I toggle rules and set numeric limits for my team. | `rule` rows persisted; immediately consumed by next solver run |
| U2.3 | As a manager, I open a planning window (e.g., 2026-05-15 → 2026-05-29) and set a constraint lock date. | `planning_window` row created; shift instances auto-generated |
| U2.4 | As a manager, I run the solver and see the draft schedule. | Solver call returns within 10s for typical inputs; assignments shown in calendar view |
| U2.5 | As a manager, I edit the draft manually before publishing (manual override always allowed). | UI lets me move/swap assignments pre-publish; rule violations highlighted but not blocking |
| U2.6 | As a manager, I publish the schedule. | State transition Draft → Published; notifications fire to all assigned soldiers |
| U2.7 | As a manager, I approve or decline swap requests. | Auto-approve path triggers when no rule violations; manual review path for the rest |
| U2.8 | As a manager, I edit a soldier's availability after constraint lock (manager-only). | UI form gated by role; audit log captures the override |

### P3 — Soldier

| ID | Story | Acceptance hint |
|----|-------|------------------|
| U3.1 | As a soldier, I sign up with my email magic link and join my unit using an invite code. | NextAuth EmailProvider flow + invite code redemption; new `membership` row |
| U3.2 | As a soldier, I declare availability for an open planning window — full-day blockouts plus per-slot overrides. | UI defaults all dates to "available"; pick ranges to block; drill into a day for partial-day toggles |
| U3.3 | As a soldier, I see my published schedule on a calendar with my color. | Calendar view, color persisted on `soldier.color`, Hebrew labels |
| U3.4 | As a soldier, I request a swap with another soldier for a specific assignment. | Swap form lets me pick my assignment and a counterpart's assignment; `swap_request` row created |
| U3.5 | As a soldier, I accept or decline an inbound swap request. | One-tap accept/decline in in-app inbox; state transitions logged |
| U3.6 | As a soldier, I view my own time-clock history and total hours. | Personal stats view; sums from `time_clock_entries` |
| U3.7 | As a soldier, I toggle notification preferences per event type per channel. | UI form persists `notification_pref` rows |
| U3.8 | As a soldier, I use the "Check in / Check out" button on a phone to log time. | Single-tap toggle captures `now()`; manual time picker lets me correct |

### P4 — Auditor

| ID | Story | Acceptance hint |
|----|-------|------------------|
| U4.1 | As an auditor, I receive the daily email at a configured hour, in Hebrew, RTL-correct. | Email arrives <60s after the cron tick; includes today's assignments and unscheduled-constraint visibility |
| U4.2 | As an auditor, I receive the weekly Monday digest. | Email includes upcoming week's schedule, per-soldier shift counts, uncovered slots flagged |

---

## 7. Functional Requirements

### 7.1 Tenant & org management

- **Self-signup**: anyone with a valid email can create a tenant. No invite required for the founding admin (their account is the tenant root).
- **Org depth**: 1, 2, or 3 levels. Chosen at tenant creation; can be changed only by adding deeper levels (never collapsing).
- **Org tree**: `org_unit` with self-referential `parent_id`. Root has `parent_id IS NULL`. Leaf nodes are where teams live.
- **Schedules live at the team (leaf) level always.** A 1-level org has its root as the team. A 3-level org has יחידה > מחלקה > צוות, schedules on צוות.
- **Tenant isolation**: every row in every domain table has `tenant_id`. Every backend query filters by `tenant_id` derived from the authenticated session — never from request input. Cross-tenant access returns 403 with no information leak.

**v1 acceptance criteria**: a new signup can create a tenant, choose depth, add child org units, and view the resulting tree. Integration tests prove zero cross-tenant data exposure.

### 7.2 Authentication & invite codes

- **Auth**: NextAuth EmailProvider (magic link via Resend). No passwords.
- **Invite codes**:
  - Generated by an admin for a specific (`org_unit_id`, `role`) pair.
  - 8 chars, base32 Crockford alphabet (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no `I`, `L`, `O`, `U`), case-insensitive on redemption.
  - Optional `expires_at` (timestamp) and `max_uses` (integer). Null = no limit.
  - Redeemed on first login by entering the code; creates a `membership` row tying the new user's soldier to the target org unit with the target role.
  - Audit row written on every redemption (`invite_code_redemption` table).

| Role enum | Hebrew | Description |
|-----------|--------|-------------|
| `unit_admin` | מפקד יחידה | Tenant-level admin; all permissions |
| `team_manager` | מפקד צוות | Team-scoped admin; can publish, approve swaps, override constraints |
| `member` | חייל / חיילת | Default soldier role |
| `viewer` | משקיף | Read-only access; typically an auditor with a login |

**v1 acceptance criteria**: founding admin signs up via magic link with no code (becomes `unit_admin`); subsequent users sign up via magic link AND code; revoked/expired/used-up codes reject with a clear error in Hebrew.

### 7.3 People & roster

- **Soldier** entity: `id` (UUID), `tenant_id`, `display_name`, `color` (hex), `seniority` (integer 0–10), `role_tags` (TEXT[]), `status` (`active` | `archived`), `notes` (text, manager-visible only).
- **UUID-only joins** for soldiers. Display names are mutable and never used as join keys. This is a hard rule, motivated by the smart-quote bug in the prior-art sheet. See §10.
- **Role tags** are tenant-defined, free-form, lowercase, kebab-case (`medic`, `driver`, `team-lead`, `shift-commander`). UI surfaces autocomplete from existing tags but allows new ones.
- **Seniority** is a simple integer 0–10. Tenant decides what the scale means. Solver only uses `>=` comparisons.
- **Color** assignment: when a soldier is created, the system assigns a color from a 24-color preset palette (round-robin, avoiding adjacent-color collisions within a team). Soldier can change their color in profile.

**v1 acceptance criteria**: roster CRUD works at the unit level; soldier can be assigned to multiple teams within the unit; archived soldiers don't appear in pickers but their history is intact.

#### 7.3.1 Roster CSV import

Elevated from v1.1 to v1.0 (decided 2026-05-12). The single-row "add a soldier" form does not scale beyond 5–10 entries; v1 ships a CSV import to absorb existing rosters in one shot.

- **Trigger**: admin or `team_manager` uploads a `.csv` file from a "Roster import" page under unit settings.
- **Required columns** (header row): `name, email, role_tags, seniority, team_id`.
- **`role_tags`**: `|`-separated tag names (e.g., `medic|driver`). Unknown tags surface as warnings; manager can create them inline before confirm.
- **`seniority`**: integer 0–10; default `0` if blank.
- **`team_id`**: optional. If absent on every row, the import UI prompts the manager to assign all rows to one team.
- **Preview**: row-by-row preview with per-row validation status (✓ create / ⚠ warn / ✗ error). Inline editing for fixes before confirm.
- **Duplicate handling**: rows whose `email` already exists within the tenant are flagged and skipped by default. Manager can opt to "re-invite" the existing row, which regenerates the magic link without touching the rest of the soldier record.
- **On confirm**: create `soldier` (+ `app_user`) records, dispatch magic-link invite emails via Resend, write a summary row to `roster_import_log`.
- **Result view**: created N, skipped M, errored K. Error details surfaced inline AND persisted as JSON in `roster_import_log.error_details`.
- **Audit**: every import run logged in `roster_import_log` (see §10).

**v1 acceptance criteria**: a 50-row CSV imports in <10 seconds; duplicate detection by email works inside the tenant scope; invite emails dispatched to each new soldier; `roster_import_log` row created with accurate counts.

### 7.4 Teams & shift schemas

- **Shift slot**: `id`, `tenant_id`, `team_id`, `name` (Hebrew default, e.g., "בוקר", "לילה"), `start_time` (TIME), `end_time` (TIME, may cross midnight), `headcount` (integer ≥1), `required_role_tags` (TEXT[], nullable), `min_seniority` (integer, nullable), `display_order`.
- **Templates** offered at team creation (data is still fully custom afterward):

| Template | Slots | Notes |
|----------|-------|-------|
| 2x12h | בוקר 06:00–18:00, לילה 18:00–06:00 | Matches prior-art sheet |
| 3x8h | בוקר 06:00–14:00, ערב 14:00–22:00, לילה 22:00–06:00 | Common alternative |
| Custom | Empty; manager defines slots from scratch | |

- **Headcount > 1** means N parallel assignments for the same slot on the same date (e.g., a slot with `headcount=3` produces 3 assignment rows per date).
- **Required role tags** are AND-combined: a soldier must have ALL listed tags to be eligible. `[]` or NULL = no requirement.
- **Min seniority**: soldier's seniority must be `>=` this value. NULL = no requirement.
- **Shift instances** are auto-generated when a planning window is created: cross-product of (slot, date in window, headcount-index).

**v1 acceptance criteria**: manager picks a template, customizes slot times/headcount/requirements, and the system generates shift instances for the planning window correctly across DST boundaries (none in Israel; still must be robust).

### 7.5 Availability & constraints

- **Default state**: every soldier × every shift instance in an open window starts as "available."
- **UI primitives**:
  - Date-range blockout: pick `from` and `to` dates; marks every shift instance in that range as unavailable.
  - Per-slot override: drill into a single date, toggle individual slots.
- **Stored representation**: `availability` row keyed on (`soldier_id`, `planning_window_id`, `shift_instance_id`), with `state ∈ {available, unavailable}` and a `source` field (`range_blockout` | `per_slot` | `manager_override`).
- **Hybrid resolution**: per-slot rows take precedence over range-blockouts. Manager overrides take precedence over both.
- **Constraint lock**: planning window has a `constraint_lock_at` timestamp. Default = 3 days before window start (admin-configurable per window). After lock, only managers can write availability; an audit row is written for every manager override.
- **Edge cases**:
  - Soldier joins the team after the window opens → their availability defaults to "available" for all instances; they can declare constraints up to the lock.
  - Soldier joins after the lock → manager must declare on their behalf (or leave them all-available).
  - Soldier archived mid-window → existing assignments preserved (they happened); future assignments removed and the manager is notified.

**v1 acceptance criteria**: a soldier can declare blockouts in <30 seconds for a 2-week window; per-slot drill-down works on mobile (no horizontal scroll); lock prevents writes by non-managers; manager overrides are audited.

### 7.6 Rules engine

- **Rules are named toggles + numeric limits attached to a team, optionally overridden per soldier.**
- **Per-soldier overrides can only tighten** the team-level rule (e.g., team allows `max_consecutive_nights=4`; a soldier can override to 2; cannot override to 6). Loosening is silently ignored with a UI warning.
- **"Weekend" definition** (used by `weekend_separation`): Friday + Saturday (Israeli weekend), hardcoded in the solver for v1. Configurable per tenant in v2.
- **Rule catalog (v1, frozen)**:

| Key | Type | Default | Hebrew label | Semantics |
|-----|------|---------|--------------|-----------|
| `no_same_day_double` | boolean | true | אין שתי משמרות באותו יום | A soldier cannot be assigned to two slots on the same date |
| `no_consecutive_shift2_then_shift1` | boolean | true | אין לילה ואחריו בוקר | No night-shift assignment followed by a morning assignment on the next day |
| `max_consecutive_nights` | integer | 3 | מקסימום לילות רצופים | A soldier cannot be assigned to more than N consecutive nights |
| `weekend_separation` | boolean | true | הפרדה בין סופי שבוע | If a soldier worked weekend N, they cannot work weekend N+1 |
| `max_weekly_hours` | integer (hours) | 60 | מקסימום שעות שבועיות | Total assigned hours per ISO-week cannot exceed N |
| `min_rest_hours_between_shifts` | integer | 8 | מינימום מנוחה בין משמרות | Between any two assignments, gap must be ≥N hours |
| `max_shifts_per_period` | integer | (window-dependent) | מקסימום משמרות בחלון | Total assignments in the planning window cannot exceed N |
| `fairness_objective` | enum (`count_variance` \| `hours_variance` \| `night_variance` \| `off`) | `count_variance` | מטרת הוגנות | Solver objective; minimize variance across soldiers of the chosen metric |

- **`fairness_objective` is the solver's objective function.** Hard rules are constraints; fairness is the thing the solver minimizes. `off` means feasibility-only.
- **Soldier overrides** stored as `rule_override` rows keyed on (`soldier_id`, `rule_key`) with a `value` payload. Boolean overrides can only tighten (true → cannot override to false if the team has true); integer overrides can only lower.
- **Activation**: a rule is "active" if its team-level row exists and is enabled. Inactive rules are not sent to the solver.

**v1 acceptance criteria**: manager toggles rules and sets limits in a UI form; per-soldier override UI shows the team baseline and the soldier's tightening; solver respects every active rule; infeasibility surfaces the offending rule names.

### 7.7 Schedule lifecycle

- **States**: `draft` → `published` → (mutated via approved swaps) → `closed` (after window end).
- **Draft**: created on solver run. Manager can hand-edit (drag-drop or row-edit). Rule violations on hand-edits are highlighted but not blocking — manager always has manual override.
- **Publish**: state transition Draft → Published. Notifications fire to every assigned soldier. Assignment table becomes the source of truth for swap proposals.
- **Mutation post-publish**: only via approved swap requests (see §7.10) OR manager manual override (see below).
- **Close**: automatic on `window.end_date + 1 day`. Assignments become immutable. Time-clock entries can still be written for past dates (manual correction).

```
       ┌──────────────────────────────────────────────┐
       │                                              │
       ▼                                              │
   ┌───────┐    solver_run    ┌───────┐  publish  ┌────────────┐
   │ open  │ ────────────────▶│ draft │ ─────────▶│ published  │
   └───────┘                  └───────┘            └─────┬──────┘
       ▲                          │                     │
       │                          │ manager hand-edit   │ swap / edit
       │                          ▼                     ▼
       │                       ┌───────┐            ┌────────────┐
       │                       │ draft │            │ published  │
       │                       │ (v2)  │            │ (vN)       │
       │                       └───────┘            └─────┬──────┘
       │                                                  │ window end
       │                                                  ▼
       │                                            ┌────────────┐
       └────────── new window ──────────────────────│  closed    │
                                                    └────────────┘
```

- **Draft-then-promote** is a beloved feature from the prior-art sheet. Preserved here as the Draft → Publish transition. Manager can run the solver, eyeball it, iterate, and only publish when satisfied.
- **Versioning**: every state transition writes a row to `schedule_audit` with `from_state`, `to_state`, `actor_user_id`, `timestamp`, `payload_json`. Used by the audit log UI and for dispute resolution.

#### Manager manual override (post-publish)

The escape hatch for the reality of reserve duty — no-shows, last-minute pulls, emergency reassignments. Distinct from the swap_request flow; this is a unilateral manager edit, not a soldier-initiated negotiation.

- After a schedule is published, the team manager can directly edit any assignment cell — replace one soldier with another, or clear the cell entirely.
- Each override writes a row to `schedule_audit` with `actor_kind='user'`, a `payload` carrying `{ previous_value, new_value, reason }`, and a `to_state` label of `manager_override`. `reason` is a free-text field, optional but encouraged for audit clarity.
- The edit is validated against the team's active rules **with per-soldier overrides applied** (overrides tighten, so they're the strictest check). If the edit would produce a rule violation, the manager sees an inline warning listing the violated rules and must click "Override anyway" — that confirmation click is captured in the audit `payload` as `force_override: true`.
- Affected soldiers (the one removed AND the one added) are notified via `assignment_changed` on their preferred channels within 60 seconds.
- The audit log UI surfaces "manual override by {manager}" distinctly from "approved swap" entries (different icon, different `to_state` label).

**v1 acceptance criteria**: full lifecycle works end-to-end; audit log captures every transition including manual overrides with `previous_value`/`new_value`; publish triggers notifications; affected soldiers notified within 60 seconds of an override; rule violations surface inline with violated rule names; force-override is logged distinctly; closed windows are immutable except for time-clock corrections.

### 7.8 Solver service (API contract + behavior)

- **Language**: Python 3.12.
- **Framework**: FastAPI.
- **Solver**: OR-Tools CP-SAT.
- **Deployment**: Docker image in `solver/`, joined to the compose stack as service `solver`. Internal-only; no host port exposed.
- **Stateless**: solver does not read or write the database. Lowdefy is responsible for assembling the request, calling the solver, and persisting the response.

#### Endpoint: `POST /solve`

Request schema (JSON Schema draft-07):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SolveRequest",
  "type": "object",
  "required": ["tenant_id", "team_id", "window", "shift_slots", "soldiers", "availability", "rules"],
  "properties": {
    "tenant_id": {"type": "string", "format": "uuid"},
    "team_id": {"type": "string", "format": "uuid"},
    "solver_run_id": {"type": "string", "format": "uuid"},
    "window": {
      "type": "object",
      "required": ["start_date", "end_date"],
      "properties": {
        "start_date": {"type": "string", "format": "date"},
        "end_date": {"type": "string", "format": "date"}
      }
    },
    "shift_slots": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "start_time", "end_time", "headcount"],
        "properties": {
          "id": {"type": "string"},
          "name": {"type": "string"},
          "start_time": {"type": "string", "format": "time"},
          "end_time": {"type": "string", "format": "time"},
          "headcount": {"type": "integer", "minimum": 1},
          "required_role_tags": {"type": "array", "items": {"type": "string"}},
          "min_seniority": {"type": "integer"}
        }
      }
    },
    "soldiers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "role_tags", "seniority"],
        "properties": {
          "id": {"type": "string", "format": "uuid"},
          "role_tags": {"type": "array", "items": {"type": "string"}},
          "seniority": {"type": "integer"}
        }
      }
    },
    "availability": {
      "type": "array",
      "description": "Per (soldier × date × slot) availability. Missing entries default to AVAILABLE.",
      "items": {
        "type": "object",
        "required": ["soldier_id", "date", "available"],
        "properties": {
          "soldier_id": {"type": "string", "format": "uuid"},
          "date": {"type": "string", "format": "date"},
          "slot_id": {"type": ["string", "null"]},
          "available": {"type": "boolean"}
        }
      }
    },
    "rules": {
      "type": "object",
      "properties": {
        "no_same_day_double": {"type": "boolean"},
        "no_consecutive_shift2_then_shift1": {"type": "boolean"},
        "max_consecutive_nights": {"type": ["integer", "null"]},
        "weekend_separation": {"type": "boolean"},
        "max_weekly_hours": {"type": ["integer", "null"]},
        "min_rest_hours_between_shifts": {"type": ["integer", "null"]},
        "max_shifts_per_period": {"type": ["integer", "null"]},
        "fairness_objective": {"type": "boolean"}
      }
    },
    "rule_overrides": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["soldier_id", "rule_name", "value"],
        "properties": {
          "soldier_id": {"type": "string", "format": "uuid"},
          "rule_name": {"type": "string"},
          "value": {}
        }
      }
    },
    "max_seconds": {"type": "integer", "default": 10},
    "random_seed": {"type": ["integer", "null"]}
  }
}
```

Response schema (success):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SolveResponse",
  "type": "object",
  "required": ["status", "solver_run_id"],
  "properties": {
    "status": {"enum": ["optimal", "feasible", "infeasible", "error"]},
    "solver_run_id": {"type": "string", "format": "uuid"},
    "solve_time_seconds": {"type": "number"},
    "assignments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["date", "slot_id", "soldier_id"],
        "properties": {
          "date": {"type": "string", "format": "date"},
          "slot_id": {"type": "string"},
          "soldier_id": {"type": "string", "format": "uuid"}
        }
      }
    },
    "soldier_shift_counts": {
      "type": "object",
      "additionalProperties": {"type": "integer"}
    },
    "objective_value": {"type": "number"},
    "infeasibility_report": {
      "type": "object",
      "properties": {
        "offending_rules": {"type": "array", "items": {"type": "string"}},
        "uncovered_slots": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "date": {"type": "string", "format": "date"},
              "slot_id": {"type": "string"},
              "headcount_missing": {"type": "integer"}
            }
          }
        }
      }
    }
  }
}
```

Error envelope (4xx/5xx):

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

Error codes:

| Code | HTTP | When |
|------|------|------|
| `INVALID_INPUT` | 400 | Request fails schema validation or references unknown soldier/slot ids |
| `WINDOW_TOO_LARGE` | 413 | Window × soldiers × slots exceeds the solver's hard ceiling (see §8 scalability) |
| `TIMEOUT` | 504 | `max_seconds` elapsed and no feasible solution was found |
| `INTERNAL` | 500 | Uncaught exception in the solver process |

- **Performance target**: <10 seconds for a 30-day window with 30 soldiers and 4 active rules.
- **Timeout behavior**: if `max_seconds` is hit before optimality, return best-feasible with `status=feasible`. If no feasible solution exists, return `status=infeasible` with the offending-rules report. Hard timeout with no feasible result returns the `TIMEOUT` error envelope.
- **Determinism**: same input + same seed = same output. Important for reproducible debugging.
- **`random_seed` exposure**: hidden from the manager UI. Lowdefy generates it server-side (or defaults to a fixed value per run) and persists it on `solver_run.request_payload` for engineer-side debugging only. Surfacing it would confuse non-technical managers without unlocking any user-facing capability.
- **No persistence**: the solver does not log requests/responses to disk in production (memory-only, with optional debug log to stderr). Lowdefy stores the request and response in `solver_run` for audit.

**v1 acceptance criteria**: solver returns optimal or feasible within target latency for realistic inputs; infeasibility report names the rule(s); stateless behavior verified by black-box test.

### 7.9 Time clock

- **Opt-in per soldier** (`soldier.time_clock_enabled` boolean).
- **Two input modes**:
  - **Button**: big mobile-friendly button labeled "Check in" (כניסה). Tap → captures `now()` as start time. Button becomes "Check out" (יציאה). Next tap → captures `now()` as end time, persists the entry, button resets.
  - **Manual time pickers**: type/pick start and end times; submit to create or amend an entry.
- **Data**: `time_clock_entries` (already in schema). Columns: `id`, `tenant_id`, `soldier_id`, `started_at`, `ended_at`, `source` (`button` | `manual`), `assignment_id` (nullable; for linking to a shift instance), `note`.
- **Midnight-spanning entries**: one row, not two. A button-tapped "check in" at 23:00 and "check out" at 03:00 yields a single row with `started_at='...23:00'` and `ended_at='...03:00'` (next day). `timestamptz` carries the date boundary cleanly; no special DDL or split-on-midnight logic.
- **No geofencing.** No location data captured.
- **Use cases**:
  - Personal stats (total hours, per-week breakdown).
  - Manager audit (export per-soldier hours).
  - Dispute resolution (soldier says they were on duty; entries support the claim).
- **Explicitly NOT used for**: future scheduling decisions, payroll, performance reviews.

**v1 acceptance criteria**: soldier can tap-tap on phone to log a shift; soldier can edit a past entry's times; manager can view team-level time-clock summary; midnight-spanning entries display correctly as one row.

### 7.10 Swap requests

- **Initiator**: soldier A picks one of their own published assignments AND one of soldier B's published assignments. (1-for-1 swap only in v1.)
- **Counterparty**: soldier B receives a notification and accepts or declines via in-app inbox.
- **Manager review**: triggered after B accepts.
  - **Auto-approve eligibility**: evaluated against the team's active rules **with per-soldier overrides applied** to both soldiers in the swap. Overrides are tightenings, so this is the strictest possible check — if the swapped state passes here, it passes everything. If zero violations, the swap auto-approves and notifications fire.
  - **Manual review**: if any rule violation is detected, the swap goes into the manager's queue. Manager sees the swap, the violated rules, and can approve (overriding) or reject.
- **On approval**: assignments table is patched atomically. Audit row written. Notifications fire to A, B, and the manager.
- **State machine**:

```
   ┌──────────┐   B accepts   ┌──────────────┐   auto-approve   ┌──────────┐
   │ proposed │ ─────────────▶│ awaiting_mgr │ ─────────────────▶│ approved │
   └────┬─────┘               └──────┬───────┘                   └──────────┘
        │ B declines                 │ mgr rejects
        │                            ▼
        │                       ┌──────────┐
        └──────────────────────▶│ rejected │
                                └──────────┘
```

- **`swap_request` row**: `id`, `tenant_id`, `team_id`, `initiator_soldier_id`, `initiator_assignment_id`, `counterparty_soldier_id`, `counterparty_assignment_id`, `state`, `state_history_json`, `auto_approve_eligible`, `manager_decision_at`, `manager_decision_actor_id`, `manager_decision_reason`.

**v1 acceptance criteria**: full swap loop works end-to-end; auto-approve triggers correctly with overrides applied; manual review queue surfaces violations; audit captures every state change.

### 7.11 Notifications

- **Channels** (each opt-in per user × event-type):

| Channel | Transport | v1 status |
|---------|-----------|-----------|
| Email | Resend API | Required |
| WhatsApp | WAHA self-hosted | Required (best-effort) |
| Push | Web Push API + service worker | Required |
| In-app | Bell icon + queue table | Required |

#### Event catalog

Every system event that emits a notification. "Default channels" can be overridden per user per event type from the profile page.

| Event | Trigger | Recipient(s) | Default channels | Template vars |
|-------|---------|--------------|-------------------|---------------|
| `invite.sent` | Admin generates invite code | Invited email | Email | `code, tenant_name, expiry, inviter_name` |
| `signup.welcome` | New user first signin | The user | Email, in-app | `user_name, tenant_name` |
| `availability.lock_approaching` | 24h before lock | All team soldiers | Email + WhatsApp + in-app | `team_name, lock_at, missing_count` |
| `availability.locked` | Lock time passes | All team soldiers | In-app | `team_name, lock_at` |
| `schedule.draft_ready` | Manager generates draft | Manager | In-app | `team_name, window` |
| `schedule.published` | Manager publishes | All assigned soldiers | All channels (per-user toggles) | `team_name, window, assignment_count` |
| `schedule.manual_override` | Manager edits cell | Affected soldiers (removed + added) | All channels | `team_name, date, slot, previous_soldier, new_soldier` |
| `swap.proposed` | Soldier A proposes swap to B | Soldier B | All channels | `proposer_name, date, slot` |
| `swap.accepted_by_counterparty` | Soldier B accepts | Manager | In-app + email | `swap details` |
| `swap.declined` | Soldier B declines | Soldier A | In-app + email | `swap details` |
| `swap.approved` | Manager approves (or auto-approves) | Both soldiers | All channels | `swap details` |
| `swap.rejected` | Manager rejects | Both soldiers | In-app + email | `swap details, reason?` |
| `report.daily_briefing` | Cron at `CRON_DAILY_REPORT_HOUR` | Subscribed recipients | Email | `team_name, today_assignments, unscheduled_constraints` |
| `report.weekly_digest` | Cron at weekly slot | Subscribed recipients | Email | `team_name, week_range, schedule_table, anomalies` |
| `waha.session_down` | WAHA reports session-down | Tenant admin | Email + in-app | `last_alive_at` |
| `cron.failure` | Cron job throws | Tenant admin | Email + in-app | `job_name, error_message` |

- **Per-user override**: profile UI lets the user pick channels per event. Stored as `notification_pref` rows: (`user_id`, `event_type`, `channels JSONB`).
- **Per-recipient locale**: each user's preferred locale on `app_user.locale` (set in profile; defaults from `APP_DEFAULT_LOCALE`) drives the language of email/WhatsApp/in-app notifications sent TO that user. The dispatcher loads the recipient's locale at send time and picks the Hebrew or English template accordingly. A Hebrew-only tenant and a mixed-locale tenant both work without admin intervention.
- **Sending pipeline**:
  - Event fires in Lowdefy.
  - Notification dispatcher (a Lowdefy operator OR a small Node helper in the app container) loads per-user prefs + locale, builds the message in the recipient's language, dispatches to each channel.
  - Each channel has its own delivery target: Resend HTTP, WAHA HTTP, Web Push (VAPID), in-app row insert.
  - All deliveries logged to `notification_log` with `status` (`queued`, `sent`, `delivered`, `failed`, `bounced`) and `provider_response`.
- **Delivery SLAs**:
  - Email: <60 seconds from event.
  - WhatsApp: <30 seconds from event (best-effort; no provider SLA — WAHA is self-hosted on an unofficial WhatsApp HTTP gateway).
  - Push: <5 seconds from event (subject to browser availability).
  - In-app: instant.
- **Templates**: each event has Hebrew and English template files in `app/templates/`. RTL-correct for Hebrew. Variables substituted at send time.

**v1 acceptance criteria**: all four channels deliver successfully in dev and prod; per-user prefs and per-user locale honored; failed sends retry up to 3 times with exponential backoff; notification log inspectable by admin.

### 7.12 Reporting

- **Three cadences, all running simultaneously, recipients managed per-cadence**:

| Cadence | When | Content |
|---------|------|---------|
| Daily email | Every morning at admin-configured time (default 07:00 Israel) | Today's assignments + unscheduled soldiers' constraints for visibility |
| Weekly Monday digest | Mondays at admin-configured time (default 08:00 Israel) | Upcoming week's schedule + per-soldier shift counts + uncovered slots flagged |
| Event-driven | Real-time | `schedule_published`, `swap_approved`, `assignment_changed` |

- **Recipients**: managed in unit's "Reports" settings tab. Each recipient = a row in `report_recipient` with `email`, `display_name`, `subscriptions JSONB` listing which cadences they're on.
- **Recipients can be users or external (email-only).** External recipients (P4 auditor pattern) have no login.
- **Per-recipient locale**: for `app_user`-backed recipients, the report is rendered in their `app_user.locale`. For external `report_recipient`-only rows (no login), an optional `locale` column on `report_recipient` controls the language; defaults to `APP_DEFAULT_LOCALE` (`he`) when absent.
- **Content for daily report** (preserve the prior-art sheet's daily email shape):
  - Date header (RTL for Hebrew).
  - Today's assignments grouped by team and slot.
  - Soldiers not assigned today, with their declared constraints (`constraint_summary` field).
  - Link to today's calendar view in the app (`https://apps.nesher.co/today`).
- **Content for weekly digest**:
  - Week range.
  - Day-by-day mini-table.
  - Leaderboard (ASCII bars; see §7.13).
  - Uncovered slots flagged with a red marker.
- **Sending**: the `cron` service in the compose stack (see §11) triggers; Resend handles delivery; failures logged to `notification_log`.

**v1 acceptance criteria**: a fresh tenant subscribed to daily reports gets their first email the next morning; weekly digest fires Monday; event-driven reports fire within 60s of the trigger; each recipient receives the report in their preferred locale.

### 7.13 Dashboard

The dashboard is the home page after login. Layout depends on role.

- **Soldier dashboard**:
  - **Today view**: what's my assignment today? (Bug-free version of the prior-art sheet's broken "today" view.)
  - **This week**: 7-day calendar view, my color highlighted.
  - **Open requests**: inbound swap requests awaiting my response; outbound swap requests I've proposed.
  - **Constraint status**: is the current window's lock approaching? Have I declared availability?
  - **Time clock**: big check-in/check-out button if enabled.
- **Manager dashboard**:
  - **All of the above** for their own assignments.
  - **Team calendar**: all soldiers, color-coded.
  - **Leaderboard with ASCII bars** (per-person shift counts visualized with `█████░░░░░` style bars). Preserved from prior art — beloved feature.
  - **Uncovered slots**: any shift instance in the next 7 days with no assignment.
  - **Pending swaps**: queue of swaps awaiting manager review.
- **Admin dashboard**:
  - **All of the above** aggregated across teams.
  - **Tenant health**: number of active users, active soldiers, current planning windows.
  - **Invite codes**: live codes, redemption counts.

**Per-person calendar colors**: every soldier has a `color` (hex). UI uses it consistently: calendar cell backgrounds, leaderboard bars, swap-request avatars. Preserved from prior art — beloved feature.

#### Graphs and statistics views

Beyond the tiles above, the dashboard exposes four scoped analytical views with charts. Chart library: leading candidate is `@lowdefy/blocks-echarts` (ECharts has solid Hebrew RTL support); confirmed at implementation. See §15. All charts render Hebrew labels with correct RTL orientation; cumulative per-soldier counts span all closed windows for that soldier within the tenant.

| View | Scope | Charts and metrics |
|------|-------|--------------------|
| Unit-level | Whole tenant | Total shifts assigned in active window; coverage rate (%); shift-slot distribution (bar chart); total swaps in window; top 3 most-swapped soldiers |
| Team (צוות)-level | One team | Same metrics as unit-level, scoped to the team; Gantt-style timeline of the team's active planning window |
| Per-soldier | One soldier | Total shifts (current window + cumulative); breakdown by shift-slot type (pie/bar); swap history; time-clock punctuality stats (avg delta between scheduled start and actual check-in); per-month shift-count trend as a sparkline |
| Leaderboard | One team | ASCII-bar leaderboard (preserved from prior art) AND a horizontal bar chart rendered alongside it for screen-reader accessibility |

**v1 acceptance criteria**: all four views render without errors; charts respect Hebrew RTL; per-soldier punctuality handles missing check-in records gracefully — shows "no data" (אין נתונים), never silently zero; today view works on first load (no Hebrew encoding bugs); leaderboard renders ASCII bars in a monospaced font alongside its accessible bar-chart twin; calendar colors persist and are used consistently across all views.

### 7.14 Schedule exports

The schedule lives in Postgres but managers and soldiers want it in the tools they already use — calendar apps, spreadsheets, printed paper. v1 ships three export formats, all triggered from the schedule view via a single "Export" button (the manager picks date range and scope; download is generated server-side and streamed back).

#### iCal (.ics)

- One `VEVENT` per assignment within the export window. Timezone `Asia/Jerusalem` baked into every event; calendar apps re-render locally.
- **Per-soldier scope** (most common): a soldier downloads only their own assignments. **Per-team scope**: a manager downloads the whole team's schedule.
- **Two delivery modes**: download a `.ics` file once (one-shot), OR subscribe to a signed long-lived URL (the calendar app polls it). Subscription URLs are per-soldier, generated lazily on first request, and revocable from the soldier's profile. Backed by `ical_subscription_token` (see §10); URL prefix from `ICAL_SUBSCRIPTION_BASE_URL` (see §17).

#### CSV

- Tabular dump for spreadsheet tools.
- **Columns** (header row, English names for tool interop): `date, shift_slot_name, start_time, end_time, soldier_id, soldier_name, soldier_role_tags, team_id, team_name`.
- **Date format**: ISO-8601 (`2026-05-15`). **Time format**: 24h local (`06:00`, `18:00`).
- **Encoding**: UTF-8 with BOM. The BOM is mandatory for Excel-on-Windows to render Hebrew names correctly; without it, names show as mojibake.

#### PDF

- Printable schedule for unit notice boards and shift handover. **Layout**: calendar grid; manager picks week or month view at export time. Per-day column with shift slots stacked, soldier names in cells, soldier color as the cell background.
- **Hebrew RTL**, Israeli date format (`DD/MM/YYYY`). **Page size**: A4 default; option for A3 for wider monthly views.
- **Rendering**: server-side via Puppeteer rendering a hidden HTML view styled for print. Engine choice flagged in §15 — Puppeteer is the leaning answer for RTL/Hebrew correctness; final call deferred to implementation. Timeout governed by `PDF_RENDER_TIMEOUT_SECONDS` (see §17).

**v1 acceptance criteria**: each format generates without errors for a typical 30-soldier × 30-day window in <5 seconds; Hebrew rendering correct in all three; iCal opens in Google Calendar, Apple Calendar, and Outlook without warnings; CSV opens in Excel-on-Windows with Hebrew names intact; PDF prints to A4 with no clipped columns.

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Surface | Target |
|---------|--------|
| Solver | <10s p95 for 30 soldiers × 30 days × 4 active rules |
| Page load (dashboard) | <2s p95 on 4G mobile |
| API roundtrip (Lowdefy → Postgres) | <500ms p95 for typical queries |
| Email delivery | <60s from event |
| WhatsApp delivery | <30s from event (best-effort) |
| Push delivery | <5s from event |

### 8.2 Security

- All routes authenticated except the magic-link request and the magic-link callback.
- Tenant scoping enforced server-side; client cannot escalate.
- Session tokens stored in HTTP-only secure cookies.
- All secrets in env vars; none in code or YAML.
- Postgres credentials never exposed beyond the docker network.
- Audit logs are append-only (no delete, no update on `*_audit` tables).
- CSRF protection on all state-changing endpoints (NextAuth provides this).
- Invite codes are not enumerable (no listing endpoint without auth + role check).

### 8.3 Authorization (RBAC matrix)

Four roles. Permission shorthand: `C`=create, `R`=read, `U`=update, `D`=delete; `CRUD`=all four; `R`=read-only; `R+W`=read and write but not delete; `none`=no access. A role with `R` on an entity sees only rows scoped per the Notes column. Tenant-scoping is implicit on every cell — no role can see another tenant's data.

| Area | Entity | tenant_admin | manager (team-scoped) | soldier | unauthenticated | Notes |
|------|--------|--------------|------------------------|---------|------------------|-------|
| Tenant & org | `tenant` | R+U | R | R | none | Admin can rename; org_depth immutable post-create |
| Tenant & org | `unit` (`org_unit` level=1) | CRUD | R | R | none | Single unit per tenant |
| Tenant & org | `platoon` (`org_unit` level=2) | CRUD | R | R | none | Only in 2/3-level orgs |
| Tenant & org | `team` (`org_unit` level=3 leaf) | CRUD | R+U on owned teams | R on member teams | none | Manager can rename own team; cannot create |
| People | `app_user` (own profile) | CRUD | R+U | R+U | none | Includes locale, color, notification prefs |
| People | `app_user` (other profiles) | CRUD | R within team scope | R within team scope | none | Soldiers see other team members' display data only |
| People | `soldier` | CRUD | R+U within team scope | R own | none | Manager edits seniority/role_tags/notes for own team |
| People | `invite_code` | CRUD | C+R+D within team scope | none | none | Manager generates codes only for own teams |
| Shifts | `team_shift_slot` (`shift_slot`) | CRUD | CRUD within team scope | R within team scope | none | Slot times define soldier-visible availability UI |
| Shifts | `role_tag` | CRUD | C+R+U within team scope | R | none | Tenant-scoped; inline-create from CSV import path |
| Shifts | `soldier_role_tags` (`soldier.role_tags`) | CRUD | R+U within team scope | R own | none | Tightening rule: soldier cannot self-grant tags |
| Rules | `rule` (team-level) | CRUD | CRUD within team scope | R within team scope | none | Manager owns rules for own team |
| Rules | `rule_override` (per-soldier) | CRUD | CRUD within team scope | R own | none | Override can only tighten (§7.6) |
| Availability | `availability_blockout` (`availability` rows with source=`range_blockout`) | CRUD | CRUD within team scope | CRUD own (until lock) | none | Post-lock: only manager (audited) |
| Availability | `availability_slot_override` (`availability` rows with source=`per_slot`) | CRUD | CRUD within team scope | CRUD own (until lock) | none | Same lock rules |
| Lifecycle | `schedule_draft` (`planning_window` state=draft) | R+U | CRUD within team scope | R within team scope | none | Only manager promotes to published |
| Lifecycle | `schedule_published` (`planning_window` state=published) | R+U | CRU within team scope (no delete; immutable after window close) | R within team scope | none | Edits captured as `manager_override` audit rows |
| Lifecycle | `assignment` | R+U | R+U within team scope | R own | none | Soldier can only mutate via swap_request |
| Lifecycle | `swap_request` | R+U | CRUD within team scope | C own; R+U on own counterparty rows | none | Manager approves; soldier accepts/declines |
| Solver | `solver_run` (read) | R | R within team scope | none | none | Audit-only |
| Solver | `solver_run` (trigger) | C | C within team scope | none | none | Triggering creates a draft schedule |
| Time clock | `time_clock_entry` (own) | CRUD | R+U own | CRUD own | none | Soldier can edit historical entries |
| Time clock | `time_clock_entry` (team) | R+U | R+U within team scope | none | none | Manager edits another soldier's entry → audit row |
| Time clock | `time_clock_entry` (tenant) | R+U | none | none | none | Admin sees aggregate across teams |
| Notifications | `notification_pref` (own) | CRUD | R+U own | R+U own | none | Per-event channel toggles |
| Notifications | `notification_log` (own) | R | R own | R own | none | History inspectable |
| Notifications | `notification_log` (team) | R | R within team scope | none | none | Manager sees delivery status for own team |
| Reporting | `report_subscription` (`report_recipient`) | CRUD | CRUD within team scope | none | none | External recipients managed by admin/manager |
| Exports | `ical_subscription_token` (own) | CRUD | R+U own | CRUD own | none | Soldier revokes own token; token URL acts as auth |
| Exports | `pdf_export` | R | C+R within team scope | C+R own (own scope) | none | Ephemeral; no row persisted |
| Exports | `csv_export` | R | C+R within team scope | C+R own (own scope) | none | Ephemeral; no row persisted |
| Imports | `roster_import_log` | CRUD | C+R+U within team scope | none | none | Manager runs imports for own team |
| Audit | `schedule_audit` (read) | R | R within team scope | R own (rows where the soldier is affected) | none | Append-only; no delete or update for any role |

**Enforcement**: a `tenant_id` filter is mandatory on every server-side query — derived from the authenticated session, never from request input. Lowdefy pages set a top-level `auth` block declaring the minimum role required to render the page; pages that mix roles (e.g., a soldier-readable view that hides manager-only controls) gate controls via conditional visibility on the same role check. Every request that mutates data re-checks the role on the server (Lowdefy `requests` block `properties.auth`) — never trust the client. The four-layer defense is: (1) session has a tenant_id; (2) query has a tenant_id filter; (3) page has an auth block; (4) request has a server-side role check. Missing any one of these is a release-blocking bug.

### 8.4 Test strategy

| Test type | Scope | Tool | Run when |
|-----------|-------|------|----------|
| Unit | Pure functions (solver constraint encoding, locale picking, HMAC token gen) | pytest (solver), vitest (Node helpers) | Pre-commit + CI |
| Integration | Solver service end-to-end against a real Postgres | pytest + testcontainers | CI |
| Schema/migration | Each new SQL migration applies cleanly to a fresh + an existing DB | docker compose + psql | CI |
| RBAC | Permission matrix enforced — admin/manager/soldier paths | Playwright + seeded fixtures | Pre-release |
| E2E (golden path) | Signup → invite → roster → availability → solve → publish → export | Playwright | Pre-release |
| RTL/Hebrew rendering | Email + PDF + UI render correctly in HE | Visual diff (Litmus for email, Playwright for UI) | Pre-release |
| Load (solver) | 30 soldiers × 30 days × 8 rules p95 ≤ 10s | Locust + synthetic data | Manual, pre-launch |
| Notification delivery | Email/WhatsApp/push reach recipients | Live integration test in staging | Pre-release |

**Test data**: a fixture set ("the kibbutz fixture") with 12 soldiers / 1 team / 64-day window mirroring the user's actual data, used everywhere. Smart-quote-variant names (one soldier with U+2019 in the display name) are intentionally seeded to enforce the canonical-key rule: every join must succeed against the smart-quoted row, every aggregation must count it correctly. The fixture lives in `tools/fixtures/kibbutz.sql` and is the seed for both local dev and CI integration tests.

### 8.5 i18n / RTL

- **Two locales for v1**: `he` (default, RTL) and `en` (alt, LTR).
- **Message format**: ICU MessageFormat. Files: `app/locales/he.json`, `app/locales/en.json`. Keys use dot-notation by feature (`shifts.assignment.notify.subject`).
- **Locale source**: `app_user.locale` column. NextAuth session carries it. Every server-rendered output (Lowdefy pages, email templates, PDF exports) picks the recipient's locale at render time.
- **RTL detection**: locale-driven (`he` → RTL). Lowdefy's `config.theme.direction` set per-request based on user.
- **Date/time**: `Asia/Jerusalem` timezone everywhere. Date format derives from locale (`he` → `DD/MM/YYYY`; `en` → `YYYY-MM-DD`). Time format: 24-hour (`HH:mm`) in both locales.
- **Numbers**: Latin numerals in both Hebrew and English UI (standard Israeli convention).
- **Hebrew + English in the same template**: Hebrew labels in `he.json` may include English (e.g., "Email" stays "Email" in both — common). No mixing in code.
- **Email templates**: Hebrew templates use `dir="rtl"` on the body; English templates LTR. Recipient locale on `app_user.locale` (or `report_recipient.locale` for external recipients) picks the template at send time.
- **Tooling**: a CI check fails the build if any key in `he.json` is missing in `en.json` (and vice versa). Script lives in `tools/check-locales.mjs`.

### 8.6 Accessibility

- WCAG 2.1 AA target for all interactive elements.
- Keyboard navigation throughout.
- Color is never the only signifier (leaderboard pairs color with the soldier name and the bar length).
- Sufficient color contrast on calendar cells.

### 8.7 Scalability

- v1 design target: 100 tenants × 200 soldiers × 1 active planning window per team. Postgres on a single instance is sufficient.
- v2 horizon: 1,000 tenants. Solver may need to move to a job queue with workers; database may need partitioning by tenant.
- Notification dispatch is currently synchronous within the app; if WAHA or Resend latency spikes, this is a known bottleneck. v1 mitigation: 3-retry with backoff. v1.1: extract to a background queue.

### 8.8 Backup & recovery

- **Postgres**: nightly `pg_dump --format=custom` to a hpg5 local path (`C:\shifts-manager\backups\pg\`). Retention: 14 daily + 8 weekly + 6 monthly. A small PowerShell script runs from Windows Task Scheduler; output written to `backups\pg\YYYY-MM-DD.dump`.
- **Off-host copy**: nightly `rclone` or `restic` push to a separate host (neshernas at `192.168.1.121` over Tailscale, or an S3-compatible bucket if available). The off-host copy is the disaster-recovery copy; the local copy is the convenience copy.
- **Restore drill**: quarterly. Spin up a parallel postgres container from the latest dump, run a connection-string swap test, point a staging Lowdefy at it, verify a known page renders end-to-end (signin → dashboard → schedule view).
- **PITR**: out of scope for v1. WAL archiving deferred to v1.1; the nightly-dump RPO of ~24h is acceptable for a tool whose hardest deadline is "tomorrow's schedule must be correct".
- **App config**: `app/lowdefy.yaml` + `db/migrations/` are in git; nothing else app-level requires backup.
- **Secrets**: `.env` on hpg5 is backed up encrypted (passphrase in 1Password). Recovery: paste-restore from the password manager.

---

## 9. Integration Requirements

### Resend (email)

- **API**: HTTP, `POST /emails` with bearer token (`RESEND_API_KEY`).
- **From address**: `shifty@nesher.co` (verified domain).
- **Templates**: Hebrew HTML with `dir="rtl"` on `<body>`; English HTML LTR. Locale resolved per recipient at send time.
- **Error handling**: 4xx → log, do not retry (likely template bug). 5xx → retry up to 3 times with exponential backoff (1s, 4s, 16s).
- **Webhooks**: Resend's `email.delivered`, `email.bounced`, `email.complained` events POST to `/api/webhooks/resend`. Used to update `notification_log.status`.

### WAHA (WhatsApp)

- **Self-hosted at**: `http://waha:3000` inside the compose stack (TBD; service to be added).
- **API**: HTTP, `POST /api/sendText` with a session token.
- **Phone numbers**: stored on `soldier.phone_e164`. Required for WhatsApp delivery. Soldier opts in by providing the number and enabling the WhatsApp channel on at least one event type.
- **Error handling**: WAHA is best-effort. Failed sends logged, no SLA. If the WAHA container is down, all WhatsApp dispatches fail-fast with `status=failed`; in-app notification still fires.
- **No QR-based session management automation in v1**: admin manually re-pairs WAHA when its WhatsApp session drops. Documented as an operational risk in §15.

### Web Push

- **VAPID keys**: generated at first deploy, stored as env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
- **Service worker**: `app/public/sw.js`. Registered on first load.
- **Subscription**: user opts in via profile page; browser prompts for permission; subscription stored as `push_subscription` row keyed on (`user_id`, `endpoint`).
- **Payload**: encrypted, max 4KB. Contains event type, summary, and a deep link.
- **Failure handling**: 410 Gone from the push service → delete the subscription row (browser revoked).

---

## 10. Data Model

The v1 schema in `db/migrations/0001_init.sql` covers `employees`, `shifts`, `assignments`, `availability`, `time_clock_entries`. The v2 schema extensions in this section migrate that to the full domain model.

**Hard rule from prior-art bug**: every domain table uses a UUID primary key. Display names are mutable and never used for joins. The smart-quote bug (`'` U+0027 vs `'` U+2019) that broke spreadsheet `COUNTIF` lookups in the prior-art sheet cannot recur because names are never join keys here.

### Migration `0002_tenancy_and_org.sql`

```sql
CREATE TABLE tenant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    org_depth       SMALLINT NOT NULL CHECK (org_depth BETWEEN 1 AND 3),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE org_unit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES org_unit(id) ON DELETE CASCADE,
    level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_unit_tenant ON org_unit(tenant_id);
CREATE INDEX idx_org_unit_parent ON org_unit(parent_id);

CREATE TABLE app_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    email           CITEXT NOT NULL,
    display_name    TEXT,
    locale          TEXT NOT NULL DEFAULT 'he',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

CREATE TABLE soldier (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES app_user(id) ON DELETE SET NULL,
    display_name    TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#888888',
    seniority       SMALLINT NOT NULL DEFAULT 0 CHECK (seniority BETWEEN 0 AND 10),
    role_tags       TEXT[] NOT NULL DEFAULT '{}'::text[],
    phone_e164      TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    time_clock_enabled BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_soldier_tenant ON soldier(tenant_id);
CREATE INDEX idx_soldier_user ON soldier(user_id);

CREATE TABLE membership (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id      UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    org_unit_id     UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('unit_admin', 'team_manager', 'member', 'viewer')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (soldier_id, org_unit_id)
);

CREATE INDEX idx_membership_tenant ON membership(tenant_id);
CREATE INDEX idx_membership_soldier ON membership(soldier_id);
CREATE INDEX idx_membership_org ON membership(org_unit_id);
```

### Migration `0003_shifts_and_windows.sql`

```sql
CREATE TABLE shift_slot (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    headcount           SMALLINT NOT NULL DEFAULT 1 CHECK (headcount >= 1),
    required_role_tags  TEXT[] NOT NULL DEFAULT '{}'::text[],
    min_seniority       SMALLINT,
    display_order       SMALLINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_slot_team ON shift_slot(team_id);

CREATE TABLE planning_window (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    constraint_lock_at  TIMESTAMPTZ NOT NULL,
    state               TEXT NOT NULL DEFAULT 'open'
                           CHECK (state IN ('open', 'draft', 'published', 'closed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_planning_window_team ON planning_window(team_id);

CREATE TABLE shift_instance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    planning_window_id  UUID NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    slot_id             UUID NOT NULL REFERENCES shift_slot(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    headcount_index     SMALLINT NOT NULL DEFAULT 0,
    UNIQUE (slot_id, date, headcount_index)
);

CREATE INDEX idx_shift_instance_window ON shift_instance(planning_window_id);
CREATE INDEX idx_shift_instance_date ON shift_instance(date);

-- Drop and recreate `assignments` to align with shift_instance
DROP TABLE IF EXISTS assignments;

CREATE TABLE assignment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    shift_instance_id   UUID NOT NULL REFERENCES shift_instance(id) ON DELETE CASCADE,
    soldier_id          UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shift_instance_id, soldier_id)
);

CREATE INDEX idx_assignment_soldier ON assignment(soldier_id);
CREATE INDEX idx_assignment_instance ON assignment(shift_instance_id);
```

### Migration `0004_availability_rules_swaps.sql`

```sql
-- Drop and recreate availability to align with shift_instance
DROP TABLE IF EXISTS availability;

CREATE TABLE availability (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id          UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    planning_window_id  UUID NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    shift_instance_id   UUID NOT NULL REFERENCES shift_instance(id) ON DELETE CASCADE,
    state               TEXT NOT NULL CHECK (state IN ('available', 'unavailable')),
    source              TEXT NOT NULL CHECK (source IN ('range_blockout', 'per_slot', 'manager_override')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (soldier_id, shift_instance_id)
);

CREATE INDEX idx_availability_soldier_window ON availability(soldier_id, planning_window_id);

CREATE TABLE rule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    rule_key            TEXT NOT NULL,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    value               JSONB,
    UNIQUE (team_id, rule_key)
);

CREATE TABLE rule_override (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    soldier_id          UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    rule_key            TEXT NOT NULL,
    value               JSONB NOT NULL,
    UNIQUE (soldier_id, rule_key)
);

CREATE TABLE swap_request (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    team_id                     UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    initiator_soldier_id        UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    initiator_assignment_id     UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    counterparty_soldier_id     UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
    counterparty_assignment_id  UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    state                       TEXT NOT NULL DEFAULT 'proposed'
                                  CHECK (state IN ('proposed', 'awaiting_mgr', 'approved', 'rejected')),
    auto_approve_eligible       BOOLEAN,
    state_history               JSONB NOT NULL DEFAULT '[]'::jsonb,
    manager_decision_at         TIMESTAMPTZ,
    manager_decision_actor_id   UUID REFERENCES app_user(id),
    manager_decision_reason     TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_swap_request_team_state ON swap_request(team_id, state);
```

### Migration `0005_auth_and_notifications.sql`

```sql
CREATE TABLE invite_code (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    org_unit_id     UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('unit_admin', 'team_manager', 'member', 'viewer')),
    code            TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ,
    max_uses        INTEGER,
    uses            INTEGER NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_code_code ON invite_code(code);

CREATE TABLE invite_code_redemption (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_code_id  UUID NOT NULL REFERENCES invite_code(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_pref (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    channels        JSONB NOT NULL,
    UNIQUE (user_id, event_type)
);

CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES app_user(id),
    event_type      TEXT NOT NULL,
    channel         TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'push', 'in_app')),
    status          TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')),
    provider_response JSONB,
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);

CREATE INDEX idx_notification_log_user ON notification_log(user_id);

CREATE TABLE push_subscription (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, endpoint)
);

CREATE TABLE report_recipient (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    org_unit_id     UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
    email           CITEXT NOT NULL,
    display_name    TEXT,
    locale          TEXT,
    subscriptions   JSONB NOT NULL DEFAULT '{"daily": false, "weekly": false, "event": false}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Migration `0006_audit_and_solver_runs.sql`

```sql
CREATE TABLE schedule_audit (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    planning_window_id  UUID NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    from_state          TEXT,
    to_state            TEXT NOT NULL,
    actor_user_id       UUID REFERENCES app_user(id),
    actor_kind          TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'solver')),
    payload             JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_audit_window ON schedule_audit(planning_window_id);

CREATE TABLE solver_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    planning_window_id  UUID NOT NULL REFERENCES planning_window(id) ON DELETE CASCADE,
    triggered_by        UUID REFERENCES app_user(id),
    request_payload     JSONB NOT NULL,
    response_payload    JSONB,
    status              TEXT NOT NULL CHECK (status IN ('running', 'optimal', 'feasible', 'infeasible', 'timeout', 'error')),
    solve_time_seconds  NUMERIC(6, 3),
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

-- Time clock entries already exist; ensure tenant_id and assignment_id columns
ALTER TABLE time_clock_entries
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES assignment(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('button', 'manual')),
    ADD COLUMN IF NOT EXISTS note TEXT;
```

### Migration `0007_imports_and_exports.sql`

Roster import audit log and signed iCal subscription tokens. Manual override events use the existing `schedule_audit` table with `to_state='manager_override'` and a `payload` carrying `{ previous_value, new_value, reason, force_override }`; no new table required. CSV and PDF exports are ephemeral — no DB writes — only iCal subscriptions persist a row.

```sql
-- Roster import audit log
CREATE TABLE roster_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES app_user(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  rows_total INTEGER NOT NULL,
  rows_created INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  rows_errored INTEGER NOT NULL DEFAULT 0,
  error_details JSONB
);
CREATE INDEX idx_roster_import_log_tenant_id ON roster_import_log(tenant_id);

-- Signed long-lived iCal subscription URLs (one per soldier)
CREATE TABLE ical_subscription_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  soldier_id UUID NOT NULL REFERENCES soldier(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_ical_subscription_token_soldier_id ON ical_subscription_token(soldier_id);
```

### `employees` table

The `0001_init.sql` `employees` table is **superseded by `soldier`**. Migration `0008_drop_legacy.sql` will drop `employees` once `soldier` is populated (no production data yet, so it's a one-shot replacement). Until then, `employees` stays for compatibility with the bootstrap app.

### 10.1 State machines

Each lifecycle in the system has a finite state machine. Captured here in one place so that solver, swap, override, and time-clock flows can be cross-checked against the same source of truth. State columns and audit tables are listed beside each diagram.

#### Assignment lifecycle

```
[null] → [proposed] (draft) → [assigned] (published) → [confirmed] (soldier acks) → [completed] (after shift) → [cancelled]
                                       ↓                                                         ↑
                                  [swapped] → [assigned] (with new soldier)         (manager any time before completed)
```

States: `proposed` (in draft window), `assigned` (published), `confirmed` (soldier acked in-app), `completed` (post-shift `now() > shift_instance.end`), `cancelled` (manager voided), `swapped` (transient marker during swap apply). Persisted on `assignment.state` (new column added in migration `0008_assignment_state.sql`); transitions logged to `schedule_audit`. Drivers: solver writes `proposed`; publish writes `assigned`; soldier ack writes `confirmed`; cron writes `completed`; manager writes `cancelled`; swap apply writes `swapped` then immediately `assigned` against the new soldier id.

#### Swap request lifecycle

```
[draft] → [pending_counterparty] → [pending_manager] → [approved] → [applied]
   ↓             ↓                          ↓                ↓
[cancelled]  [declined]              [rejected]       [reverted]
```

Persisted on `swap_request.state` (existing column; `state_history JSONB` captures every transition's `{from, to, actor, at, payload}`). Drivers: initiator → `draft` and `pending_counterparty`; counterparty → `declined` or transitions to `pending_manager`; manager → `rejected` or `approved`; system → `applied` (on assignment patch); manager → `reverted` (escape hatch within 24h of `applied`). Each transition fires the corresponding notification event from §7.11.

#### Invite code lifecycle

```
[active] → [redeemed] (one or more times) → [exhausted] (max_uses hit)
   ↓                                              ↓
[revoked] (admin action)                    [expired] (expires_at passes)
```

Persisted on `invite_code.uses`, `invite_code.expires_at`, and a derived `status` resolved at query time. No explicit state column; the state is the join of those three fields. Drivers: admin creates → `active`; user redeems → `uses++`; admin revokes → sets `revoked_at` (column added in migration `0008_invite_code_revoke.sql`).

#### Schedule (planning window) lifecycle

```
[no_schedule] → [draft] (solver run) → [published] → [archived] (window passes)
                  ↓                          ↓
             [solving]                   [republished] (after manual override)
```

Persisted on `planning_window.state` (existing). `solving` is the transient state during a solver call — set on `solver_run` insert, cleared on solver response. `republished` is not a distinct stored state; manual overrides increment a `version` on the window row and write `to_state='manager_override'` to `schedule_audit`. Window auto-archives on `end_date + 1 day` via cron.

#### `solver_run` lifecycle

```
[queued] → [running] → [succeeded] (optimal | feasible)
              ↓
         [failed] (timeout | error)
```

Persisted on `solver_run.status` (existing). Lowdefy inserts a row in `queued`, the solver call transitions through `running`, and the response is persisted with the terminal status (`optimal`, `feasible`, `infeasible`, `timeout`, or `error`). No retry on `failed`; manager re-runs manually.

#### `time_clock_entry` lifecycle

```
[in_progress] (check-in tapped, no check-out yet) → [closed] (check-out tapped or manual save)
                                                          ↓
                                                     [adjusted] (soldier edited times)
```

Derived state, not stored: `in_progress` when `ended_at IS NULL`; `closed` when both timestamps present; `adjusted` flagged by an `updated_at > created_at` check plus a `source='manual'` row. Drivers: soldier tap → in_progress / closed; soldier manual edit → adjusted; manager edits another soldier's entry → adjusted + a `schedule_audit` row with `actor_kind='user'` and `to_state='time_clock_adjustment'`.

---

## 11. Architecture

```
                      ┌────────────────────────────┐
                      │   Cloudflare Tunnel        │
                      │   apps.nesher.co           │
                      └─────────────┬──────────────┘
                                    │
                                    ▼
                      ┌────────────────────────────┐
                      │   hpg5 (Windows 11)        │
                      │   Docker Desktop           │
                      │   Compose stack:           │
                      │                            │
   ┌────────────────┐ │   ┌──────────────────┐    │
   │ Resend API     │◀┼──▶│ lowdefy          │    │
   └────────────────┘ │   │ (Next.js SSR)    │    │
                      │   │ port 8080:3000   │    │
   ┌────────────────┐ │   └────────┬─────────┘    │
   │ WAHA           │◀┼────────────┤              │
   └────────────────┘ │            │              │
                      │            ▼              │
   ┌────────────────┐ │   ┌──────────────────┐    │
   │ Web Push (VAPID)│◀┼──│ solver           │    │
   └────────────────┘ │   │ (FastAPI + ORTools)│   │
                      │   │ internal only    │    │
                      │   └────────┬─────────┘    │
                      │            │              │
                      │            ▼              │
                      │   ┌──────────────────┐    │
                      │   │ postgres 16      │    │
                      │   │ internal only    │    │
                      │   └──────────────────┘    │
                      │   ┌──────────────────┐    │
                      │   │ cron (node-cron) │    │
                      │   │ internal only    │    │
                      │   └──────────────────┘    │
                      └────────────────────────────┘
```

- **Lowdefy** is the only externally-facing service. Owns auth, request validation, persistence orchestration, notification dispatch, export generation, and the UI.
- **Solver** is internal-only. Stateless. Called by Lowdefy via HTTP on the docker network (`http://solver:8000/solve`).
- **Postgres** is internal-only. No host port exposed.
- **Cron service**: a small Node container (alpine + node-cron) responsible for periodic dispatching of daily/weekly digest emails, constraint-lock reminder notifications, and any future scheduled tasks. It reads cron expressions and HTTP target endpoints from env vars (`CRON_DAILY_REPORT_HOUR`, `CRON_WEEKLY_DIGEST_DOW`, `CRON_WEEKLY_DIGEST_HOUR`, etc.) and calls into Lowdefy's API surface at the right times. Stateless; restart-safe.
- **WAHA**, when added, sits in the same compose network at `http://waha:3000`.
- **Resend** and **Web Push** are external dependencies; Lowdefy calls them over HTTPS.

### Direction of calls

```
Browser  ─▶ Lowdefy ─▶ Postgres
                  └──▶ Solver ─▶ (no outbound calls)
                  └──▶ Resend (HTTPS)
                  └──▶ WAHA   (HTTP, internal)
                  └──▶ Web Push (HTTPS)
Cron     ─▶ Lowdefy (internal HTTP, triggers report runs)
```

The solver never calls back into Lowdefy. Lowdefy never calls the browser except via Web Push (browser-initiated subscription). The cron service only calls Lowdefy; it never touches Postgres or the solver directly.

### 11.1 HTTP endpoint catalog

Lowdefy doesn't expose arbitrary REST endpoints by default — most requests are page-bound and resolved server-side from YAML. The non-page-bound surface is small and explicit. Below is the complete HTTP surface a caller (browser, webhook source, or peer container) can reach.

#### Lowdefy (port 8080:3000, public via Cloudflare Tunnel)

| Path | Method | Auth | Caller | Purpose |
|------|--------|------|--------|---------|
| `/api/auth/*` | various | varies | Browser | NextAuth.js endpoints (signin, callback, session, csrf) |
| `/api/ical/<token>` | GET | Signed token | Calendar app polling | iCal subscription feed for one soldier |
| `/api/export/csv/<run_id>` | GET | Session | Browser | Streams CSV of a published schedule scope |
| `/api/export/pdf/<run_id>` | GET | Session | Browser | Streams PDF rendered via Puppeteer |
| `/api/webhook/waha` | POST | Shared secret (`WAHA_WEBHOOK_SECRET`) | WAHA | Inbound message acks / session-status |
| `/api/webhook/resend` | POST | Resend signature | Resend | Delivery / bounce / complaint notifications |
| `/api/internal/cron/<job_name>` | POST | Cron service secret (`CRON_SHARED_SECRET`) | cron container | Trigger periodic dispatchers (daily report, weekly digest, lock reminders) |

#### Solver (port 8000, internal only)

| Path | Method | Auth | Caller | Purpose |
|------|--------|------|--------|---------|
| `/solve` | POST | Bearer (`SOLVER_SHARED_SECRET`) | Lowdefy | Solve a planning window — see §7.8 |
| `/health` | GET | none | Compose / docker healthcheck | Liveness probe |

The Lowdefy-side `/api/internal/*` surface is not reachable from the public tunnel — only the cron container (same docker network) can hit it. The shared-secret env vars (`WAHA_WEBHOOK_SECRET`, `CRON_SHARED_SECRET`, `SOLVER_SHARED_SECRET`) are added to §17 alongside the existing inventory.

---

## 12. Key UX Flows

### 12.1 New tenant signup

```
User ───▶ Browser ───▶ Lowdefy             Resend            Postgres
  │ open /signup
  │ enter email
  │                 ───▶ POST /api/auth/signin
  │                                       ───▶ send magic link
  │                                                          ───▶ insert app_user (pending)
  │ click magic link in email
  │                 ───▶ GET /api/auth/callback
  │                                                          ───▶ update app_user (verified)
  │ prompt: "Create unit OR enter invite code"
  │ chooses "Create unit"
  │                 ───▶ POST /tenant/create
  │                                                          ───▶ insert tenant + org_unit (root)
  │                                                          ───▶ insert membership (unit_admin)
  │ ◀─── dashboard
```

### 12.2 Soldier joins via invite code

```
Admin ───▶ Lowdefy
  │ POST /invite/create (org_unit_id, role)
  │                  ───▶ insert invite_code (8-char base32)
  │ ◀─── code shown, copy-to-clipboard button
  │ shares via WhatsApp out-of-band

New soldier ───▶ Browser ───▶ Lowdefy        Resend         Postgres
  │ open /signup, enter email
  │                ───▶ magic link flow
  │                                       ───▶ link sent
  │ click link
  │ prompt: "Enter invite code"
  │ pastes "ABCD1234"
  │                ───▶ POST /invite/redeem
  │                                                          ───▶ validate (not expired, uses < max_uses)
  │                                                          ───▶ insert soldier
  │                                                          ───▶ insert membership
  │                                                          ───▶ insert invite_code_redemption
  │                                                          ───▶ increment invite_code.uses
  │ ◀─── dashboard
```

### 12.3 Manager runs solver and publishes

```
Manager ───▶ Lowdefy                          Solver              Postgres
  │ open planning window
  │ click "Run solver"
  │                ───▶ assemble request
  │                                                              ───▶ read soldiers, slots, availability, rules
  │                ───▶ POST /solve
  │                                          ───▶ CP-SAT solve
  │                                          ◀─── response (assignments + stats)
  │                                                              ───▶ insert solver_run
  │                                                              ───▶ upsert assignment rows
  │                                                              ───▶ update planning_window.state = 'draft'
  │ ◀─── draft schedule rendered on calendar
  │ inspect, optionally hand-edit
  │ click "Publish"
  │                ───▶ POST /window/publish
  │                                                              ───▶ update planning_window.state = 'published'
  │                                                              ───▶ insert schedule_audit (draft → published)
  │                ───▶ dispatch notifications (schedule_published)
  │                                          (email, push, in-app per recipient)
  │ ◀─── published view
```

### 12.4 Swap request lifecycle

```
Soldier A ───▶ Lowdefy                        Postgres              Soldier B
  │ pick own assignment + B's assignment
  │ submit swap
  │                ───▶ insert swap_request (state=proposed)
  │                ───▶ dispatch notification (swap_proposed) ─────▶ (in-app, push, WhatsApp)
  │
  │                                          Soldier B accepts
  │                                                                 ───▶ POST /swap/respond
  │                                          ◀───
  │                ───▶ run rules check on swapped state
  │                ───▶ if no violations: state = approved
  │                                        : patch assignments
  │                                        : dispatch (swap_approved)
  │                ───▶ if violations: state = awaiting_mgr
  │                                  : dispatch to manager
  │
  │                                          Manager reviews
  │                                                                 ───▶ POST /swap/decide
  │                ───▶ if approved: patch assignments
  │                                : insert schedule_audit
  │                                : dispatch (swap_approved)
  │                ───▶ if rejected: state = rejected
  │                                : dispatch (swap_rejected)
```

### 12.5 Daily report

```
Cron tick (07:00 Israel) ───▶ Lowdefy                Postgres           Resend
  │
  │                          ───▶ for each tenant:
  │                          ───▶   read today's assignments
  │                          ───▶   read unscheduled constraints
  │                          ───▶   read report_recipient rows
  │                          ───▶   render email in recipient locale (RTL for he)
  │                          ───▶   POST /emails ──────────────────────▶ deliver
  │                          ───▶   insert notification_log
  │                                                                       (webhook updates status later)
```

---

## 13. Phased Rollout

### v1 (this PRD)

- Tenancy, org tree, auth, invites
- Roster, shift schemas, planning windows
- **Roster CSV import** (elevated from v1.1)
- Availability (hybrid UX), constraint lock
- Rules engine (8-rule catalog, overrides)
- Solver service (CP-SAT)
- Schedule lifecycle (draft → publish, audit, **manager manual override**)
- Swap requests (with auto-approve, overrides-applied evaluation)
- Time clock (opt-in, button + manual, midnight-spanning one-row model)
- Notifications (email, WhatsApp, push, in-app; per-recipient locale)
- Reports (daily, weekly, event; per-recipient locale)
- **Dashboard with graphs and statistics** (unit / team / per-soldier / leaderboard views)
- **Schedule exports** (iCal one-shot + subscribe, CSV, PDF)
- Hebrew RTL UI, English LTR alternative
- `cron` service in the compose stack

### v1.1 (post-launch)

- Google Calendar two-way sync (deferred from v1; iCal export covers one-way needs)
- Calendar widget via Lowdefy npm plugin (FullCalendar-react)
- Mobile PWA install prompt
- Bulk operations beyond CSV import (bulk invite-code generation, bulk archive)
- Background job queue for notifications (extract from synchronous dispatch)
- Soldier-level "preferred days off" soft preference (informs fairness, not a hard rule)
- Multi-week recurring shift templates ("alternating weekends" pattern)
- Advanced reporting (custom date ranges, exportable analytics queries)
- Tenant-configurable "weekend" definition (Fri+Sat hardcoded in v1)

### v2 horizon

- Native mobile apps (or PWA hardening if PWA proves sufficient)
- Cross-team coverage (a soldier in team A can be borrowed by team B for a single shift)
- Multi-org membership (one user, multiple tenants)
- Rules expression DSL (escape valve for tenants whose rules don't fit the 8-rule catalog)
- Payroll export integrations
- Geofenced time-clock (opt-in per tenant)
- SLA-backed deliverability (e.g., move from WAHA to a commercial WhatsApp Business API)

### 13.1 v1 build dependency graph

The order in which v1 components must be built. Each arrow is "must precede"; siblings under a fork can be built in parallel by separate sub-agents.

```
[migrations 0001-0007]
        ↓
[auth + tenancy + RBAC]
        ↓
        ├──→ [units + platoons + teams CRUD]
        │           ↓
        │      [shift slots CRUD]
        │           ↓
        │      [role tags + seniority]
        │           ↓
        │      [soldiers CRUD] ←──[CSV roster import]
        │           ↓
        │      [availability submission UI]
        │           ↓
        │      [rules engine config]
        │           ↓
        │      [solver service /solve]
        │           ↓
        │      [draft generation + manager edit]
        │           ↓
        │      [publish + assignment view]
        │           ↓
        │      ├──→ [swap workflow]
        │      ├──→ [manager manual override]
        │      ├──→ [time clock]
        │      ├──→ [dashboard]
        │      └──→ [exports: iCal, CSV, PDF]
        │
        └──→ [notification dispatcher + Resend + WAHA + Push + in-app]
                    ↓
              [cron service + daily/weekly reports + lock reminders]
```

Collapsed into phases:

1. **Foundations** — migrations 0001–0007, auth + tenancy + RBAC. Nothing user-visible until this is done.
2. **Org & people** — units, platoons, teams, soldiers, role tags, CSV roster import. The roster is the precondition for everything else.
3. **Availability & rules** — availability submission UI, rules engine config, constraint lock. Without these the solver has nothing to chew on.
4. **Solver & schedule** — solver service, draft generation, manager edit, publish. The headline feature.
5. **Lifecycle features** — swap workflow, manager manual override, time clock. Make the schedule a living document.
6. **Notifications & reports** — dispatcher across all four channels, cron service, daily and weekly reports, lock reminders. Built in parallel with phase 5 once the dispatcher is up.
7. **Polish & exports** — dashboard charts, iCal/CSV/PDF exports, English-locale parity. The last-mile delight features.

### 13.2 Migration from the existing Google Sheet (tenant #1)

The user's existing Google Sheet is the de-facto seed dataset for tenant #1 (the user's own unit). This subsection spells out the one-time migration path. Future tenants do not migrate — they use signup + invite codes + CSV roster import (see closing paragraph).

- **Source**: Google Sheet `1GlT_Qu4Fi3gl0qSMp798mg0wKEEG1_-iSNrVjQkV8wI` — tabs `groups`, `משמרות הערכה ועיבוד`, `settings`.
- **What migrates**:
  - **Soldiers** from `groups` tab → roster CSV → Roster CSV Import (§7.3.1).
  - **Constraints** for the current window from the constraints block (rows 14–29) → `availability_blockout` rows.
  - **Rules** from `settings` tab (`consecutive_night_limit`, `rule_no_same_day`, `rule_no_consecutive_shift2_shift1`, `rule_weekend_separation`) → team `rule` rows with values transferred.
  - **Existing assignments** (the hand-typed grid) → `assignment` rows with a `source: 'imported'` marker on `schedule_audit.payload`.
- **What doesn't migrate**:
  - Dashboard data, formulas, ASCII bars — re-derive from migrated assignments + a fresh `solver_run` against the next planning window.
  - Smart-quote-variant names → canonicalized at import (script strips U+2019, replaces with the apostrophe-free canonical form before writing `soldier.display_name`).
  - The draft tab — assume the prod tab is the source of truth.
- **How**: a one-off CLI/script in `tools/migrate-from-sheet/` (Python preferred — matches the solver's language; Node acceptable). The sheet is publicly readable, so `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&gid=<tab_gid>` works without auth. The script reads the three CSVs and emits SQL `INSERT` statements ordered by FK dependency (tenant → org_unit → soldier → shift_slot → planning_window → shift_instance → availability → assignment → rule).
- **Verification**: after import, the user manually compares a sample week's schedule between the sheet and the app, side by side. If they match cell-for-cell, the sheet is archived (set to read-only at the Drive level) and the app becomes canonical. If they don't match, the import is rolled back via `TRUNCATE` on the tenant's rows (the script keeps the tenant_id handy) and the script is fixed.
- **Out of scope**: ongoing two-way sync. Once migrated, the sheet is frozen. Users who continue to type into the sheet are doing so against an outdated copy.

**Second tenant onwards**: no migration needed. They sign up at `apps.nesher.co`, the founding admin becomes `unit_admin`, they configure org depth, add teams, invite soldiers via codes, and import their roster via CSV. The Google Sheet migration path is tenant-#1-only and is deleted from `tools/` once tenant #1 confirms success.

---

## 14. Out of Scope for v1

| # | Item | Why deferred |
|---|------|--------------|
| 1 | Native mobile apps | PWA + Web Push covers the mobile use case at v1 scale |
| 2 | Cross-team / cross-tenant coverage | Adds membership + availability complexity; not validated by discovery |
| 3 | Multi-org membership for one user | One-user-one-tenant simplifies auth and RLS; revisit if real demand |
| 4 | Payroll integration | Out of domain; time-clock data is exportable as CSV |
| 5 | Geofenced time-clock | Privacy + ops cost; no compelling v1 use case |
| 6 | SMS auth | Magic link works; SMS adds carrier integrations |
| 7 | Phone-call notifications | Out of domain |
| 8 | Rules expression DSL | 8-rule catalog covers prior-art needs; DSL is a future escape valve |
| 9 | Google Calendar 2-way sync | iCal subscription covers the read-side use case; bidirectional sync is a v1.1 enabler |
| 10 | Calendar widget via Lowdefy npm plugin | Defer to v1.1; v1 uses a simpler day-list view |
| 11 | Multi-language UI beyond Hebrew + English | No discovery signal for other languages |

---

## 15. Risks & Open Questions

### Risks (specific and quantified)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Solver exceeds 10s target on a tenant with >50 soldiers and >30-day window with all 8 rules enabled | Medium | High (manager UX) | Profile early with synthetic loads; if exceeded, expose `max_seconds` per-tenant and degrade gracefully to feasible-not-optimal |
| R2 | WAHA's self-hosted WhatsApp session drops and admin doesn't notice for hours; soldiers miss swap notifications | High | Medium | Health check endpoint on WAHA; in-app alert banner when WAHA reports session-down; fallback to in-app + push always present |
| R3 | Resend domain reputation tanks if a tenant's daily email goes to a list of unverified external recipients who mark as spam | Low | High (deliverability for all tenants) | Validate recipient emails on add; surface bounce/complaint rate to the admin; suspend a tenant's sending privileges if bounce rate > 5% |
| R4 | Tenant-isolation bug in a Lowdefy YAML query (forgot `tenant_id` filter) leaks data | Medium | Critical | Code-review checklist; integration test suite covering every list/detail endpoint; database-level RLS as a second layer once Lowdefy supports it cleanly |
| R5 | Hebrew RTL rendering bugs in email clients (Outlook in particular) garble the daily report | Medium | Medium | Test in Litmus / Email-on-Acid on every template change; ship a plain-text fallback in every email |
| R6 | hpg5 is a single Windows desktop in someone's home; power outage = full service downtime | Medium | High | Document the operational reality; v1 is acceptable; v1.1 considers a cloud move |
| R7 | Docker Desktop on hpg5 requires an interactive session for credential helper; if the `claude` user gets logged out, `docker pull` fails until someone fixes it | Low | Medium | Sysinternals Autologon is configured; documented in `CLAUDE.md` |
| R8 | Smart-quote-style name normalization bugs in display logic (different from join logic, but still UI-breaking) | Medium | Low | Centralize display normalization in one helper; UI never re-derives keys from names |
| R9 | Solver returns `infeasible` but the manager can't tell which soldier × rule combination is the culprit | Medium | Medium | Solver's `infeasibility_report.offending_rules` field is mandatory in every infeasible response; v1.1 adds soldier-level attribution |
| R10 | Constraint-lock deadline silently passes during a holiday and soldiers don't realize availability is frozen | High | Low | `constraint_lock_approaching` notification 24h pre-lock; banner in the app post-lock |
| R11 | iCal subscription URL leaks (forwarded by recipient, screenshotted) — long-lived signed URL with no auth header exposes a soldier's schedule | Medium | Low | Per-token revoke from soldier profile; rate-limit on the endpoint; token carries `tenant_id + soldier_id + HMAC`; optional expiry; documented as accepted residual risk |

### Decided since draft

1. **Cron location**: Separate compose service `cron`. (Decided 2026-05-12.)
2. **VAPID key rotation**: v1 does NOT rotate keys; rotation invalidates all push subscriptions and forces re-subscribe — acceptable v1 trade-off. (Decided 2026-05-12.)
3. **Swap auto-approve evaluation**: Evaluate against team rules WITH per-soldier overrides applied. Overrides are tightenings, so the strictest check is correct. (Decided 2026-05-12.)
4. **Per-recipient email locale**: Each user sets their preferred locale in their profile. Outbound emails respect the recipient's profile locale. (Decided 2026-05-12.)
5. **"Weekend" definition**: Friday + Saturday (Israeli weekend), hardcoded in solver for v1. Configurable per tenant in v2. (Decided 2026-05-12.)
6. **Midnight-spanning time-clock entries**: One row with `started_at` and `ended_at` that may cross the date boundary. No special DDL — just standard `timestamptz` range. (Decided 2026-05-12.)
7. **Solver `random_seed` exposure**: Hidden from the manager UI. Stored on `solver_run` for engineer-side debugging only. (Decided 2026-05-12.)
8. **CSV roster import**: MOVED FROM v1.1 to v1.0. Spec'd in new §7.3.1. (Decided 2026-05-12.)

### Open (fresh)

1. **PDF rendering engine**: Puppeteer-in-container (heavier; reliable RTL Hebrew + custom fonts) vs wkhtmltopdf (lighter; flaky on RTL). Decide at implementation. Leaning Puppeteer for Hebrew correctness.
2. **Dashboard chart library**: `@lowdefy/blocks-echarts` (ECharts) is the leading candidate — ECharts has solid RTL and Hebrew text support. Confirm at implementation by rendering a sample bar chart with Hebrew labels.
3. **iCal subscription token security**: Long-lived signed URLs are necessary because calendar apps (Google/Apple/Outlook) don't carry auth headers. Mitigation: per-token revoke, optional expiry, rate-limit on the endpoint, signed token includes tenant_id + soldier_id + secret HMAC. Confirm acceptable security posture before launch.

---

## 16. Success Metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| Time-to-first-published-schedule | <30 minutes from signup | Self-reported in onboarding survey; backend timestamp deltas |
| Solver latency (p95) | <10s for 30 soldiers × 30 days × 4 rules | `solver_run.solve_time_seconds` |
| Email delivery success rate | >99% (after retries) | `notification_log.status` counts |
| WhatsApp delivery success rate | >90% best-effort | `notification_log.status` counts |
| Swap-request resolution time (median) | <2 hours from proposal to final state | `swap_request` timestamps |
| Daily report delivery completeness | 100% of subscribed recipients receive by 08:00 Israel | `notification_log` |
| Cross-tenant data leak count | 0 | Integration test pass rate + manual penetration |
| Manager hand-edit rate on draft | <30% of solver runs require manual edits before publish | `schedule_audit` payload |
| Constraint declaration rate | >80% of soldiers declare availability before lock | `availability` rows vs. roster size |

---

## 17. Appendix: Environment Variables

Inventory only. No secrets included.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Lowdefy, solver | Postgres connection string (`postgres://shifts:****@postgres:5432/shifts`) |
| `NEXTAUTH_URL` | Lowdefy | Public origin (`https://apps.nesher.co`) |
| `NEXTAUTH_SECRET` | Lowdefy | Session signing |
| `RESEND_API_KEY` | Lowdefy | Resend HTTP auth (provisioned by user; not committed) |
| `RESEND_FROM_EMAIL` | Lowdefy | `shifty@nesher.co` |
| `WAHA_BASE_URL` | Lowdefy | Internal URL (`http://waha:3000`) |
| `WAHA_API_KEY` | Lowdefy | WAHA session token |
| `WAHA_WEBHOOK_SECRET` | Lowdefy | Shared secret for inbound WAHA webhook (`/api/webhook/waha`) |
| `VAPID_PUBLIC_KEY` | Lowdefy, browser | Web Push public key |
| `VAPID_PRIVATE_KEY` | Lowdefy | Web Push private key |
| `VAPID_SUBJECT` | Lowdefy | Contact mailto (`mailto:omernesher@gmail.com`) |
| `SOLVER_BASE_URL` | Lowdefy | Internal URL (`http://solver:8000`) |
| `SOLVER_MAX_SECONDS` | Lowdefy | Default solver timeout (10) |
| `SOLVER_SHARED_SECRET` | Lowdefy, solver | Bearer token for `/solve` |
| `CRON_SHARED_SECRET` | Lowdefy, cron | Bearer token for `/api/internal/cron/*` |
| `APP_DEFAULT_LOCALE` | Lowdefy | `he` |
| `APP_DEFAULT_TIMEZONE` | Lowdefy, solver | `Asia/Jerusalem` |
| `ICAL_SUBSCRIPTION_BASE_URL` | Lowdefy | Full URL prefix for signed iCal subscription URLs (e.g., `https://apps.nesher.co/api/ical/`) |
| `PDF_RENDER_TIMEOUT_SECONDS` | Lowdefy | Server-side PDF render timeout (default 30) |
| `CRON_DAILY_REPORT_HOUR` | cron service | Default 7 (local time) |
| `CRON_WEEKLY_DIGEST_DOW` | cron service | Default `MON` |
| `CRON_WEEKLY_DIGEST_HOUR` | cron service | Default 8 |
| `POSTGRES_PASSWORD` | postgres container | Set by compose; not consumed by app code |
| `POSTGRES_USER` | postgres container | `shifts` |
| `POSTGRES_DB` | postgres container | `shifts` |

All values live in `.env` on hpg5; `.env.example` ships in the repo as a template with empty values.

---

## End of PRD
