# Shifty — Product Requirements Document

**Status**: Draft v1
**Last updated**: 2026-05-12
**Audience**: Engineering (build), Product (review), Future contributors (onboard)

This document is the contract between product intent and the codebase. Locked decisions are stated as decisions, not options. Open questions live in §15 only.

---

## 1. Executive Summary

Shifty is a multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. The product replaces the spreadsheet-based workflows that miluim units improvise during call-ups — typically a hand-typed Google Sheet maintained by one overworked מפקד (commander), with constraints collected over WhatsApp and a daily report copy-pasted into a unit group chat.

The product wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first, RTL web app. Soldiers self-declare availability inside a planning window; the manager runs the solver to produce a draft schedule, reviews it, publishes it, and from there the schedule is a living document — soldiers can request swaps, the manager approves (auto-approves when no rules are violated), and notifications fan out via Email, WhatsApp, Push, and in-app inbox.

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
- **Mutation post-publish**: only via approved swap requests (see §7.10) OR manager direct edit (which writes an audit row labeled `manager_edit`).
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

**v1 acceptance criteria**: full lifecycle works end-to-end; audit log captures every transition; publish triggers notifications; closed windows are immutable except for time-clock corrections.

### 7.8 Solver service (API contract + behavior)

- **Language**: Python 3.12.
- **Framework**: FastAPI.
- **Solver**: OR-Tools CP-SAT.
- **Deployment**: Docker image in `solver/`, joined to the compose stack as service `solver`. Internal-only; no host port exposed.
- **Stateless**: solver does not read or write the database. Lowdefy is responsible for assembling the request, calling the solver, and persisting the response.

#### Endpoint: `POST /solve`

Request schema:

```json
{
  "request_id": "uuid",
  "window": {
    "start_date": "2026-05-15",
    "end_date": "2026-05-29",
    "timezone": "Asia/Jerusalem"
  },
  "team": {
    "id": "uuid",
    "name": "צוות א"
  },
  "shift_slots": [
    {
      "id": "uuid",
      "name": "בוקר",
      "start_time": "06:00",
      "end_time": "18:00",
      "headcount": 1,
      "required_role_tags": [],
      "min_seniority": null
    }
  ],
  "soldiers": [
    {
      "id": "uuid",
      "display_name": "...",
      "seniority": 3,
      "role_tags": ["medic"],
      "active": true
    }
  ],
  "availability": [
    {
      "soldier_id": "uuid",
      "shift_instance_id": "uuid",
      "state": "available"
    }
  ],
  "shift_instances": [
    {
      "id": "uuid",
      "slot_id": "uuid",
      "date": "2026-05-15"
    }
  ],
  "rules": {
    "no_same_day_double": true,
    "no_consecutive_shift2_then_shift1": true,
    "max_consecutive_nights": 3,
    "weekend_separation": true,
    "max_weekly_hours": 60,
    "min_rest_hours_between_shifts": 8,
    "max_shifts_per_period": null,
    "fairness_objective": "count_variance"
  },
  "rule_overrides": [
    {
      "soldier_id": "uuid",
      "rule_key": "max_consecutive_nights",
      "value": 2
    }
  ],
  "solver_options": {
    "max_seconds": 10,
    "random_seed": 42
  }
}
```

Response schema:

```json
{
  "request_id": "uuid",
  "status": "optimal | feasible | infeasible | timeout",
  "solve_time_seconds": 4.21,
  "assignments": [
    {
      "shift_instance_id": "uuid",
      "soldier_id": "uuid"
    }
  ],
  "stats": {
    "per_soldier_shift_counts": {
      "soldier_uuid": 4
    },
    "per_soldier_night_counts": {
      "soldier_uuid": 1
    },
    "per_soldier_total_hours": {
      "soldier_uuid": 48
    },
    "uncovered_instances": ["uuid"]
  },
  "infeasibility_report": {
    "offending_rules": ["max_weekly_hours"],
    "explanation": "Soldier UUID exceeds max_weekly_hours regardless of assignment."
  }
}
```

- **Performance target**: <10 seconds for a 30-day window with 30 soldiers and 4 active rules.
- **Timeout behavior**: if `max_seconds` is hit before optimality, return best-feasible with `status=feasible`. If no feasible solution exists, return `status=infeasible` with the offending-rules report.
- **Determinism**: same input + same seed = same output. Important for reproducible debugging.
- **No persistence**: the solver does not log requests/responses to disk in production (memory-only, with optional debug log to stderr). Lowdefy stores the request and response in `solver_run` for audit.

**v1 acceptance criteria**: solver returns optimal or feasible within target latency for realistic inputs; infeasibility report names the rule(s); stateless behavior verified by black-box test.

### 7.9 Time clock

