# Phase 03: Availability & Rules - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous batch tables; user accepted all 4 areas)

<domain>
## Phase Boundary

Managers can fully specify a planning window's inputs end-to-end — define a team's shift slots (with templates 2x12h / 3x8h / Custom, headcount, role-tag eligibility, cross-midnight support), open a planning window that synchronously generates `shift_instance` rows across (slot × date × headcount-index), seed and tune the 8-rule catalog with per-soldier tightening overrides (boolean + integer semantics enforced server-side, `fairness_objective` team-only); soldiers declare availability via a hybrid UI (range-blockout materialized to per-instance rows + per-slot drill-down with `source` precedence) inside a `constraint_lock_at` window, with an audited manager-override path — so the Phase 04 solver receives a complete, RLS-isolated, fully validated input package.

**Out of scope for Phase 03:** the solver itself (Phase 04), draft/published schedule states (Phase 04), swap workflow (Phase 05), notifications (Phase 06).

</domain>

<decisions>
## Implementation Decisions

### Area 1: Shift slot CRUD scope & template wizard
- shift_slot CRUD lives in a new "Shift slots" tab inside `team_detail.yaml`, replacing Phase 02's placeholder card. Wired with custom request types `CreateShiftSlot` / `UpdateShiftSlot` / `DeleteShiftSlot`. Keeps slots scoped to the team page where managers already are.
- Template wizard: Lowdefy modal launched on first shift_slot CRUD entry per team with 3 Selector cards (2x12h, 3x8h, Custom). On pick, INSERT pre-filled rows in one transaction using PRD §7.4 Hebrew names (e.g., 06:00–18:00 / 18:00–06:00). Once any slot exists for the team, modal does NOT re-prompt.
- Cross-midnight: TimePicker with inline ⓘ "מסתיים למחרת" hint when `end_time < start_time`. No DB CHECK (already absent per migration 0003). Duration computed in handler as `(end - start) MOD 24h`.
- `required_role_tags` + `min_seniority` UI: inline on the shift_slot form. TagPicker bound to `role_tag` table (autocomplete reused from Phase 02 D-13), NumberInput 0–10 for min_seniority. Empty/NULL = no requirement.

### Area 2: Planning window lifecycle & shift_instance generation
- Open authorization: team manager AND admin (admin scoped tenant-wide; manager scoped to their `team_ids` — same predicate as Phase 02 D-02). Layer-4 check inside `OpenPlanningWindow` custom request type.
- `shift_instance` cross-product materialization: synchronous inside the `OpenPlanningWindow` transaction. INSERT…SELECT against `shift_slot` filtered by team_id + tenant_id. Caps: 30 soldiers × 30 days × 4 slots = 3,600 rows max (matches Phase 04 solver SLO budget), fits in <1s.
- Default `constraint_lock_at`: `start_date - INTERVAL '3 days'` at 23:59 Asia/Jerusalem, admin-editable on the open-window form via DatePicker. After lock, only managers can write availability (enforced in `DeclareAvailability` handler by checking `current_timestamp < pw.constraint_lock_at OR :is_manager`).
- Edit/delete in Phase 03 only (state=`open`): edit allowed (date range, lock TS); cascade-regenerate shift_instances with idempotent INSERT (DELETE missing + INSERT new in same transaction, preserving rows whose `shift_instance_id` survives). Hard-delete only when state=`open` AND no availability rows exist. Once Phase 04 introduces `draft`/`published`, edits become destructive — that gate is Phase 04's concern.

### Area 3: Availability UI shape & per-slot drill-down
- Single `my_availability/{planning_window_id}.yaml` page. Top section: range-blockout form (DatePicker from/to + "סמן כלא זמין" button). Bottom section: AgGrid date-list with one row per date in the window, expandable to reveal slots. Soldier sees only own data via `_user.user_id`.
- Storage strategy: range_blockout materializes ALL affected `shift_instance` rows on submit (INSERT…SELECT with `source='range_blockout'`). Per-slot toggles UPSERT with `source='per_slot'`. Source precedence is enforced in read queries via `ORDER BY source_rank` (NOT row deletion) so attribution is preserved.
- Mobile RTL drill-down: tap a date row → inline expand (AgGrid master-detail or Lowdefy `visible:` toggle) showing each slot as a row with a single Switch ("זמין" / "לא זמין"). No horizontal scroll. <30s/2-week SLO from PRD §7.5, measured in UAT.
- Manager-override path in Phase 03: manager-only "ערוך הזמינות של חייל" button on `team_detail` → opens the same `my_availability` page with `soldier_id` from route param instead of `_user`. Writes with `source='manager_override'`. Audit row mandatory in the same TX. Layer-4 check inside `DeclareAvailability` rejects when caller isn't manager-of-team.