- **Opt-in per soldier** (`soldier.time_clock_enabled` boolean).
- **Two input modes**:
  - **Button**: big mobile-friendly button labeled "Check in" (כניסה). Tap → captures `now()` as start time. Button becomes "Check out" (יציאה). Next tap → captures `now()` as end time, persists the entry, button resets.
  - **Manual time pickers**: type/pick start and end times; submit to create or amend an entry.
- **Data**: `time_clock_entries` (already in schema). Columns: `id`, `tenant_id`, `soldier_id`, `started_at`, `ended_at`, `source` (`button` | `manual`), `assignment_id` (nullable; for linking to a shift instance), `note`.
- **No geofencing.** No location data captured.
- **Use cases**:
  - Personal stats (total hours, per-week breakdown).
  - Manager audit (export per-soldier hours).
  - Dispute resolution (soldier says they were on duty; entries support the claim).
- **Explicitly NOT used for**: future scheduling decisions, payroll, performance reviews.

**v1 acceptance criteria**: soldier can tap-tap on phone to log a shift; soldier can edit a past entry's times; manager can view team-level time-clock summary.

### 7.10 Swap requests

- **Initiator**: soldier A picks one of their own published assignments AND one of soldier B's published assignments. (1-for-1 swap only in v1.)
- **Counterparty**: soldier B receives a notification and accepts or declines via in-app inbox.
- **Manager review**: triggered after B accepts.
  - **Auto-approve**: if running the rules engine on the swapped state produces zero violations, the swap auto-approves. Notifications fire.
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

**v1 acceptance criteria**: full swap loop works end-to-end; auto-approve triggers correctly; manual review queue surfaces violations; audit captures every state change.

### 7.11 Notifications

- **Channels** (each opt-in per user × event-type):

| Channel | Transport | v1 status |
|---------|-----------|-----------|
| Email | Resend API | Required |
| WhatsApp | WAHA self-hosted | Required (best-effort) |
| Push | Web Push API + service worker | Required |
| In-app | Bell icon + queue table | Required |

- **Event types** (default channel set per event in parentheses):

| Event | Default channels |
|-------|------------------|
| `schedule_published` | Email + In-app + Push |
| `swap_proposed` (to counterparty) | In-app + Push + WhatsApp |
| `swap_accepted` (to initiator) | In-app + Push |
| `swap_approved` (to all affected) | Email + In-app + Push |
| `swap_rejected` (to initiator) | In-app + Push |
| `manager_override` (to soldier) | In-app + Email |
| `constraint_lock_approaching` (to soldier, 24h before lock) | In-app + WhatsApp |
| `constraint_lock_passed` (to soldier) | In-app |
| `assignment_changed` (manager direct edit; to soldier) | Email + In-app + Push |
| `daily_report` (to subscribed recipients) | Email |
| `weekly_digest` (to subscribed recipients) | Email |

- **Per-user override**: profile UI lets the user pick channels per event. Stored as `notification_pref` rows: (`user_id`, `event_type`, `channels JSONB`).
- **Sending pipeline**:
  - Event fires in Lowdefy.
  - Notification dispatcher (a Lowdefy operator OR a small Node helper in the app container) loads per-user prefs, builds the message in Hebrew, dispatches to each channel.
  - Each channel has its own delivery target: Resend HTTP, WAHA HTTP, Web Push (VAPID), in-app row insert.
  - All deliveries logged to `notification_log` with `status` (`queued`, `sent`, `delivered`, `failed`, `bounced`) and `provider_response`.
- **Delivery SLAs**:
  - Email: <60 seconds from event.
  - WhatsApp: <30 seconds from event (best-effort; no provider SLA — WAHA is self-hosted on an unofficial WhatsApp HTTP gateway).
  - Push: <5 seconds from event (subject to browser availability).
  - In-app: instant.
- **Hebrew templates**: each event has a Hebrew template file in `app/templates/`. RTL-correct. Variables substituted at send time.

**v1 acceptance criteria**: all four channels deliver successfully in dev and prod; per-user prefs honored; failed sends retry up to 3 times with exponential backoff; notification log inspectable by admin.

### 7.12 Reporting

- **Three cadences, all running simultaneously, recipients managed per-cadence**:

| Cadence | When | Content |
|---------|------|---------|
| Daily email | Every morning at admin-configured time (default 07:00 Israel) | Today's assignments + unscheduled soldiers' constraints for visibility |
| Weekly Monday digest | Mondays at admin-configured time (default 08:00 Israel) | Upcoming week's schedule + per-soldier shift counts + uncovered slots flagged |
| Event-driven | Real-time | `schedule_published`, `swap_approved`, `assignment_changed` |