### Area 4: Rules form, override semantics, and deferred-spec rebuild
- 8-rule toggle form: new `team_detail` "Rules" tab. On team create, a new `SeedTeamRules` hook (called from `CreateTeam` or lazily on first rules-tab load) INSERTs 8 default `rule` rows with PRD §7.6 defaults (no_same_day_double=true, max_consecutive_nights=3, max_weekly_hours=60, min_rest_hours_between_shifts=8, fairness_objective=count_variance, weekend_separation=true, no_consecutive_shift2_then_shift1=true, max_shifts_per_period unset) in one transaction. Form loads and edits in place.
- Per-soldier override UI: new "חוקים אישיים" tab on `soldier_detail`. For each enabled team rule, render baseline + Input. `UpsertRuleOverride` REJECTS loosening server-side: boolean overrides only allowed when tightening; integer override > baseline = loosening = silent ignore + UI warning ("חוקי הצוות מחייבים — לא ניתן להקל").
- `fairness_objective` enum is NOT soldier-overridable. Team-only optimization target; per-soldier "tightening only" semantics don't apply to enums. UI hides this rule from `soldier_detail` rules tab; hardcoded exclusion in the override form.
- **P02-HF-05 handling**: standalone first plan of Phase 03 (`03-01-PLAN.md`) rebuilds the 5 deferred Phase 02 mutation spec files as Playwright UI-driven flows (`page.fill` + `page.click` against rendered forms), discarding direct-API POSTs. Rationale: the underlying issue was specs bypassing the `_state` operator binding that the YAML uses at runtime; UI flows naturally exercise the same path soldiers use. **Rejected**: dual-source `_payload`+`_state` operator (papers over a test-design issue with a runtime change that complicates every future mutation).

### Claude's Discretion
- Exact wording of Hebrew UI strings (subject to RTL/canonicalize.js rules) is at Claude's discretion within PRD §7.5 examples.
- Specific shape of `source_rank` ordering function (CASE expression vs. dedicated enum vs. lookup table) is at Claude's discretion — pick the simplest that works.
- AgGrid vs. plain Lowdefy table block choice per page is at Claude's discretion based on which Phase 02 patterns transferred cleanest.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/plugins/shifty-plugin/src/connections/Knex/requests/{CreateSoldier,UpdateSoldier,ArchiveSoldier,CreateMembership,InviteLater,AuditWrite}.js` — canonical custom-request shape: payload validation → transactional Knex with `SET LOCAL app.current_tenant` → `schedule_audit` row in same TX → return. Phase 03 mutations (`CreateShiftSlot`, `OpenPlanningWindow`, `DeclareAvailability`, `UpsertRule`, `UpsertRuleOverride`, `SeedTeamRules`) copy this template verbatim.
- `KnexRawTenant.js` handles every read query with active RLS — no new connection plumbing needed.
- `ParseCsvAndValidate` + `CommitRosterImport` two-stage pattern (preview → commit) reusable for "open planning window" preview (slot × date cross-product preview before commit).
- `shifty-plugin/helpers/canonicalize.js` smart-quote canonicalizer — applies to `shift_slot.name` and any free-text user input on availability/rules pages.
- AgGrid tree-table pattern from `manage_org_units.yaml` — reusable for shift_instance grid (date × slot matrix).
- `color_swatches.yaml` reusable block — informs the per-slot toggle palette.

### Established Patterns
- `_user: tenant_id` server-side derivation in every payload (forbidden from request body). CI grep gate `tools/check-queries.mjs` enforces.
- Page-level `auth.roles` allowlist gates access; request-level role check via custom request type for Layer 4 (no `properties.auth` support in Lowdefy 5.3).
- Audit row written in the SAME transaction as the mutation, via `AuditWrite` helper called by the custom request handler.
- Hebrew labels hardcoded in YAML with `# i18n: <key>` comment markers (locale file extraction is Phase 07).
- Idempotent INSERT via `ON CONFLICT … DO NOTHING` + follow-up `EXISTS` (membership pattern from Plan 02-07) — directly applicable to availability upsert and shift_instance generation.

### Integration Points
- Next migration is `0014_*.up.sql` (last applied = 0013). Phase 03 likely adds columns/triggers, not new tables — `shift_slot`, `planning_window`, `shift_instance`, `availability`, `rule`, `rule_override` already exist from 0003/0004.
- New pages slot into `app/lowdefy.yaml` menu: shift slots under `team_detail`; new top-level "תכנון" entry for planning windows; soldier `my_availability/{pw_id}`.
- Cross-tenant-leak pen-test fixture auto-derives from `app/pages/**` — every new Phase 03 page gets coverage for free.
- `rule_override` write path needs a "tightening guard" that lives in the custom request type (`UpsertRuleOverride`) — semantic check, not a DB CHECK.

### Phase 1/2 schema state for Phase 03 surface
- **Already migrated (no change needed):** `shift_slot` (with `required_role_tags`, `min_seniority`, `headcount`, `display_order`, no end>start CHECK so cross-midnight works); `planning_window` (with `state`, `constraint_lock_at`, CHECK `end_date >= start_date`); `shift_instance` (with `headcount_index` UNIQUE on `(slot, date, headcount_index)`); `availability` (with `declared`, `source`); `rule` + `rule_override` (with `rule_key` CHECK across the 8-rule catalog).
- **Missing / to add in 0014:**
  - `availability.planning_window_id` denorm column (performance + planning-window cascade clarity).
  - `shift_slot` v1 template seed data (2x12h, 3x8h) — application-level fixture, not schema.
  - `SeedTeamRules` hook — application-level, but consider DB trigger fallback.
- **Not Phase 03's concern:** `weekend_separation` source-of-truth for "weekend = Fri+Sat" (solver concern, Phase 04).

</code_context>

<specifics>
## Specific Ideas

- **PRD §7.4 shift slot Hebrew names:** Use exactly the names from the PRD table — `בוקר 06:00–18:00`, `לילה 18:00–06:00` for 2x12h; `בוקר 06:00–14:00`, `צהריים 14:00–22:00`, `לילה 22:00–06:00` for 3x8h. Don't paraphrase.
- **PRD §7.5 availability defaults:** Soldiers default to "available for all" — `availability` row absent = available. Only explicit unavailability stored.
- **PRD §7.6 rule key catalog:** Frozen — `no_same_day_double`, `no_consecutive_shift2_then_shift1`, `max_consecutive_nights`, `weekend_separation`, `max_weekly_hours`, `min_rest_hours_between_shifts`, `max_shifts_per_period`, `fairness_objective`. Don't add or rename in Phase 03.
- **P02-HF-05 first-plan placement:** The 5 deferred mutation spec rebuilds are `03-01-PLAN.md`. Phase 03 product work starts at `03-02-PLAN.md`. This gives Phase 03's later plans (which add new mutation flows) a working UI-flow spec template to copy from.

</specifics>

<deferred>
## Deferred Ideas

- Shift slot per-day variants (different headcount on Friday vs. weekday) — v1.1; PRD §7.4 doesn't require.
- Per-tenant "weekend" definition (Sun–Thu countries) — locked to Fri+Sat in v1 per PROJECT.md; v2 concern.
- Bulk-edit availability across multiple soldiers (manager batch action) — v1.1 dashboard concern.
- Calendar-widget availability UI (vs. date-list) — Lowdefy npm calendar plugin deferred to v1.1 per PROJECT.md Out-of-Scope.
- Rule rule_override audit log UI ("who tightened which rule when") — surfaces via `schedule_audit` but no dedicated view; Phase 07 polish.
- Planning window cloning / "duplicate last window" shortcut — v1.1 if managers ask for it after first cycle.

</deferred>