- **Recipients**: managed in unit's "Reports" settings tab. Each recipient = a row in `report_recipient` with `email`, `display_name`, `subscriptions JSONB` listing which cadences they're on.
- **Recipients can be users or external (email-only).** External recipients (P4 auditor pattern) have no login.
- **Content for daily report** (preserve the prior-art sheet's daily email shape):
  - Date header (Hebrew, RTL).
  - Today's assignments grouped by team and slot.
  - Soldiers not assigned today, with their declared constraints (`constraint_summary` field).
  - Link to today's calendar view in the app (`https://apps.nesher.co/today`).
- **Content for weekly digest**:
  - Week range.
  - Day-by-day mini-table.
  - Leaderboard (ASCII bars; see §7.13).
  - Uncovered slots flagged with a red marker.
- **Sending**: cron in Lowdefy (or compose-level cron container) triggers; Resend handles delivery; failures logged to `notification_log`.

**v1 acceptance criteria**: a fresh tenant subscribed to daily reports gets their first email the next morning; weekly digest fires Monday; event-driven reports fire within 60s of the trigger.

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

**v1 acceptance criteria**: today view works on first load (no Hebrew encoding bugs); leaderboard renders ASCII bars in a monospaced font; calendar colors persist and are used consistently across all views.

---

## 8. Non-Functional Requirements

### Performance

| Surface | Target |
|---------|--------|
| Solver | <10s p95 for 30 soldiers × 30 days × 4 active rules |
| Page load (dashboard) | <2s p95 on 4G mobile |
| API roundtrip (Lowdefy → Postgres) | <500ms p95 for typical queries |
| Email delivery | <60s from event |
| WhatsApp delivery | <30s from event (best-effort) |
| Push delivery | <5s from event |

### Security

- All routes authenticated except the magic-link request and the magic-link callback.
- Tenant scoping enforced server-side; client cannot escalate.
- Session tokens stored in HTTP-only secure cookies.
- All secrets in env vars; none in code or YAML.
- Postgres credentials never exposed beyond the docker network.
- Audit logs are append-only (no delete, no update on `*_audit` tables).
- CSRF protection on all state-changing endpoints (NextAuth provides this).
- Invite codes are not enumerable (no listing endpoint without auth + role check).

### i18n / RTL

- **Default language: Hebrew.** Layout RTL.
- **English available** as a per-user preference; layout LTR when English is selected.
- All UI strings live in i18n bundles in `app/locales/he.yaml` and `app/locales/en.yaml`.
- Date format: `DD/MM/YYYY` (Hebrew and English).
- Time format: 24-hour (`HH:mm`).
- Numbers and times remain Latin numerals in Hebrew UI (standard Israeli convention).
- Email templates: Hebrew templates use `dir="rtl"` on the body; English templates LTR.

### Accessibility

- WCAG 2.1 AA target for all interactive elements.
- Keyboard navigation throughout.
- Color is never the only signifier (leaderboard pairs color with the soldier name and the bar length).
- Sufficient color contrast on calendar cells.

### Scalability

- v1 design target: 100 tenants × 200 soldiers × 1 active planning window per team. Postgres on a single instance is sufficient.
- v2 horizon: 1,000 tenants. Solver may need to move to a job queue with workers; database may need partitioning by tenant.
- Notification dispatch is currently synchronous within the app; if WAHA or Resend latency spikes, this is a known bottleneck. v1 mitigation: 3-retry with backoff. v1.1: extract to a background queue.

---

## 9. Integration Requirements

### Resend (email)

- **API**: HTTP, `POST /emails` with bearer token (`RESEND_API_KEY`).
- **From address**: `shifty@nesher.co` (verified domain).
- **Templates**: Hebrew HTML with `dir="rtl"` on `<body>`.
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

### `employees` table

The `0001_init.sql` `employees` table is **superseded by `soldier`**. Migration `0007_drop_legacy.sql` will drop `employees` once `soldier` is populated (no production data yet, so it's a one-shot replacement). Until then, `employees` stays for compatibility with the bootstrap app.

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
                      └────────────────────────────┘
```

- **Lowdefy** is the only externally-facing service. Owns auth, request validation, persistence orchestration, notification dispatch, and the UI.
- **Solver** is internal-only. Stateless. Called by Lowdefy via HTTP on the docker network (`http://solver:8000/solve`).
- **Postgres** is internal-only. No host port exposed.
- **WAHA**, when added, sits in the same compose network at `http://waha:3000`.
- **Resend** and **Web Push** are external dependencies; Lowdefy calls them over HTTPS.

### Direction of calls

```
Browser  ─▶ Lowdefy ─▶ Postgres
                  └──▶ Solver ─▶ (no outbound calls)
                  └──▶ Resend (HTTPS)
                  └──▶ WAHA   (HTTP, internal)
                  └──▶ Web Push (HTTPS)
```

The solver never calls back into Lowdefy. Lowdefy never calls the browser except via Web Push (browser-initiated subscription).

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
  │                          ───▶   render Hebrew RTL email
  │                          ───▶   POST /emails ──────────────────────▶ deliver
  │                          ───▶   insert notification_log
  │                                                                       (webhook updates status later)
```

---

## 13. Phased Rollout

### v1 (this PRD)

- Tenancy, org tree, auth, invites
- Roster, shift schemas, planning windows
- Availability (hybrid UX), constraint lock
- Rules engine (8-rule catalog, overrides)
- Solver service (CP-SAT)
- Schedule lifecycle (draft → publish, audit)
- Swap requests (with auto-approve)
- Time clock (opt-in, button + manual)
- Notifications (email, WhatsApp, push, in-app)
- Reports (daily, weekly, event)
- Dashboard (today view, leaderboard, calendar)
- Hebrew RTL UI, English LTR alternative

### v1.1 (post-launch)

- Google Calendar two-way sync (deferred from v1)
- Calendar widget via Lowdefy npm plugin (FullCalendar-react)
- Bulk operations (bulk invite-code generation, bulk roster import via CSV)
- Background job queue for notifications (extract from synchronous dispatch)
- Soldier-level "preferred days off" soft preference (informs fairness, not a hard rule)
- Multi-week recurring shift templates ("alternating weekends" pattern)

### v2 horizon

- Native mobile apps (or PWA hardening if PWA proves sufficient)
- Cross-team coverage (a soldier in team A can be borrowed by team B for a single shift)
- Multi-org membership (one user, multiple tenants)
- Rules expression DSL (escape valve for tenants whose rules don't fit the 8-rule catalog)
- Payroll export integrations
- Geofenced time-clock (opt-in per tenant)
- SLA-backed deliverability (e.g., move from WAHA to a commercial WhatsApp Business API)

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
| 9 | Google Calendar sync | Prior art used it, but it's a v1.1 enabler — not blocking the core loop |
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

### Open questions

These are genuinely undecided. Decisions needed before or during build.

1. **Where does the cron live?** Lowdefy doesn't have a built-in scheduler. Options: (a) a tiny Node sidecar in the app container reading cron expressions from env, (b) a separate `cron` service in the compose stack, (c) external (GitHub Actions hitting a webhook). Leaning toward (b) for isolation.
2. **VAPID key rotation policy.** What happens when we rotate? Existing push subscriptions break. v1 may simply not rotate.
3. **Auto-approve eligibility on swaps: should manager_override rules participate?** When evaluating "no rule violation," do we use the team rules or the team rules with all soldier overrides? Leaning toward "with overrides" since overrides are tightenings, so they're the strictest check.
4. **Per-user locale on email reports.** A daily report goes to a list of recipients. Each could prefer a different locale. v1 defaults to Hebrew for everyone; per-recipient locale is a v1.1 candidate.
5. **What "weekend" means.** `weekend_separation` rule needs a definition. Israeli weekend is Fri–Sat. Hardcode for v1; expose as a tenant setting in v1.1.
6. **Time-clock entries that span midnight.** A button-tapped "check in" at 23:00 followed by "check out" at 03:00. Two database rows or one? Leaning toward one row with `started_at`/`ended_at` spanning the boundary.
7. **Solver `random_seed` exposure.** Should the manager see it? Helpful for reproducible debugging; might confuse non-technical users. Default: hidden, but stored on `solver_run`.
8. **Roster import format for v1.1.** CSV with which columns? Defer to v1.1 spec.

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
| `VAPID_PUBLIC_KEY` | Lowdefy, browser | Web Push public key |
| `VAPID_PRIVATE_KEY` | Lowdefy | Web Push private key |
| `VAPID_SUBJECT` | Lowdefy | Contact mailto (`mailto:omernesher@gmail.com`) |
| `SOLVER_BASE_URL` | Lowdefy | Internal URL (`http://solver:8000`) |
| `SOLVER_MAX_SECONDS` | Lowdefy | Default solver timeout (10) |
| `APP_DEFAULT_LOCALE` | Lowdefy | `he` |
| `APP_DEFAULT_TIMEZONE` | Lowdefy, solver | `Asia/Jerusalem` |
| `CRON_DAILY_REPORT_HOUR` | cron service | Default 7 (local time) |
| `CRON_WEEKLY_DIGEST_DOW` | cron service | Default `MON` |
| `CRON_WEEKLY_DIGEST_HOUR` | cron service | Default 8 |
| `POSTGRES_PASSWORD` | postgres container | Set by compose; not consumed by app code |
| `POSTGRES_USER` | postgres container | `shifts` |
| `POSTGRES_DB` | postgres container | `shifts` |

All values live in `.env` on hpg5; `.env.example` ships in the repo as a template with empty values.

---

## End of PRD
