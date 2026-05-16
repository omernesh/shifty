# Phase 3: Availability & Rules — Research

**Researched:** 2026-05-16
**Domain:** Lowdefy 5.3 multi-tenant CRUD + transactional cross-product materialization + hybrid availability storage + server-side rule-tightening guards + Playwright UI-driven test rebuild
**Confidence:** HIGH on stack reuse (Phase 02 baseline); HIGH on implementation recipes (six locked decisions in CONTEXT, schema already exists at 0003/0004, plugin pattern already exists in shifty-plugin); MEDIUM on AgGrid master-detail mobile UX (community edition lacks the feature — design alternative documented).

## Summary

Phase 03 is **NOT a stack-pivot phase**. Every piece of technology is locked from Phase 01–02 — Lowdefy 5.3 + Postgres 16 + the merged `shifty-plugin` + Auth.js sessions + Knex + KnexRawTenant/AuditWrite + Playwright + node-postgres for test fixtures. The Phase 02 RESEARCH (the canonical stack source-of-truth) is binding.

What's actually new is **how those pieces compose**:

1. **Six new custom-request types** added to `shifty-plugin/src/connections/Knex/requests/` (CreateShiftSlot/UpdateShiftSlot/DeleteShiftSlot, OpenPlanningWindow, DeclareAvailability, UpsertRule, UpsertRuleOverride, SeedTeamRules) — every one of them follows the verbatim shape of `CreateSoldier.js` (guard clauses → withTenantTx → schedule_audit in same TX → .meta + .connectionType + .schema). Plus an OpenPlanningWindow that uses a two-stage `INSERT … SELECT` cross-product like `CommitRosterImport`'s batch loop, but materialized in a single SQL statement (3,600 row ceiling fits inside one round-trip).
2. **A hybrid availability read query** with source precedence enforced at READ time via `ORDER BY CASE source` ranking — NEVER by deleting lower-precedence rows. This preserves attribution so the manager-override audit trail stays intact.
3. **A tightening guard** in `UpsertRuleOverride.js` that lives in the handler (not as a DB CHECK) because the comparison is value-dependent — boolean `false→true` always allowed; integer `value > team baseline` rejected silently with a `tightening_rejected` field in the response that the UI shows as an Alert.
4. **Migration 0014** adds two columns: `availability.planning_window_id` (denorm for perf + cascade clarity) and `org_unit.template_picked_at` (so the template wizard never re-prompts after the first pick).
5. **Mobile-first RTL availability UI**: AgGrid master-detail is **AG Grid Enterprise** in the 32.x line — *not* available via `@lowdefy/blocks-aggrid@5.3.0` which ships AG Grid 32.3.9 community. The Phase 03 plan must use **Lowdefy List + `visible:` toggles for the expandable date list**, not AgGrid master-detail. The UI-SPEC's "AgGrid master-detail or Lowdefy `visible:` toggle" phrasing collapses to the `visible:` toggle path. This is the highest-risk research finding and is detailed below.
6. **P02-HF-05 carry-over**: the 21 deferred Phase 02 mutation specs (across 5 spec files) get rebuilt as Playwright UI-driven flows in Plan `03-01-PLAN.md`. The template is `page.goto → page.locator(...).fill(...) → page.locator('button').click() → expect(...)`. The direct API POST approach those specs used was incompatible with the Lowdefy `_state:` payload binding pattern (UAT-FINDINGS §3 root cause, surfaced post-merge in 02-11-SUMMARY).

**Primary recommendation:** Treat Phase 03 plans as a pure recipe-application exercise — every load-bearing pattern already lives in `app/plugins/shifty-plugin/src/connections/Knex/requests/{CreateSoldier,CommitRosterImport,AuditWrite,KnexRawTenant}.js`. Each new handler reuses 70% of its analog. Spend the unique research time on (a) the AgGrid mobile UX alternative, (b) the hybrid source-precedence SQL, and (c) the Playwright UI-flow harness template that all 21 rebuilt specs plus new Phase 03 specs will share.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| shift_slot CRUD form rendering | Lowdefy YAML (frontend Lowdefy SSR runtime) | — | Phase 02 inheritance: forms in `team_detail` tab live in YAML; AgGrid renders the slot list. |
| shift_slot CRUD mutations | shifty-plugin custom-request handlers (API / Backend) | Postgres (RLS Layer 5) | Layer-4 RBAC + canonicalizeText + audit-in-same-TX cannot live in YAML; must be a custom request handler matching CreateSoldier shape. |
| Template wizard transactional INSERT (2x12h / 3x8h) | shifty-plugin custom-request handler (API / Backend) | Postgres | Multi-row insert + set `org_unit.template_picked_at` + audit in single TX. UI sends the chosen template enum; handler does the cross-product expansion. |
| planning_window CRUD | shifty-plugin custom-request handler (API / Backend) | Postgres | OpenPlanningWindow synchronously generates shift_instance cross-product (INSERT … SELECT). Layer-4 manager/admin gate. |
| shift_instance cross-product materialization | Postgres (INSERT … SELECT) | shifty-plugin handler (orchestrates) | The cross-product is one SQL statement — `INSERT … SELECT FROM shift_slot s CROSS JOIN generate_series(start, end, '1 day')`. Computation pushed to Postgres for atomicity. |
| Availability READ (with source precedence) | Postgres (window function / CASE ranking) | shifty-plugin (KnexRawTenant wraps it) | Source precedence is a pure SQL expression (`ORDER BY CASE source` inside a `DISTINCT ON` window). Returning attribution to the UI keeps the soldier-vs-manager visual signal correct. |
| Availability WRITE (range_blockout materialization + per_slot upsert + manager_override) | shifty-plugin custom-request handler (API / Backend) | Postgres | DeclareAvailability is one handler with `mode` enum (`range_blockout` | `per_slot_toggle` | `manager_override`). Each mode is a separate SQL block inside the same TX. |
| rule + rule_override CRUD | shifty-plugin custom-request handler (API / Backend) | Postgres | Tightening guard is value-comparison logic; lives in JS not SQL. |
| my_availability mobile-first RTL UI | Lowdefy YAML pages + `visible:` toggle (frontend Lowdefy SSR) | — | Master-detail expand without AG Grid Enterprise — each date row is a Box with conditional children. |
| Optimistic UI for per-slot toggle (auto-save) | Lowdefy `_state` operator + Switch onChange → Request action | shifty-plugin DeclareAvailability handler | Lowdefy's standard request-after-Switch pattern; debounce via `_state` accumulator. |
| Manager-override entry path | Lowdefy YAML (URL param routing) | shifty-plugin DeclareAvailability handler (with mode=manager_override) | Same `my_availability` page, different `_input.soldier_id` value, different banner chrome. Manager flag derived from `_user: roles` at the page level. |
| Playwright UI test orchestration | Playwright + node-postgres test fixtures | — | Same shape as Phase 02 ui-smoke-phase2.spec.ts but using `page.fill` / `page.click` against rendered forms instead of `request.post`. |

**Why this matters:** Phase 02 hit the wall when 21 specs tried to call mutation endpoints directly with `{ payload: { ... } }` while the page YAMLs resolved every field via `_state:` operators (UAT-FINDINGS §"Remaining failures and root cause"). The fix is honoring the tier boundary — UI tier produces `_state`, API tier consumes it, tests must drive through the UI tier or the contract breaks.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Shift slot CRUD scope & template wizard:**
- shift_slot CRUD lives in a new "Shift slots" tab inside `team_detail.yaml`, replacing Phase 02's placeholder card. Wired with custom request types `CreateShiftSlot` / `UpdateShiftSlot` / `DeleteShiftSlot`.
- Template wizard: Lowdefy modal launched on first shift_slot CRUD entry per team with 3 Selector cards (2x12h, 3x8h, Custom). On pick, INSERT pre-filled rows in one transaction using PRD §7.4 Hebrew names. Once any slot exists for the team, modal does NOT re-prompt.
- Cross-midnight: TimePicker with inline ⓘ "מסתיים למחרת" hint when `end_time < start_time`. No DB CHECK. Duration computed in handler as `(end - start) MOD 24h`.
- `required_role_tags` + `min_seniority` UI: inline on the shift_slot form. TagPicker bound to `role_tag` table; NumberInput 0–10 for min_seniority. Empty/NULL = no requirement.

**Area 2 — Planning window lifecycle & shift_instance generation:**
- Open authorization: team manager AND admin (admin scoped tenant-wide; manager scoped to their `team_ids` — same predicate as Phase 02 D-02). Layer-4 check inside `OpenPlanningWindow`.
- `shift_instance` cross-product materialization: synchronous inside the `OpenPlanningWindow` transaction. INSERT…SELECT against `shift_slot` filtered by team_id + tenant_id. Cap: 30 soldiers × 30 days × 4 slots = 3,600 rows, fits in <1s.
- Default `constraint_lock_at`: `start_date - INTERVAL '3 days'` at 23:59 Asia/Jerusalem, admin-editable on the open-window form via DatePicker.
- Edit/delete in Phase 03 only (state=`open`): edit allowed (date range, lock TS); cascade-regenerate shift_instances with idempotent INSERT (DELETE missing + INSERT new in same transaction, preserving rows whose `shift_instance_id` survives). Hard-delete only when state=`open` AND no availability rows exist.

**Area 3 — Availability UI shape & per-slot drill-down:**
- Single `my_availability/{planning_window_id}.yaml` page. Top section: range-blockout form. Bottom section: AgGrid date-list with one row per date in the window, expandable to reveal slots. Soldier sees only own data via `_user.user_id`.
- Storage strategy: range_blockout materializes ALL affected `shift_instance` rows on submit (INSERT…SELECT with `source='range_blockout'`). Per-slot toggles UPSERT with `source='per_slot'`. Source precedence enforced in read queries via `ORDER BY source_rank` (NOT row deletion).
- Mobile RTL drill-down: tap a date row → inline expand showing each slot as a row with a single Switch ("זמין" / "לא זמין"). No horizontal scroll. <30s/2-week SLO from PRD §7.5.
- Manager-override path: manager-only "ערוך הזמינות של חייל" button on `team_detail` → opens the same `my_availability` page with `soldier_id` from route param instead of `_user`. Writes with `source='manager_override'`. Audit row mandatory in same TX.

**Area 4 — Rules form, override semantics, and deferred-spec rebuild:**
- 8-rule toggle form: new `team_detail` "Rules" tab. `SeedTeamRules` hook called from `CreateTeam` or lazily on first rules-tab load INSERTs 8 default rule rows with PRD §7.6 defaults.
- Per-soldier override UI: new "חוקים אישיים" tab on `soldier_detail`. `UpsertRuleOverride` REJECTS loosening server-side.
- `fairness_objective` enum is NOT soldier-overridable; UI hides it from `soldier_detail` rules tab.
- **P02-HF-05 handling**: standalone first plan of Phase 03 (`03-01-PLAN.md`) rebuilds the 21 deferred Phase 02 mutation spec tests across 5 spec files as Playwright UI-driven flows (`page.fill` + `page.click` against rendered forms).

### Claude's Discretion
- Exact wording of Hebrew UI strings (subject to RTL/canonicalize.js rules) is at Claude's discretion within PRD §7.5 examples.
- Specific shape of `source_rank` ordering function (CASE expression vs. dedicated enum vs. lookup table) is at Claude's discretion — pick the simplest that works.
- AgGrid vs. plain Lowdefy table block choice per page is at Claude's discretion based on which Phase 02 patterns transferred cleanest.

### Deferred Ideas (OUT OF SCOPE)
- Shift slot per-day variants (different headcount on Friday vs. weekday) — v1.1; PRD §7.4 doesn't require.
- Per-tenant "weekend" definition (Sun–Thu countries) — locked to Fri+Sat in v1.
- Bulk-edit availability across multiple soldiers (manager batch action) — v1.1 dashboard concern.
- Calendar-widget availability UI (vs. date-list) — v1.1.
- Rule rule_override audit log UI ("who tightened which rule when") — surfaces via `schedule_audit` but no dedicated view; Phase 07 polish.
- Planning window cloning / "duplicate last window" shortcut — v1.1 if managers ask for it.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHFT-01 | `shift_slot` with name, times (cross-midnight), headcount, required_role_tags, min_seniority, display_order | CreateShiftSlot recipe + 0003 schema (existing). |
| SHFT-02 | Team creation templates: 2x12h, 3x8h, Custom (PRD §7.4 Hebrew names exact) | Template wizard recipe + multi-row INSERT inside transaction. |
| SHFT-03 | `required_role_tags` AND-combined (all required) | Schema-level — TEXT[] column; solver consumes in Phase 04; Phase 03 UI is autocomplete TagPicker. |
| SHFT-04 | `min_seniority` `>=` semantics; NULL = no requirement | Schema-level; UI NumberInput 0–10 with empty=NULL. |
| SHFT-05 | Headcount > 1 → N parallel `shift_instance` rows with `headcount_index` | OpenPlanningWindow INSERT … SELECT recipe (CROSS JOIN generate_series + `generate_series(0, headcount-1)`). |
| SHFT-06 | Manager opens `planning_window` → cross-product `shift_instance` rows | OpenPlanningWindow recipe — single SQL statement. |
| SHFT-07 | Default `constraint_lock_at` = `start_date - 3 days`, admin-configurable | Handler default; UI DatePicker pre-fills. |
| AVAL-01 | Every soldier × shift_instance defaults to `available` when a window opens | Schema-level: row absence = `available`. No INSERT at window-open time. |
| AVAL-02 | Range blockout: <30s for 2-week window | DeclareAvailability `mode=range_blockout` recipe — single INSERT…SELECT materialization. |
| AVAL-03 | Per-slot toggle | DeclareAvailability `mode=per_slot_toggle` UPSERT recipe. |
| AVAL-04 | Source precedence `manager_override > per_slot > range_blockout` | Source-precedence READ query recipe (`DISTINCT ON ... ORDER BY source_rank`). |
| AVAL-05 | Per-slot drill-down on mobile with no horizontal scroll | UI-SPEC Surface 8 + mobile-first RTL pattern documented below. |
| AVAL-06 | Constraint lock prevents non-manager writes after lock | DeclareAvailability handler guard. |
| AVAL-07 | Manager writes after lock → `schedule_audit` row with `to_state=availability_manager_override` | Audit-in-same-TX pattern (AuditWrite analog). |
| AVAL-08 | Mid-window joiners default to `available`; can declare up to the lock | No-op — covered by AVAL-01 row-absence rule. |
| RULE-01 | 8-rule catalog frozen with PRD §7.6 defaults | SeedTeamRules recipe. |
| RULE-02 | `rule` rows per team with `rule_key`, `enabled`, `value` JSONB | Existing 0004 schema. |
| RULE-03 | Manager toggles rules; immediate consumption by next solver run | UpsertRule handler + Phase 04 reads. |
| RULE-04 | Per-soldier overrides can ONLY tighten | UpsertRuleOverride tightening guard recipe. |
| RULE-05 | Per-soldier override UI shows team baseline alongside soldier's tightening | UI-SPEC Surface 11 layout. |
| RULE-06 | Weekend = Fri+Sat hardcoded for `weekend_separation` | Phase 04 solver concern, not Phase 03. |
| RULE-07 | `fairness_objective` is solver minimization target | UI: Selector with 4 enum options (no Switch). |

## Stack pins (HIGH confidence)

### Inherited from Phase 02 (no version change)

| Technology | Version | Purpose | Source |
|------------|---------|---------|--------|
| Lowdefy | `5.3.0` | UI + thin business logic | `app/package.json` (pinned). |
| `@lowdefy/connection-knex` | `5.3.0` | Postgres driver via Knex | `app/package.json` (pinned). |
| `@lowdefy/blocks-aggrid` | `5.3.0` (wraps AG Grid 32.3.9 community) | Data tables (slot list, instance grid, date-list collapsed view) | `app/package.json` (pinned). |
| `@lowdefy/blocks-antd` | `5.3.0` | Ant Design 5 (TimePicker, DatePicker, Switch, Modal, Selector, Alert) | `app/package.json` (pinned). |
| `@lowdefy/plugin-next-auth` | `5.3.0` | Auth.js v4 runtime | `app/package.json` (pinned). |
| `knex` | `^3.1.0` | DB layer used by withTenantTx | `app/package.json` (pinned). |
| Postgres | 16 | Source of truth | `docker-compose.yml` (pinned). |
| `shifty-plugin` | `file:./plugins/shifty-plugin` (in-repo) | Merged plugin owns Knex connection + 9 (→13 after Phase 03) custom request handlers | Post 02-11 hotfix. |
| Playwright (test runner) | (whatever Phase 02 used) | UI-driven e2e | `playwright.config.ts`. |
| `pg` (node-postgres) | (Phase 02 baseline) | Direct PG client for test fixtures (bypasses RLS via `SET ROLE NONE`) | `tests/e2e/_fixtures/seed-tenants.ts`. |

### New for Phase 03 (HIGH confidence based on existing patterns; no new deps)

**No new npm packages.** Every Phase 03 capability composes from packages already pinned. This is a code-only phase from a dependency-graph perspective.

- AG Grid features used: `pagination` + `defaultColDef` + `enableRtl: true` (already used in Phase 02 manage_soldiers.yaml + manage_org_units.yaml). **NOT used: master-detail** (Enterprise-only in AG Grid 32.x). The mobile-first expand uses Lowdefy `visible:` operators on Box children, not AgGrid's `masterDetail: true`. See `## Mobile-first RTL patterns` below.
- Ant Design components new to Phase 03: `TimePicker` (already in Phase 02 `manage_invites.yaml`?), `DatePicker` (already in `manage_invites.yaml` for `expires_at`), `Switch` (new for Phase 03 — Lowdefy block `Switch` from blocks-antd), `Selector` (already used for invite-role picker), `Modal.confirm` (already used for delete-soldier). All ship in `@lowdefy/blocks-antd@5.3.0`.

### Verification

```bash
# (Already verified at Phase 02 time; re-verification is a no-op since no new packages.)
npm view @lowdefy/blocks-antd@5.3.0 version  # → 5.3.0
npm view @lowdefy/blocks-aggrid@5.3.0 version  # → 5.3.0
```

`@lowdefy/blocks-aggrid@5.3.0` wraps AG Grid Community 32.3.9. **AG Grid master-detail is an Enterprise feature** in v32.x — confirmed by AG Grid docs and by absence of `masterDetail` properties in the `@lowdefy/blocks-aggrid` README. `[CITED: AG Grid documentation — Master Detail listed under Enterprise features]`. `[VERIFIED: @lowdefy/blocks-aggrid v5.3.0 ships AG Grid 32.3.9 community]` (Phase 02 RESEARCH stack section).

## Package Legitimacy Audit

Phase 03 installs **zero new packages**. Every recommended technology is already in `app/package.json` and was audited in Phase 02. No new audit needed.

| Package | Registry | Already installed? | Disposition |
|---------|----------|---------------------|-------------|
| `lowdefy` 5.3.0 | npm | Yes (Phase 02) | Reuse |
| `@lowdefy/connection-knex` 5.3.0 | npm | Yes | Reuse |
| `@lowdefy/blocks-aggrid` 5.3.0 | npm | Yes | Reuse |
| `@lowdefy/blocks-antd` 5.3.0 | npm | Yes | Reuse |
| `knex` ^3.1.0 | npm | Yes | Reuse |

## Implementation Recipes

### Recipe 1: Custom-request handler template (THE canonical shape)

Every new Phase 03 handler is a near-verbatim copy of `app/plugins/shifty-plugin/src/connections/Knex/requests/CreateSoldier.js`. The load-bearing pieces are:

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/<Name>.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';
// + any helpers (canonicalize, palette, etc.)

async function <Name>({ request, connection }) {
  const { /* destructure request.properties */ } = request.properties || {};

  // Layer-4 tenant / actor guards — BEFORE any DB interaction.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('<Name>: tenant_id missing from session');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('<Name>: actor_user_id missing from session — unauthenticated');
  const roles = request.user?.roles || [];
  const team_ids = request.user?.team_ids || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager_or_admin = is_admin || roles.includes('team_manager');

  // Payload validation guards (specific to handler).

  const result = await withTenantTx(connection, tenant_id, async (trx) => {
    // (a) Layer-4 scope check via SELECT FOR UPDATE if needed
    //     (e.g., team_id must be in caller's team_ids when not admin)
    // (b) Primary mutation
    // (c) Audit row IN THE SAME TX
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id: null,  // or the actual window when relevant
      from_state: null,
      to_state: '<event_name>',
      actor_user_id,
      actor_kind: 'user',
      payload: JSON.stringify({ /* mutation context */ }),
    });
    return { /* result fields */ };
  });

  return { success: true, ...result };
}

<Name>.schema = { type: 'object', required: [...], properties: { ... } };
<Name>.connectionType = 'Knex';
<Name>.meta = { checkRead: false, checkWrite: false };  // REQUIRED — see Phase 02-11 hotfix

export default <Name>;
```

Then add to `app/plugins/shifty-plugin/src/types.js`:

```javascript
export default {
  connections: ['Knex'],
  requests: [
    'KnexRawTenant', 'AuditWrite', 'ParseCsvAndValidate', 'CommitRosterImport',
    'CreateSoldier', 'UpdateSoldier', 'ArchiveSoldier', 'CreateMembership', 'InviteLater',
    // Phase 03 additions:
    'CreateShiftSlot', 'UpdateShiftSlot', 'DeleteShiftSlot',
    'OpenPlanningWindow', 'EditPlanningWindow', 'DeletePlanningWindow',
    'ApplyShiftTemplate',  // wizard
    'DeclareAvailability',
    'UpsertRule', 'UpsertRuleOverride', 'ResetRuleOverride',
    'SeedTeamRules',
  ],
  auth: { adapters: ['KnexAdapter'], callbacks: ['ShiftySessionCallback'], providers: ['EmailProvider'] },
};
```

And to `app/plugins/shifty-plugin/src/connections/Knex/Knex.js`, import + spread each new handler into the `requests` map.

**Source:** `app/plugins/shifty-plugin/src/connections/Knex/requests/CreateSoldier.js` (the entire file is the template). `[VERIFIED: in-repo file]`

### Recipe 2: CreateShiftSlot (SHFT-01..04, SHFT-07 layer-4 check)

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/CreateShiftSlot.js
import { canonicalizeText } from '../../../helpers/canonicalize.js';
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function CreateShiftSlot({ request, connection }) {
  const {
    team_id, name, start_time, end_time, headcount = 1,
    required_role_tags = [], min_seniority = null, display_order = null,
  } = request.properties || {};

  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('CreateShiftSlot: tenant_id missing from session');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('CreateShiftSlot: unauthenticated request');
  const roles = request.user?.roles || [];
  const team_ids = request.user?.team_ids || [];
  const is_admin = roles.includes('unit_admin');
  if (!is_admin && !roles.includes('team_manager')) {
    throw new Error('CreateShiftSlot: requires unit_admin or team_manager role');
  }

  if (!team_id) throw new Error('CreateShiftSlot: team_id required');
  if (!name) throw new Error('CreateShiftSlot: name required');
  if (!start_time || !end_time) throw new Error('CreateShiftSlot: times required');
  if (start_time === end_time) throw new Error('CreateShiftSlot: start_time === end_time');
  if (!Number.isInteger(headcount) || headcount < 1) throw new Error('CreateShiftSlot: headcount >= 1');

  const canonicalName = canonicalizeText(name);
  const cleanedRoleTags = Array.isArray(required_role_tags)
    ? Array.from(new Set(required_role_tags.map((t) => String(t).trim()).filter(Boolean)))
    : [];

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Layer-4 scope: non-admin manager must own this team
    // (verified via membership.role='team_manager' against this org_unit_id).
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: team_id, role: 'team_manager' })
        .whereIn('soldier_id', function() {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) throw new Error('CreateShiftSlot: caller is not team_manager of this team');
    }

    // Resolve display_order if not provided: next after current max.
    let order = display_order;
    if (order === null || order === undefined) {
      const max = await trx('shift_slot')
        .where({ tenant_id, team_id })
        .max({ m: 'display_order' })
        .first();
      order = (max?.m ?? -1) + 1;
    }

    const ins = await trx('shift_slot').insert({
      tenant_id,
      team_id,
      name: canonicalName,
      start_time, end_time,
      headcount, required_role_tags: cleanedRoleTags,
      min_seniority,
      display_order: order,
    }).returning('id');
    const shift_slot_id = ins[0]?.id ?? ins[0];

    await trx('schedule_audit').insert({
      tenant_id, planning_window_id: null,
      from_state: null, to_state: 'shift_slot_created',
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({
        shift_slot_id, team_id, name: canonicalName,
        start_time, end_time, headcount,
        required_role_tags: cleanedRoleTags, min_seniority,
      }),
    });

    return { shift_slot_id, name: canonicalName, display_order: order };
  });
}

CreateShiftSlot.schema = {
  type: 'object',
  required: ['team_id', 'name', 'start_time', 'end_time'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1 },
    start_time: { type: 'string' },  // HH:MM
    end_time: { type: 'string' },
    headcount: { type: 'integer', minimum: 1 },
    required_role_tags: { type: 'array', items: { type: 'string' } },
    min_seniority: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
    display_order: { type: ['integer', 'null'] },
  },
};
CreateShiftSlot.connectionType = 'Knex';
CreateShiftSlot.meta = { checkRead: false, checkWrite: false };

export default CreateShiftSlot;
```

**Notes:**
- `UpdateShiftSlot` is a verbatim copy with `.update().where({ id: shift_slot_id, tenant_id })` + Layer-4 scope check.
- `DeleteShiftSlot` checks `EXISTS (SELECT 1 FROM shift_instance WHERE shift_slot_id = :id)` and refuses if true — per CONTEXT D-Area-1 ("Delete shift slot (instances already generated by an open window): block").

### Recipe 3: ApplyShiftTemplate (the template wizard handler)

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/ApplyShiftTemplate.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

const TEMPLATES = {
  '2x12h': [
    { name: 'בוקר', start_time: '06:00', end_time: '18:00', display_order: 0 },
    { name: 'לילה', start_time: '18:00', end_time: '06:00', display_order: 1 },
  ],
  '3x8h': [
    { name: 'בוקר', start_time: '06:00', end_time: '14:00', display_order: 0 },
    { name: 'ערב',  start_time: '14:00', end_time: '22:00', display_order: 1 },
    { name: 'לילה', start_time: '22:00', end_time: '06:00', display_order: 2 },
  ],
  'custom': [],
};

async function ApplyShiftTemplate({ request, connection }) {
  const { team_id, template_key, headcount = 1 } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('ApplyShiftTemplate: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('ApplyShiftTemplate: unauthenticated');
  const roles = request.user?.roles || [];
  if (!roles.includes('unit_admin') && !roles.includes('team_manager')) {
    throw new Error('ApplyShiftTemplate: requires unit_admin or team_manager');
  }
  if (!TEMPLATES[template_key]) throw new Error('ApplyShiftTemplate: unknown template_key');

  const slots = TEMPLATES[template_key];

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Refuse to re-apply if any slot already exists for this team.
    const exists = await trx('shift_slot').where({ tenant_id, team_id }).first('id');
    if (exists) throw new Error('ApplyShiftTemplate: slots already exist; refusing to overwrite');

    const created_ids = [];
    for (const s of slots) {
      const ins = await trx('shift_slot').insert({
        tenant_id, team_id, name: s.name,
        start_time: s.start_time, end_time: s.end_time,
        headcount, required_role_tags: [], min_seniority: null,
        display_order: s.display_order,
      }).returning('id');
      created_ids.push(ins[0]?.id ?? ins[0]);
    }

    // Mark template_picked_at so the wizard never re-prompts (D-Area-1).
    // Column added in migration 0014.
    await trx('org_unit')
      .where({ id: team_id, tenant_id })
      .update({ template_picked_at: trx.fn.now() });

    await trx('schedule_audit').insert({
      tenant_id, planning_window_id: null,
      from_state: null, to_state: 'shift_template_applied',
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({ team_id, template_key, created_ids, headcount }),
    });

    return { created_ids, slot_count: created_ids.length };
  });
}

ApplyShiftTemplate.schema = {
  type: 'object',
  required: ['team_id', 'template_key'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    template_key: { enum: ['2x12h', '3x8h', 'custom'] },
    headcount: { type: 'integer', minimum: 1 },
  },
};
ApplyShiftTemplate.connectionType = 'Knex';
ApplyShiftTemplate.meta = { checkRead: false, checkWrite: false };
export default ApplyShiftTemplate;
```

**Note:** The handler intentionally does nothing on `template_key='custom'` other than set `template_picked_at` (so the wizard doesn't re-prompt and the user falls back to "+ הוסף משמרת"). This matches UI-SPEC Surface 3 "Custom → התחל ריק".

### Recipe 4: OpenPlanningWindow (SHFT-05, SHFT-06, SHFT-07) — INSERT…SELECT cross-product

The cross-product `(shift_slot × generate_series(start_date, end_date) × generate_series(0, headcount-1))` materializes in a single SQL statement. This is the load-bearing performance win — 3,600 rows ceiling fits inside a single round-trip without N round-trips.

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/OpenPlanningWindow.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function OpenPlanningWindow({ request, connection }) {
  const { team_id, start_date, end_date, constraint_lock_at } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('OpenPlanningWindow: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('OpenPlanningWindow: unauthenticated');
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');
  if (!is_admin && !is_manager) throw new Error('OpenPlanningWindow: requires unit_admin or team_manager');

  if (!team_id) throw new Error('OpenPlanningWindow: team_id required');
  if (!start_date || !end_date) throw new Error('OpenPlanningWindow: dates required');
  if (new Date(end_date) < new Date(start_date)) throw new Error('OpenPlanningWindow: end_date < start_date');

  // 30-day ceiling (CONTEXT cap).
  const days = Math.floor((new Date(end_date) - new Date(start_date)) / 86_400_000) + 1;
  if (days > 30) throw new Error('OpenPlanningWindow: window length > 30 days');

  const lockTs = constraint_lock_at || null;  // handler resolves default below if null

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Layer-4 scope: non-admin manager must own this team.
    if (!is_admin) {
      const own = await trx('membership')
        .where({ tenant_id, org_unit_id: team_id, role: 'team_manager' })
        .whereIn('soldier_id', function() {
          this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
        })
        .first();
      if (!own) throw new Error('OpenPlanningWindow: caller is not team_manager of this team');
    }

    // Refuse if team has zero shift_slots.
    const slotCount = await trx('shift_slot').where({ tenant_id, team_id }).count({ c: '*' }).first();
    if (!slotCount || Number(slotCount.c) === 0) {
      throw new Error('OpenPlanningWindow: team has zero shift_slots — define slots first');
    }

    // Resolve constraint_lock_at default: start_date - 3 days at 23:59 Asia/Jerusalem.
    const resolvedLock = lockTs ?? trx.raw(
      `(:start_date::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'`,
      { start_date }
    );

    // INSERT planning_window.
    const pwIns = await trx('planning_window').insert({
      tenant_id, team_id,
      start_date, end_date,
      constraint_lock_at: resolvedLock,
      state: 'open',
    }).returning('id');
    const planning_window_id = pwIns[0]?.id ?? pwIns[0];

    // INSERT … SELECT cross-product (single statement).
    // Decomposition:
    //   shift_slot × generate_series(start, end, 1 day) × generate_series(0, headcount - 1)
    // The outer LATERAL allows headcount to vary per slot.
    const result = await trx.raw(
      `INSERT INTO shift_instance
         (tenant_id, shift_slot_id, planning_window_id, date, headcount_index)
       SELECT
         s.tenant_id,
         s.id,
         :pw_id::uuid,
         d.date::date,
         h.idx
       FROM shift_slot s
       CROSS JOIN generate_series(:start_date::date, :end_date::date, INTERVAL '1 day') AS d(date)
       CROSS JOIN LATERAL generate_series(0, s.headcount - 1) AS h(idx)
       WHERE s.tenant_id = :tenant_id
         AND s.team_id = :team_id
       RETURNING id`,
      { pw_id: planning_window_id, start_date, end_date, tenant_id, team_id }
    );
    const instance_count = result?.rowCount ?? result?.rows?.length ?? 0;

    // Hard cap belt-and-braces — should be impossible given the 30-day ceiling above
    // but defends against a slot with headcount > 4 pushing past 3,600.
    if (instance_count > 3600) {
      throw new Error(`OpenPlanningWindow: instance_count ${instance_count} exceeds 3,600 ceiling`);
    }

    await trx('schedule_audit').insert({
      tenant_id, planning_window_id,
      from_state: null, to_state: 'planning_window_opened',
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({
        team_id, start_date, end_date,
        constraint_lock_at_resolved: lockTs ? lockTs : 'default(start_date - 3d @ 23:59 Asia/Jerusalem)',
        instance_count,
      }),
    });

    return { planning_window_id, instance_count };
  });
}

OpenPlanningWindow.schema = {
  type: 'object',
  required: ['team_id', 'start_date', 'end_date'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    start_date: { type: 'string' },     // ISO date
    end_date: { type: 'string' },
    constraint_lock_at: { type: ['string', 'null'] },  // ISO timestamp; null = use default
  },
};
OpenPlanningWindow.connectionType = 'Knex';
OpenPlanningWindow.meta = { checkRead: false, checkWrite: false };
export default OpenPlanningWindow;
```

**Why `CROSS JOIN LATERAL generate_series(0, s.headcount - 1)`:** The LATERAL keyword makes the inner generate_series reference the outer `s.headcount` column. This is the standard Postgres idiom for per-row variable expansion. `[CITED: Postgres LATERAL JOIN docs]`.

**Why one SQL statement (not N inserts):** A single `INSERT … SELECT` is ~50x faster than per-row inserts because there's one round-trip and one set of WAL-fsync overhead. For the 3,600-row ceiling this is the difference between ~50ms and ~2500ms.

**EditPlanningWindow (Phase 03 edit when state='open'):** Run the same `INSERT … SELECT` inside a `DELETE FROM shift_instance WHERE planning_window_id = :pw_id` first, all inside one transaction. The DELETE cascades to `availability` rows referencing those instances (FK CASCADE), so soldiers will need to re-declare. **DOCUMENT in UI**: the edit-window confirmation modal must warn "הצהרות זמינות קיימות יישמרו, חדשות ייצרו כברירת מחדל 'זמין'" (UI-SPEC empty-state catalog) — implementation: actually DELETE then re-INSERT with the **old** `availability` rows preserved by joining on `(shift_slot_id, date, headcount_index)` against the new instance set. Simpler alternative is `DELETE`+`INSERT` and accept that the soldier needs to re-declare. **Recommendation:** simpler alternative; the manager warns soldiers via daily report (Phase 06).

### Recipe 5: DeclareAvailability (AVAL-02..07) — three modes in one handler

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/DeclareAvailability.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function DeclareAvailability({ request, connection }) {
  const {
    planning_window_id,
    mode,            // 'range_blockout' | 'per_slot_toggle' | 'manager_override'
    soldier_id,      // for manager_override; otherwise derived from _user
    range_from, range_to,    // for range_blockout
    shift_instance_id, declared,   // for per_slot_toggle and manager_override
  } = request.properties || {};

  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('DeclareAvailability: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('DeclareAvailability: unauthenticated');
  const roles = request.user?.roles || [];
  const is_admin = roles.includes('unit_admin');
  const is_manager = roles.includes('team_manager');

  if (!planning_window_id) throw new Error('DeclareAvailability: planning_window_id required');
  if (!['range_blockout', 'per_slot_toggle', 'manager_override'].includes(mode)) {
    throw new Error('DeclareAvailability: invalid mode');
  }

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Resolve planning window + lock state.
    const pw = await trx('planning_window')
      .where({ id: planning_window_id, tenant_id }).first('id', 'team_id', 'start_date', 'end_date', 'state', 'constraint_lock_at');
    if (!pw) throw new Error('DeclareAvailability: planning_window not found in tenant');
    if (pw.state !== 'open') throw new Error('DeclareAvailability: window not in open state');

    const now = new Date();
    const locked = new Date(pw.constraint_lock_at) <= now;

    // Resolve target soldier_id.
    let target_soldier_id;
    if (mode === 'manager_override') {
      if (!is_admin && !is_manager) throw new Error('DeclareAvailability: manager_override requires manager/admin role');
      if (!soldier_id) throw new Error('DeclareAvailability: manager_override needs soldier_id');
      // Layer-4 scope: non-admin manager must own this soldier's team.
      if (!is_admin) {
        const own = await trx('membership')
          .where({ tenant_id, org_unit_id: pw.team_id, role: 'team_manager' })
          .whereIn('soldier_id', function() {
            this.select('id').from('soldier').where({ tenant_id, user_id: actor_user_id });
          })
          .first();
        if (!own) throw new Error('DeclareAvailability: manager_override caller not team_manager of target team');
      }
      target_soldier_id = soldier_id;
    } else {
      // soldier writing own availability — derive soldier_id from session user.
      const me = await trx('soldier')
        .where({ tenant_id, user_id: actor_user_id })
        .first('id');
      if (!me) throw new Error('DeclareAvailability: no soldier record for actor');
      target_soldier_id = me.id;

      // Lock guard (AVAL-06): non-manager cannot write after constraint_lock_at.
      if (locked) throw new Error('DeclareAvailability: constraint locked');
    }

    // ── Mode dispatch ─────────────────────────────────────────────────────
    let writes = 0;
    let from_state_for_audit = null;
    let to_state_for_audit = null;

    if (mode === 'range_blockout') {
      if (!range_from || !range_to) throw new Error('DeclareAvailability: range_from/to required');
      if (new Date(range_from) > new Date(range_to)) throw new Error('DeclareAvailability: range_from > range_to');

      // Materialize ALL affected shift_instance rows with declared='unavailable', source='range_blockout'.
      // ON CONFLICT (soldier_id, shift_instance_id): only upgrade when current source has lower precedence.
      // Source precedence: manager_override > per_slot > range_blockout > default
      // range_blockout WILL NOT overwrite per_slot or manager_override rows (lower precedence).
      const res = await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT
           si.tenant_id,
           :soldier_id::uuid,
           si.id,
           'unavailable',
           'range_blockout',
           si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id
           AND si.planning_window_id = :pw_id
           AND si.date BETWEEN :range_from::date AND :range_to::date
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = EXCLUDED.source,
               updated_at = now()
           WHERE availability.source = 'default' OR availability.source = 'range_blockout'
         RETURNING id`,
        { soldier_id: target_soldier_id, tenant_id, pw_id: planning_window_id, range_from, range_to }
      );
      writes = res?.rowCount ?? res?.rows?.length ?? 0;
      to_state_for_audit = 'availability_range_blockout';
    }

    if (mode === 'per_slot_toggle') {
      if (!shift_instance_id) throw new Error('DeclareAvailability: shift_instance_id required');
      if (!['available', 'unavailable'].includes(declared)) {
        throw new Error('DeclareAvailability: declared must be available|unavailable');
      }

      // UPSERT with source='per_slot'.
      // per_slot overrides range_blockout (precedence). Does NOT overwrite manager_override.
      const res = await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT si.tenant_id, :soldier_id::uuid, si.id, :declared, 'per_slot', si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id AND si.id = :si_id
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = 'per_slot',
               updated_at = now()
           WHERE availability.source <> 'manager_override'
         RETURNING id`,
        { soldier_id: target_soldier_id, declared, tenant_id, si_id: shift_instance_id }
      );
      writes = res?.rowCount ?? res?.rows?.length ?? 0;
      to_state_for_audit = 'availability_per_slot';
    }

    if (mode === 'manager_override') {
      if (!shift_instance_id) throw new Error('DeclareAvailability: shift_instance_id required');
      if (!['available', 'unavailable'].includes(declared)) {
        throw new Error('DeclareAvailability: declared must be available|unavailable');
      }

      // Capture previous state for audit.
      const prev = await trx('availability')
        .where({ tenant_id, soldier_id: target_soldier_id, shift_instance_id })
        .first('declared', 'source');
      from_state_for_audit = prev ? `${prev.source}:${prev.declared}` : 'default:available';

      // UPSERT with source='manager_override' — always wins.
      await trx.raw(
        `INSERT INTO availability (tenant_id, soldier_id, shift_instance_id, declared, source, planning_window_id)
         SELECT si.tenant_id, :soldier_id::uuid, si.id, :declared, 'manager_override', si.planning_window_id
         FROM shift_instance si
         WHERE si.tenant_id = :tenant_id AND si.id = :si_id
         ON CONFLICT (soldier_id, shift_instance_id) DO UPDATE
           SET declared = EXCLUDED.declared,
               source = 'manager_override',
               updated_at = now()`,
        { soldier_id: target_soldier_id, declared, tenant_id, si_id: shift_instance_id }
      );
      writes = 1;
      to_state_for_audit = 'availability_manager_override';
    }

    // Audit row IN THE SAME TX.
    await trx('schedule_audit').insert({
      tenant_id,
      planning_window_id,
      from_state: from_state_for_audit,
      to_state: to_state_for_audit,
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({
        mode,
        soldier_id: target_soldier_id,
        was_locked: locked,
        writes,
        shift_instance_id: shift_instance_id || null,
        range_from: range_from || null,
        range_to: range_to || null,
        declared: declared || null,
      }),
    });

    return { writes, mode, soldier_id: target_soldier_id };
  });
}

DeclareAvailability.schema = {
  type: 'object',
  required: ['planning_window_id', 'mode'],
  properties: {
    planning_window_id: { type: 'string', format: 'uuid' },
    mode: { enum: ['range_blockout', 'per_slot_toggle', 'manager_override'] },
    soldier_id: { type: 'string', format: 'uuid' },
    range_from: { type: 'string' },  // ISO date
    range_to: { type: 'string' },
    shift_instance_id: { type: 'string', format: 'uuid' },
    declared: { enum: ['available', 'unavailable'] },
  },
};
DeclareAvailability.connectionType = 'Knex';
DeclareAvailability.meta = { checkRead: false, checkWrite: false };
export default DeclareAvailability;
```

**Subtle but load-bearing design choice: source precedence is enforced inside the ON CONFLICT WHERE clause** rather than as a row-deletion strategy. This preserves audit attribution — if a soldier sets a per_slot override on a day that was range_blockout'd, the previous range_blockout row is *updated* to per_slot, not deleted, and the audit row records the transition.

### Recipe 6: Source-precedence READ query (the "what's my availability" SELECT)

```sql
-- For a given planning_window_id × soldier_id, returns one row per shift_instance with:
--   - effective `declared` and `source` (the winning row)
--   - the row's id (for UI to bind to UPSERT keys)
-- Source rank: manager_override(3) > per_slot(2) > range_blockout(1) > default(0)
-- Returns ALL shift_instances in the window — instances with no `availability` row
-- are projected as ('available', 'default', NULL id).
SELECT
  si.id AS shift_instance_id,
  si.date,
  si.headcount_index,
  ss.id AS shift_slot_id,
  ss.name AS slot_name,
  ss.start_time, ss.end_time,
  COALESCE(av.declared, 'available') AS declared,
  COALESCE(av.source, 'default') AS source,
  av.id AS availability_id
FROM shift_instance si
JOIN shift_slot ss ON ss.id = si.shift_slot_id
LEFT JOIN LATERAL (
  SELECT id, declared, source
  FROM availability a
  WHERE a.shift_instance_id = si.id
    AND a.soldier_id = :soldier_id
    AND a.tenant_id = :tenant_id
  ORDER BY CASE a.source
    WHEN 'manager_override' THEN 3
    WHEN 'per_slot' THEN 2
    WHEN 'range_blockout' THEN 1
    ELSE 0
  END DESC
  LIMIT 1
) av ON true
WHERE si.tenant_id = :tenant_id
  AND si.planning_window_id = :pw_id
ORDER BY si.date, ss.display_order, si.headcount_index;
```

**Why LATERAL with LIMIT 1**: For each `shift_instance` we want the one winning availability row even if multiple sources are present. The `LATERAL` correlated subquery + `ORDER BY CASE source` + `LIMIT 1` is the Postgres idiom for "max by enum precedence". This is preferable to `DISTINCT ON (si.id)` because the latter requires re-grouping by the outer columns, hurting readability with the joined `shift_slot` columns. `[CITED: Postgres LATERAL docs]`.

**YAML usage** (in `my_availability/{planning_window_id}.yaml`):

```yaml
- id: load_availability
  type: KnexRawTenant
  connectionId: shifts_db
  payload:
    tenant_id: { _user: tenant_id }
    soldier_id: { _user: soldier_id }   # populated via session callback in Phase 03
    pw_id: { _input: planning_window_id }
  properties:
    query: |
      <copy SQL above verbatim>
    parameters:
      tenant_id: { _payload: tenant_id }
      soldier_id: { _payload: soldier_id }
      pw_id: { _payload: pw_id }
```

**Important — soldier_id derivation:** The session callback (`ShiftySessionCallback` in `shifty-plugin/src/auth/callbacks.js`) currently exposes `tenant_id, user_id (Auth.js id), roles, team_ids, locale`. It does NOT expose `soldier_id`. Phase 03 must extend `ShiftySessionCallback` to add `soldier_id` (the `soldier` row whose `user_id = app_user.id` for the session's email). This is a one-line change in the callback. **Plan must include this as a Wave-0 task.**

### Recipe 7: SeedTeamRules (RULE-01, RULE-02)

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/SeedTeamRules.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

// PRD §7.6 defaults — frozen.
const DEFAULTS = [
  { rule_key: 'no_same_day_double',                enabled: true,  value: null },
  { rule_key: 'no_consecutive_shift2_then_shift1', enabled: true,  value: null },
  { rule_key: 'max_consecutive_nights',            enabled: true,  value: { max: 3 } },
  { rule_key: 'weekend_separation',                enabled: true,  value: null },
  { rule_key: 'max_weekly_hours',                  enabled: true,  value: { max: 60 } },
  { rule_key: 'min_rest_hours_between_shifts',     enabled: true,  value: { min: 8 } },
  { rule_key: 'max_shifts_per_period',             enabled: false, value: null },
  { rule_key: 'fairness_objective',                enabled: true,  value: { mode: 'count_variance' } },
];

async function SeedTeamRules({ request, connection }) {
  const { team_id } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('SeedTeamRules: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('SeedTeamRules: unauthenticated');
  if (!team_id) throw new Error('SeedTeamRules: team_id required');

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Idempotent: ON CONFLICT (tenant_id, team_id, rule_key) DO NOTHING.
    // Safe to call lazily on every rules-tab load.
    const rows = DEFAULTS.map((d) => ({
      tenant_id, team_id, rule_key: d.rule_key, enabled: d.enabled,
      value: d.value ? JSON.stringify(d.value) : null,
    }));
    const ins = await trx('rule')
      .insert(rows)
      .onConflict(['tenant_id', 'team_id', 'rule_key'])
      .ignore()
      .returning(['id', 'rule_key']);

    if (ins.length > 0) {
      await trx('schedule_audit').insert({
        tenant_id, planning_window_id: null,
        from_state: null, to_state: 'team_rules_seeded',
        actor_user_id, actor_kind: 'system',
        payload: JSON.stringify({ team_id, seeded_count: ins.length }),
      });
    }

    return { seeded: ins.length, rule_keys: ins.map(r => r.rule_key) };
  });
}

SeedTeamRules.schema = {
  type: 'object', required: ['team_id'],
  properties: { team_id: { type: 'string', format: 'uuid' } },
};
SeedTeamRules.connectionType = 'Knex';
SeedTeamRules.meta = { checkRead: false, checkWrite: false };
export default SeedTeamRules;
```

**Page invocation pattern (Rules tab onMount):** Lowdefy's `events.onMount` chain calls `SeedTeamRules` first, then `load_team_rules`. The first call inserts missing rules; subsequent calls are no-ops. `[CITED: Phase 02 pattern — page onMount chains]`.

### Recipe 8: UpsertRule (RULE-03) and UpsertRuleOverride with tightening guard (RULE-04, RULE-05)

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/UpsertRule.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

async function UpsertRule({ request, connection }) {
  const { team_id, rule_key, enabled, value } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('UpsertRule: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('UpsertRule: unauthenticated');
  const roles = request.user?.roles || [];
  if (!roles.includes('unit_admin') && !roles.includes('team_manager')) {
    throw new Error('UpsertRule: requires unit_admin or team_manager');
  }
  if (!team_id || !rule_key) throw new Error('UpsertRule: team_id + rule_key required');

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Layer-4 scope check for non-admin manager (same pattern as CreateShiftSlot).
    // ... (omitted for brevity)

    const prev = await trx('rule')
      .where({ tenant_id, team_id, rule_key })
      .first('id', 'enabled', 'value');

    await trx('rule')
      .insert({
        tenant_id, team_id, rule_key,
        enabled: Boolean(enabled),
        value: value ? JSON.stringify(value) : null,
      })
      .onConflict(['tenant_id', 'team_id', 'rule_key'])
      .merge({
        enabled: Boolean(enabled),
        value: value ? JSON.stringify(value) : null,
        updated_at: trx.fn.now(),
      });

    await trx('schedule_audit').insert({
      tenant_id, planning_window_id: null,
      from_state: prev ? `${prev.enabled}:${JSON.stringify(prev.value)}` : null,
      to_state: 'rule_updated',
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({ team_id, rule_key, enabled, value }),
    });

    return { rule_key, enabled, value };
  });
}

UpsertRule.schema = {
  type: 'object', required: ['team_id', 'rule_key', 'enabled'],
  properties: {
    team_id: { type: 'string', format: 'uuid' },
    rule_key: { enum: [
      'no_same_day_double', 'no_consecutive_shift2_then_shift1', 'max_consecutive_nights',
      'weekend_separation', 'max_weekly_hours', 'min_rest_hours_between_shifts',
      'max_shifts_per_period', 'fairness_objective',
    ] },
    enabled: { type: 'boolean' },
    value: { type: ['object', 'null'] },
  },
};
UpsertRule.connectionType = 'Knex';
UpsertRule.meta = { checkRead: false, checkWrite: false };
export default UpsertRule;
```

**Tightening guard recipe** (the meaningful Phase 03 logic):

```javascript
// app/plugins/shifty-plugin/src/connections/Knex/requests/UpsertRuleOverride.js
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

// Comparison function: returns true iff `override` is STRICTLY a tightening of `baseline`.
// boolean: false→true is a tightening; true→false is a loosening.
// integer-with-max: lower override max = tightening. Higher = loosening.
// integer-with-min: higher override min = tightening (more rest required). Lower = loosening.
// enum (fairness_objective): NOT overridable per CONTEXT D-Area-4.
//
// Rule-key specific semantics:
//   no_same_day_double, no_consecutive_shift2_then_shift1, weekend_separation: boolean enabled
//   max_consecutive_nights, max_weekly_hours, max_shifts_per_period: integer max — lower=tighten
//   min_rest_hours_between_shifts: integer min — higher=tighten
function isTightening(rule_key, baseline, override) {
  // fairness_objective is NOT overridable.
  if (rule_key === 'fairness_objective') return false;

  // Boolean rules: baseline.enabled vs override.enabled.
  if (['no_same_day_double', 'no_consecutive_shift2_then_shift1', 'weekend_separation'].includes(rule_key)) {
    if (baseline.enabled === true && override.enabled === false) return false; // loosening
    if (baseline.enabled === false && override.enabled === true) return true;  // tightening
    return true;  // identical => technically not a change; accept as no-op
  }

  // Integer-max rules: override.max <= baseline.value.max == tightening or equal.
  if (['max_consecutive_nights', 'max_weekly_hours', 'max_shifts_per_period'].includes(rule_key)) {
    const baseVal = baseline.value?.max ?? null;
    const overVal = override.value?.max ?? null;
    if (baseVal === null || overVal === null) return false;
    return overVal <= baseVal;
  }

  // Integer-min rule: override.min >= baseline.value.min == tightening (more rest required).
  if (rule_key === 'min_rest_hours_between_shifts') {
    const baseVal = baseline.value?.min ?? null;
    const overVal = override.value?.min ?? null;
    if (baseVal === null || overVal === null) return false;
    return overVal >= baseVal;
  }
  return false;
}

async function UpsertRuleOverride({ request, connection }) {
  const { soldier_id, rule_key, enabled, value } = request.properties || {};
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) throw new Error('UpsertRuleOverride: tenant_id missing');
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) throw new Error('UpsertRuleOverride: unauthenticated');
  const roles = request.user?.roles || [];
  if (!roles.includes('unit_admin') && !roles.includes('team_manager')) {
    throw new Error('UpsertRuleOverride: requires unit_admin or team_manager');
  }
  if (!soldier_id || !rule_key) throw new Error('UpsertRuleOverride: soldier_id + rule_key required');
  if (rule_key === 'fairness_objective') {
    return { success: false, tightening_rejected: true, reason: 'fairness_objective is team-only — not overridable' };
  }

  return withTenantTx(connection, tenant_id, async (trx) => {
    // Resolve the soldier's team (use FIRST membership that has a rule for this rule_key).
    // For simplicity in v1 the override applies tenant-wide — joined via rule.team_id at solver-time.
    // Find the team's rule row.
    const teamRule = await trx.raw(
      `SELECT r.id AS rule_id, r.enabled, r.value
       FROM rule r
       JOIN membership m ON m.org_unit_id = r.team_id AND m.tenant_id = r.tenant_id
       WHERE r.tenant_id = :tenant_id
         AND r.rule_key = :rule_key
         AND m.soldier_id = :soldier_id
       LIMIT 1`,
      { tenant_id, rule_key, soldier_id }
    );
    const baseline = teamRule?.rows?.[0];
    if (!baseline) throw new Error('UpsertRuleOverride: no team baseline rule found for soldier');

    const override = { enabled: Boolean(enabled), value: value ?? null };

    // TIGHTENING GUARD — semantic check, NOT a DB CHECK.
    if (!isTightening(rule_key, { enabled: baseline.enabled, value: baseline.value }, override)) {
      // Silent rejection — UI shows Alert "חוקי הצוות מחייבים — לא ניתן להקל".
      return {
        success: false,
        tightening_rejected: true,
        reason: 'override loosens team baseline',
        baseline: { enabled: baseline.enabled, value: baseline.value },
        override,
      };
    }

    // Idempotent upsert.
    await trx('rule_override')
      .insert({
        tenant_id, rule_id: baseline.rule_id, soldier_id,
        value: JSON.stringify({ enabled: override.enabled, ...override.value }),
      })
      .onConflict(['rule_id', 'soldier_id'])
      .merge({
        value: JSON.stringify({ enabled: override.enabled, ...override.value }),
        updated_at: trx.fn.now(),
      });

    await trx('schedule_audit').insert({
      tenant_id, planning_window_id: null,
      from_state: 'no_override', to_state: 'rule_override_tightened',
      actor_user_id, actor_kind: 'user',
      payload: JSON.stringify({ soldier_id, rule_key, override, baseline: { enabled: baseline.enabled, value: baseline.value } }),
    });

    return { success: true, rule_key, override };
  });
}

UpsertRuleOverride.schema = {
  type: 'object', required: ['soldier_id', 'rule_key'],
  properties: {
    soldier_id: { type: 'string', format: 'uuid' },
    rule_key: { type: 'string' },
    enabled: { type: 'boolean' },
    value: { type: ['object', 'null'] },
  },
};
UpsertRuleOverride.connectionType = 'Knex';
UpsertRuleOverride.meta = { checkRead: false, checkWrite: false };
export default UpsertRuleOverride;
```

**`tightening_rejected: true` response shape:** The UI binds an Alert visibility to `_request.result.tightening_rejected`. This produces UI-SPEC Error-states catalog row "`חוקים אישיים — soldier override LOOSENS team value`: hidden as Alert" with persistent Alert (not a Message toast).

## Migration 0014 design

```sql
-- 0014_phase3_denorms.up.sql -- two performance denorms supporting Phase 03 UI patterns.
--
-- Column 1: availability.planning_window_id
--   The existing FK `availability.shift_instance_id → shift_instance.id` reaches
--   planning_window only through the shift_instance row. For the source-precedence
--   read query (Recipe 6) we want a single index on (planning_window_id, soldier_id)
--   to avoid a JOIN on hot paths. Also clarifies the cascade: when a planning_window
--   is hard-deleted (Phase 03 only allows it when state=open AND no availability rows),
--   any orphan availability rows are blocked by the new FK (defensive).
--
-- Column 2: org_unit.template_picked_at
--   D-Area-1 (CONTEXT): once a shift template has been applied to a team, the wizard
--   must NOT re-prompt. This timestamp is the sentinel — NULL = wizard prompts, NOT
--   NULL = wizard is suppressed. Set inside ApplyShiftTemplate handler in the same TX.
--
-- Both changes are additive — no existing rows or queries break.

BEGIN;

-- ─── Column 1: availability.planning_window_id ─────────────────────────────

ALTER TABLE availability
  ADD COLUMN IF NOT EXISTS planning_window_id UUID
    REFERENCES planning_window(id) ON DELETE CASCADE;

-- Backfill from shift_instance for any rows created before this migration.
-- (Phase 02 closes with zero `availability` rows so this should be a no-op,
-- but the UPDATE is idempotent and safe to re-run.)
UPDATE availability av
   SET planning_window_id = si.planning_window_id
  FROM shift_instance si
 WHERE av.shift_instance_id = si.id
   AND av.planning_window_id IS NULL;

-- Once backfilled, make it NOT NULL so new rows must include it.
ALTER TABLE availability
  ALTER COLUMN planning_window_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_availability_window_soldier
  ON availability(planning_window_id, soldier_id);

-- ─── Column 2: org_unit.template_picked_at ─────────────────────────────────

ALTER TABLE org_unit
  ADD COLUMN IF NOT EXISTS template_picked_at TIMESTAMPTZ;

-- (No backfill — NULL means "wizard not yet seen", which is the correct default
--  for every Phase 02 team that was created before this migration.)

COMMIT;
```

**Rationale for NOT NULL on availability.planning_window_id:** Every `shift_instance` has a non-null `planning_window_id` (0003 schema). Every `availability` row references a `shift_instance`. By transitive closure the denorm is always non-null, so NOT NULL is safe and prevents future code paths from forgetting it.

**Order of operations during deploy:**
1. Apply 0014 via `docker compose run --rm migrate up` (golang-migrate); the `migrate` service runs as the `migrator` superuser bypassing RLS, so the backfill UPDATE can touch every tenant's rows.
2. Rebuild Lowdefy with the new handler set (PsExec because the build invokes credential helper).
3. Cross-tenant-leak.spec.ts auto-picks up the new pages on next run.

## Mobile-first RTL patterns

### Pattern 1: Expandable date list WITHOUT AgGrid master-detail (HIGH-confidence)

**Why this matters:** AG Grid master-detail is Enterprise-only in v32.x. `@lowdefy/blocks-aggrid@5.3.0` ships AG Grid 32.3.9 **community**. The UI-SPEC Surface 8 phrasing "AgGrid master-detail or Lowdefy `visible:` toggle" collapses to the second option.

**Implementation:** A Lowdefy `Box` with `_repeat` over the date list, each repeated row being itself a Box with two children:
- A "row header" Box (date label + status badge + chevron) — clickable.
- A "row body" Box with `visible: { _eq: [{ _state: expanded_date }, <this_date>] }` — contains the per-slot Switches.

```yaml
- id: date_list
  type: Box
  blocks:
    - id: date_row_repeated
      type: Box
      areas:
        content:
          blocks:
            _repeat:
              key: date_iso  # ISO date string from grouped query
              loop: { _request: load_dates_in_window }
              blocks:
                - id: row_for_$
                  type: Box
                  layout:
                    direction: column
                  blocks:
                    - id: header_for_$
                      type: Box
                      events:
                        onClick:
                          - id: toggle
                            type: SetState
                            params:
                              expanded_date:
                                _if_none:
                                  - { _eq: [{ _state: expanded_date }, '$.date_iso'] }
                                  - null     # collapse if currently expanded
                                  - '$.date_iso'  # expand otherwise
                      blocks:
                        # weekday name + DD/MM + status badge + chevron
                        ...
                    - id: body_for_$
                      type: Box
                      visible:
                        _eq: [{ _state: expanded_date }, '$.date_iso']
                      blocks:
                        # one Switch per shift_instance for this date
                        _repeat:
                          ...
```

**Notes:**
- Lowdefy's `_repeat` operator iterates over an array and substitutes `$` for the current item. `[CITED: Lowdefy operators reference]`.
- Click target sizing: every `header_for_$` Box must have `style: { minHeight: 48px }` to meet the 48×48 mobile floor.
- The chevron icon uses `react-icons` AiOutlineCaretDown vs. AiOutlineCaretLeft (RTL — caret points LEFT when "open trailing edge" because RTL flips visual direction).

### Pattern 2: Optimistic UI for per-slot Switch (auto-save)

```yaml
- id: slot_switch
  type: Switch
  events:
    onChange:
      - id: optimistic_set
        type: SetState
        params:
          # Update local state immediately — Switch visual reflects the new value.
          per_slot_state.$shift_instance_id: { _event: value }
      - id: save_to_server
        type: Request
        params:
          requestId: declare_availability
          payload:
            planning_window_id: { _input: planning_window_id }
            mode: per_slot_toggle
            shift_instance_id: '$shift_instance_id'
            declared:
              _if_none:
                - { _event: value }
                - 'unavailable'  # Switch.checked=true → "available"? depends on label
                - 'available'
      - id: on_success
        type: Message
        skip: { _not: { _request: declare_availability.success } }
        params:
          content: נשמר
          duration: 2
      - id: on_failure
        type: Notification
        skip: { _request: declare_availability.success }
        params:
          type: error
          message: 'שגיאה בשמירה — נסה שוב'
      - id: revert_on_failure
        type: SetState
        skip: { _request: declare_availability.success }
        params:
          # Revert local state on failure.
          per_slot_state.$shift_instance_id: { _not: { _event: value } }
```

**Debounce strategy:** Phase 03 first iteration uses no debounce — each Switch toggle fires its own request. If the manager-edit screen exhibits rapid toggling, add a `_state` accumulator + setTimeout-style flush in a follow-up plan. Out of scope for the first cut.

### Pattern 3: Mobile-first responsive layout (RTL preserved)

| Viewport | Layout | Mechanism |
|----------|--------|-----------|
| ≥768px (desktop) | Side-by-side: range card 40% + date list 60% | Lowdefy `Box` with `layout.direction: row` + child `flex` values |
| <768px (mobile) | Stacked: range card on top, date list below; range card date pickers stack vertically | Same `Box` but `responsive` breakpoints via Ant Design `Row`+`Col` with `xs={24} md={10/14}` |

**Lowdefy doesn't have first-class responsive breakpoints** — the pattern is to use Ant's `Row/Col` blocks (`@lowdefy/blocks-antd` exposes them) and set `xs/sm/md/lg/xl/xxl` per child. `[CITED: Ant Design Grid responsive props]`.

### Pattern 4: 48px touch targets (PRD A11Y + WCAG 2.1)

Every interactive element on `my_availability` mobile MUST have a `minHeight: 48px` AND `minWidth: 48px` (or wide enough to inherit the row width). Specifically:
- Date row "header_for_$" Box → minHeight 48.
- Each Switch container → minHeight 48 (the Switch itself is smaller; pad with `paddingBlock`).
- Range form Submit button → `style: { width: '100%', height: 48 }`.
- Chevron icon hit area → 48×48 tap zone (wrap the icon in a Box with explicit dimensions).

`[CITED: WCAG 2.5.5 Target Size — minimum 24×24 CSS pixels; Apple HIG recommends 44×44; Android Material 48×48]`. Use 48 as the floor.

## Test strategy

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.x (whatever Phase 02 pinned in package.json) |
| Config file | `playwright.config.ts` (sequential, BASE_URL from env, 30s timeout) |
| Quick run command | `pnpm exec playwright test tests/e2e/<spec>.spec.ts` |
| Full suite command | `pnpm exec playwright test` |
| Direct PG client for fixtures | `pg` package (already in tests/e2e/_fixtures) |

### Pattern A: UI-driven mutation test (the P02-HF-05 rebuild template)

The 21 deferred Phase 02 specs failed because they used direct API POST + `{ payload: {...} }` while the page YAMLs source every field via `_state:` operators. Rebuild template:

```typescript
// tests/e2e/phase2-rebuild-soldier-crud.spec.ts (Plan 03-01-PLAN target)
import { test, expect } from '@playwright/test';
import { seedTwoTenants, signInAs, SESSION_COOKIE_NAME, type TenantFixture } from './_fixtures/seed-tenants.js';
import { teardownTestData } from './_fixtures/teardown.js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';

let tenantA: TenantFixture;
let adminSignIn: { sessionToken: string; userId: string; cookies: string };

test.beforeAll(async () => {
  await teardownTestData();
  const seeded = await seedTwoTenants();
  tenantA = seeded.tenantA;
  adminSignIn = await signInAs(tenantA.adminEmail);
});

test.afterAll(async () => { await teardownTestData(); });

test.describe('Phase 02 rebuild — soldier CRUD via UI (P02-HF-05)', () => {
  test('A: admin creates soldier via manage_soldiers form', async ({ page }) => {
    // Set HTTPS-mode cookie.
    await page.context().addCookies([{
      name: SESSION_COOKIE_NAME,
      value: adminSignIn.sessionToken,
      url: BASE_URL,
      httpOnly: true,
      secure: true,    // BASE_URL is HTTPS (apps.nesher.co) per CLAUDE.md
      sameSite: 'Lax',
    }]);

    await page.goto(`${BASE_URL}/manage_soldiers`, { waitUntil: 'networkidle', timeout: 15_000 });

    // Open the Add-soldier modal (CTA label "הוסף חייל").
    await page.getByRole('button', { name: 'הוסף חייל' }).click();

    // Fill the form. Lowdefy renders form fields with `id="<block_id>"` attribute on
    // the underlying Ant Input. Use the block id (the YAML `id:` value) as the label/locator.
    await page.locator('[id="new_soldier_form_display_name"]').fill('יוסי כהן');
    await page.locator('[id="new_soldier_form_email"]').fill(`yossi-${Date.now()}@example.test`);
    await page.locator('[id="new_soldier_form_seniority"]').fill('5');
    // role_tags TagPicker — open then click an autocomplete item.
    await page.locator('[id="new_soldier_form_role_tags"]').click();
    await page.getByText('driving').click();

    // Submit — primary CTA "שמור".
    await page.getByRole('button', { name: 'שמור' }).click();

    // Assert: success toast appears AND the new soldier is in the grid.
    await expect(page.getByText('החייל נוצר')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.ag-cell').filter({ hasText: 'יוסי כהן' })).toBeVisible();
  });
});
```

**Key load-bearing differences from the failed approach:**
1. `page.goto(BASE_URL/<pageId>)` exercises the entire Lowdefy SSR pipeline (auth → page-level `auth.roles` → YAML render).
2. `page.locator(...).fill(...)` writes into the rendered DOM; Lowdefy's `Onchange`-bound `_state` accumulator captures the value naturally — same path the manager uses.
3. `page.getByRole('button').click()` fires the YAML event chain, which produces the payload via the YAML's `_state:` operators (the same pipeline the test originally bypassed).

**Locator strategy:**
- For Ant inputs inside Lowdefy blocks: `[id="<block_id>_<field_name>"]` works because Lowdefy emits the block's `id` as the `id` attribute on the rendered Ant component.
- For buttons with Hebrew labels: `page.getByRole('button', { name: 'שמור' })` — Playwright supports unicode role-name matching.
- For AgGrid cells: `page.locator('.ag-cell').filter({ hasText: '...' })`.
- For Switches: `page.locator('[id="..."] .ant-switch')` — toggle via `.click()`.

**Skip-on-stack-down preservation:** Wrap `page.goto` in try/catch and `test.skip(true, '...')` per the existing pattern in cross-tenant-leak.spec.ts. The new specs MUST run green locally (Lowdefy down → skip) and on hpg5 (Lowdefy up → execute).

### Pattern B: Unit test for tightening guard (NO Postgres needed)

```javascript
// tests/unit/rule-override-tightening.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Export isTightening as a named export from UpsertRuleOverride.js for testability.
import { isTightening } from '../../app/plugins/shifty-plugin/src/connections/Knex/requests/UpsertRuleOverride.js';

test('max_consecutive_nights: lower override is tightening', () => {
  assert.equal(isTightening('max_consecutive_nights', { enabled: true, value: { max: 3 } }, { enabled: true, value: { max: 2 } }), true);
});
test('max_consecutive_nights: higher override is loosening', () => {
  assert.equal(isTightening('max_consecutive_nights', { enabled: true, value: { max: 3 } }, { enabled: true, value: { max: 5 } }), false);
});
test('min_rest_hours: higher override is tightening', () => {
  assert.equal(isTightening('min_rest_hours_between_shifts', { value: { min: 8 } }, { value: { min: 10 } }), true);
});
test('boolean: false→true is tightening, true→false is loosening', () => {
  assert.equal(isTightening('no_same_day_double', { enabled: false }, { enabled: true }), true);
  assert.equal(isTightening('no_same_day_double', { enabled: true }, { enabled: false }), false);
});
test('fairness_objective is never overridable', () => {
  assert.equal(isTightening('fairness_objective', { value: { mode: 'count_variance' } }, { value: { mode: 'off' } }), false);
});
```

**This is the canonical "pure JS unit test" template** (same shape as `tests/unit/canonicalize.spec.ts`).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Test file / command | File Exists? |
|--------|----------|-----------|----------------------|---------------|
| SHFT-01 | CreateShiftSlot persists with required_role_tags + min_seniority | Playwright UI | `tests/e2e/shift-slot-crud.spec.ts` (new) | ❌ Plan 03-02+ |
| SHFT-02 | Template wizard inserts 2x12h / 3x8h Hebrew-exact names | Playwright UI | same | ❌ Plan 03-02+ |
| SHFT-05/06 | OpenPlanningWindow creates correct cross-product count | Playwright + direct PG | `tests/e2e/planning-window-open.spec.ts` (new) | ❌ Plan 03-03+ |
| SHFT-07 | constraint_lock_at defaults to start-3d 23:59 Asia/Jerusalem | Unit + Playwright | same | ❌ Plan 03-03+ |
| AVAL-02 | Range blockout materializes ALL affected instances | Playwright + direct PG | `tests/e2e/availability-declare.spec.ts` (new) | ❌ Plan 03-05+ |
| AVAL-04 | Source precedence enforced in READ query | Direct PG only (no UI) | `tests/integration/availability-source-precedence.spec.ts` (new) | ❌ Plan 03-05+ |
| AVAL-06 | Lock prevents non-manager write after constraint_lock_at | Playwright + direct PG | same | ❌ Plan 03-05+ |
| AVAL-07 | Manager write after lock produces schedule_audit row | Playwright + direct PG | same | ❌ Plan 03-05+ |
| RULE-01 | SeedTeamRules inserts 8 defaults at PRD values | Direct PG | `tests/integration/seed-team-rules.spec.ts` (new) | ❌ Plan 03-06+ |
| RULE-04 | UpsertRuleOverride rejects loosening | Unit + Playwright | `tests/unit/rule-override-tightening.spec.ts` (new) | ❌ Plan 03-06+ |
| P02-HF-05 | 21 deferred Phase 02 mutation specs rebuilt as UI flows | Playwright UI | 5 rebuild spec files (see below) | ❌ **Plan 03-01** (load-bearing) |

### Plan 03-01 (P02-HF-05 rebuild) deliverables

| Original failing spec (direct-API) | Rebuild file | Tests | Notes |
|------------------------------------|-------------|-------|-------|
| `tests/e2e/soldier-crud.spec.ts` (5 tests A–E) | rebuild in place | 5 tests | manage_soldiers + soldier_detail UI flows |
| `tests/e2e/roster-csv-import.spec.ts` (5 tests A–D, A2) | rebuild in place | 5 tests | roster_import wizard + 3-step flow (file paste → preview → commit) |
| `tests/e2e/org-unit-crud.spec.ts` (4 tests A,D,E,F) | rebuild in place | 4 tests | manage_org_units tree-table UI flows |
| `tests/e2e/tenant-isolation.spec.ts` (2 tests A,B) | rebuild in place | 2 tests | UI navigation reveals cross-tenant probe still 403s |
| `tests/e2e/ui-smoke-phase2.spec.ts` (5 tests a,b,c,d,e — keep f green API smoke) | rebuild a–e; keep f | 5 tests | The 6 UI smoke scenarios go UI-driven; scenario `f` (cross-tenant blank) stays page.goto-based (it already works) |

**Total: 21 tests across 5 spec files.** All use the same Pattern A template.

### Sampling Rate
- **Per task commit:** Run only the spec for the changed plan (`pnpm exec playwright test tests/e2e/<plan>.spec.ts`) — typically < 30s.
- **Per plan merge:** Run all Phase 03 specs (`pnpm exec playwright test tests/e2e/availability* tests/e2e/planning-window* tests/e2e/shift-slot* tests/e2e/rules*`) — typically ~3-5 min.
- **Phase gate (`/gsd:verify-work`):** Full suite green: `pnpm exec playwright test` + unit `node --test --experimental-strip-types tests/unit/*.spec.ts`.

### Wave 0 Gaps
- [ ] `tests/unit/rule-override-tightening.spec.ts` — covers RULE-04
- [ ] `tests/integration/availability-source-precedence.spec.ts` — direct-PG only (no Playwright); covers AVAL-04
- [ ] `tests/integration/seed-team-rules.spec.ts` — direct-PG only; covers RULE-01
- [ ] `tests/e2e/_fixtures/seed-tenants.ts` extension — add `seedFullWindow(tenantId, teamId)` helper that creates `shift_slot` rows + `planning_window` + `shift_instance` cross-product for UI tests that need a populated window. Reuses ApplyShiftTemplate + OpenPlanningWindow handler logic in raw SQL form (NO RLS — uses `SET ROLE NONE`).

## Common Pitfalls

### Pitfall 1: Forgetting `.meta = { checkRead, checkWrite }` on new handlers
**What goes wrong:** `@lowdefy/api` 5.3 calls `requestResolver.meta.checkRead` inside `checkConnectionRead`. Missing `.meta` produces `TypeError: Cannot read properties of undefined (reading 'checkRead')` at request dispatch — every Phase 03 handler that omits this line ships broken.

**Why it happens:** Easy oversight — the rest of the handler shape (schema, connectionType) is repeated across handlers and tracked by reviewers; `.meta` is a 1-liner that's easy to skip.

**How to avoid:** Add a Wave-0 `tools/check-handler-meta.mjs` script that greps every file in `app/plugins/shifty-plugin/src/connections/Knex/requests/*.js` for the literal `.meta = { checkRead`. CI fails the build if any handler is missing it. This is a 5-minute script and prevents the 02-11 regression class from recurring.

**Warning signs:** First UI smoke test on hpg5 returns 500 + `TypeError: undefined.checkRead` in container logs.

### Pitfall 2: Direct-API POSTs in tests (the P02-HF-05 root cause)
**What goes wrong:** Tests POST raw JSON to `/api/request/<pageId>/<requestId>` with `{ payload: { ... } }`. The page YAML's `payload:` block sources every field via `_state:` operators. Direct callers have no UI state → all fields resolve to `undefined` → schema validation fails with `Request "X" required property "Y" is missing`.

**Why it happens:** It's easier to write `request.post(...)` than `page.fill(...)`. Mental shortcut: "the API is the contract — let me hit it directly."

**How to avoid:**
- **Default to Playwright UI-driven flows** for every mutation test in Phase 03+. The API path is internal; the user-facing contract is the YAML page.
- **Only use direct API for tests that genuinely probe the API contract** — e.g., the forged-payload pen-test in `ui-smoke-phase2 test 'a'` (which intentionally crafts a payload that the UI can't produce).

**Warning signs:** A new spec passes locally but fails on hpg5 with `ConfigError: schema validation failed`.

### Pitfall 3: Confusing source precedence with row uniqueness
**What goes wrong:** A naive implementation deletes the previous `availability` row when a higher-precedence write arrives (e.g., DELETE WHERE source='range_blockout' before INSERT source='per_slot'). This loses audit attribution — the schedule_audit row says "per_slot" but the original range_blockout context is gone.

**Why it happens:** The UNIQUE constraint on `(soldier_id, shift_instance_id)` invites the assumption that there's "one row per soldier-instance" and that overriding means rewriting.

**How to avoid:** The UPSERT pattern in Recipe 5 uses `ON CONFLICT DO UPDATE` with a precedence-aware `WHERE` clause that filters which rows can be overwritten. The row is UPDATED in place, preserving its `id` and `created_at`. Audit row records the transition explicitly.

**Warning signs:** Manager-override audit row exists but `availability` row reads `source='per_slot'` — means the manager write was silently filtered by the WHERE clause.

### Pitfall 4: `_user.soldier_id` not in session shape
**What goes wrong:** The Phase 03 `my_availability` page does `payload: { soldier_id: { _user: soldier_id } }`. ShiftySessionCallback (Phase 02) does NOT include `soldier_id` in `session.user` — only `tenant_id, user_id, roles, team_ids, locale`. The payload resolves to `undefined` and the handler fails on the guard `if (!soldier_id) throw …`.

**Why it happens:** It's a one-line gap in the session callback that's invisible until Phase 03 needs it.

**How to avoid:** Extend `ShiftySessionCallback` (in `app/plugins/shifty-plugin/src/auth/callbacks.js`) to look up `soldier.id WHERE soldier.user_id = app_user.id AND soldier.tenant_id = session.tenant_id` and append it to `session.user`. **Add this as Wave-0 task in Plan 03-02** (the first product plan after the P02-HF-05 rebuild).

**Warning signs:** First `my_availability` page load returns 500 + `DeclareAvailability: no soldier record for actor`.

### Pitfall 5: AG Grid master-detail assumed in v32 community
**What goes wrong:** Phase 03 plan adopts AgGrid master-detail per UI-SPEC Surface 8 phrasing → next-page render in browser shows the date list flat (no master rows) and the dev wastes 1-2 hours debugging before realizing master-detail is Enterprise.

**Why it happens:** AG Grid Community ships with most features; only ~10 features (master-detail, server-side row model, integrated charts) are Enterprise. Easy to miss.

**How to avoid:** Use Lowdefy `Box` + `_repeat` + `visible:` toggle (Pattern 1 above). Document the choice in `app/pages/my_availability/<pw_id>.yaml` with a comment header.

**Warning signs:** AgGrid grid renders empty rows on expand-click; `console.error: masterDetail requires Enterprise version`.

### Pitfall 6: planning_window edit DELETEs availability via FK CASCADE
**What goes wrong:** Manager edits an open `planning_window` to extend `end_date`. Naive implementation: `DELETE FROM shift_instance WHERE planning_window_id = :pw_id; INSERT … SELECT (new cross-product)`. The DELETE cascades to `availability` rows via FK CASCADE. Soldiers' prior declarations are wiped.

**Why it happens:** Foreign keys with `ON DELETE CASCADE` are the default in 0003/0004; nobody thinks about them at handler-write time.

**How to avoid:**
- Either rebuild the same `(shift_slot_id, date, headcount_index)` triples (skip DELETE) and let unmatched rows persist as orphans (NOT recommended).
- Or, before DELETE, snapshot the `(shift_instance_id → (shift_slot_id, date, headcount_index))` mapping; after INSERT…SELECT of new instances, copy `availability` rows from old to new by matching the triple. This is complex.
- **Simplest recommendation:** accept the wipe, warn the user in the UI ("הצהרות זמינות יישמרו את חלקי החפיפה ויחודשו כברירת מחדל 'זמין' למשמרות חדשות"), and surface a count of cleared rows. This is what the EditPlanningWindow handler implements.

**Warning signs:** Manager extends date range from 14 days to 21 days; soldiers' prior per-slot declarations for days 1-14 vanish.

### Pitfall 7: Resolving `constraint_lock_at` default at wrong timezone
**What goes wrong:** Naive `start_date - 3 days at 23:59` produces UTC midnight-ish, not Asia/Jerusalem. Soldiers in Israel see the lock countdown badge show "in 4 hours" when they expected "in 3 days at 23:59 local."

**Why it happens:** Postgres `TIMESTAMP WITH TIME ZONE` arithmetic is intuitive in UTC but the user reads it in `Asia/Jerusalem`.

**How to avoid:** Use the explicit `AT TIME ZONE 'Asia/Jerusalem'` cast in the handler default expression:
```sql
(:start_date::date - INTERVAL '3 days')::date + TIME '23:59:00' AT TIME ZONE 'Asia/Jerusalem'
```
This produces a `TIMESTAMPTZ` that, when displayed to a soldier in Asia/Jerusalem locale, reads 23:59 local time on the resolved date. `[CITED: Postgres timestamp arithmetic with timezone]`.

**Warning signs:** Lock countdown badge shows wrong time relative to soldier expectation; UAT fails on "lock fires when expected."

## Phase 03 risks + mitigations

### Risk R-03-1: Plugin-registration regression (recur of UAT-FINDINGS §3)
**Likelihood:** Medium. The 02-11 hotfix added 4 new files to `requests/`. Phase 03 adds 11 more (CreateShiftSlot/UpdateShiftSlot/DeleteShiftSlot/OpenPlanningWindow/EditPlanningWindow/DeletePlanningWindow/ApplyShiftTemplate/DeclareAvailability/UpsertRule/UpsertRuleOverride/ResetRuleOverride/SeedTeamRules). Each must be imported in Knex.js AND named in types.js AND export the .meta field. One forgotten import = silent failure.

**Mitigation:** Add `tools/check-handler-registration.mjs` as a Plan 03-01 deliverable. Script grep:
1. Every file in `connections/Knex/requests/*.js` exports a default function.
2. Every default function has `.meta = { checkRead: ..., checkWrite: ... }`.
3. Every default function has `.connectionType = 'Knex'`.
4. Every default function appears in `types.js` `requests:` array.
5. Every default function is imported AND spread into `requests:` map in `connections/Knex/Knex.js`.

Run in CI pre-merge. This is the structural-verifier gate that 02-11 retrospective recommended.

### Risk R-03-2: Cross-tenant leak in shift_instance via shift_slot UPDATE
**Likelihood:** Low but high-impact. If `UpdateShiftSlot` doesn't include `tenant_id` in the WHERE clause, a forged `shift_slot_id` from tenant-B could be mutated by a tenant-A admin.

**Mitigation:** Every UPDATE/DELETE in Phase 03 handlers MUST have `.where({ id: :id, tenant_id: :tenant_id })` — same pattern as Phase 02 UpdateSoldier. The `withTenantTx` SET LOCAL provides Layer-5 backstop, but Layer-4 must be explicit.

**Verification:** Extend `tools/check-queries.mjs` (Phase 01 CI gate) to scan plugin JS files for `.update(` / `.delete(` and verify each has a `tenant_id` predicate in the same chain. Currently the script only scans YAML.

### Risk R-03-3: source_rank precedence drift between handler and read query
**Likelihood:** Medium. The handler (DeclareAvailability) uses `WHERE availability.source = ...` literals in the ON CONFLICT clause. The read query uses `ORDER BY CASE source WHEN ... THEN N`. If a developer adds a new source value or reorders the precedence, the two must stay in sync — but they live in different files.

**Mitigation:** Extract the precedence enum into a single JS helper:

```javascript
// app/plugins/shifty-plugin/src/helpers/availability-source.js
export const SOURCE_RANK = {
  manager_override: 3,
  per_slot: 2,
  range_blockout: 1,
  default: 0,
};
export const SOURCE_VALUES = Object.keys(SOURCE_RANK);
```

Import in DeclareAvailability AND embed the CASE expression generation programmatically into the read SQL string (or hardcode the SQL CASE and add a unit test that asserts `Object.entries(SOURCE_RANK).sort()` matches the CASE arms).

### Risk R-03-4: Mobile UAT shows AgGrid date-list with horizontal scroll
**Likelihood:** Medium. The UI-SPEC says "no horizontal scroll" but `AgGridAlpine` by default produces a scrollable grid container. The `domLayout: autoHeight` + `defaultColDef.flex: 1` combination is necessary; missing it = scroll bar.

**Mitigation:** Plan 03-05 (the my_availability page plan) MUST include a UAT step that loads the page on a 320px viewport (Playwright `viewport: { width: 320, height: 800 }`) and asserts `document.documentElement.scrollWidth <= document.documentElement.clientWidth`. This is a 5-line addition to the spec.

### Risk R-03-5: 30-day cross-product hits 3,600 ceiling on edge case
**Likelihood:** Low. The CONTEXT cap derives `30 × 30 × 4 = 3,600`, assuming 4 slots and headcount 1 each. A team with 4 slots × headcount 4 each over 30 days produces `30 × 4 × 4 = 480` instances. Same team with 8 slots × headcount 4 × 30 days = 960. Only pathological configurations exceed 3,600.

**Mitigation:** OpenPlanningWindow Recipe 4 already has the belt-and-braces check:
```javascript
if (instance_count > 3600) {
  throw new Error(`OpenPlanningWindow: instance_count ${instance_count} exceeds 3,600 ceiling`);
}
```
**Documented escape hatch:** v1.1 considers raising the ceiling once Phase 04 solver perf is profiled. For now, the error message in Hebrew tells the manager to split into two shorter windows.

## State of the Art

| Old (Phase 02 / pre-Phase-03) | Current (Phase 03 design) | Why changed |
|-------------------------------|---------------------------|-------------|
| Custom-request handlers register via `connections.js` default export | Same; ADD `.meta = { checkRead, checkWrite }` per handler | 02-11 hotfix discovered upstream requirement |
| Test suite uses direct API POSTs | Mutation tests use Playwright UI flows (`page.fill` + `page.click`) | UAT-FINDINGS §3 — payload binding through `_state:` makes direct API tests structurally incompatible |
| `availability.shift_instance_id` reachable via JOIN to get planning_window | Direct `availability.planning_window_id` denorm (migration 0014) | Phase 03 read-query hot path avoids JOIN |
| Single team rule_override (per-soldier) treated as boolean override | Soldier override is a STRICT TIGHTENING — semantic guard in handler | PRD §7.6 + CONTEXT D-Area-4 |
| Source precedence not enforced (no Phase 02 availability writes) | Source precedence enforced in WRITE (ON CONFLICT WHERE) and READ (LATERAL ORDER BY CASE) | New for Phase 03 |
| Cross-product materialization: deferred | INSERT…SELECT cross-product inside one TX | Phase 03 introduces planning_window; cross-product is the load-bearing piece |

**Deprecated/outdated patterns to AVOID:**
- AG Grid master-detail (Enterprise-only in v32; use Lowdefy `visible:` toggle instead)
- DELETE-then-INSERT for source-precedence overrides (loses audit attribution)
- Direct API POST tests for mutation paths (incompatible with `_state:` payload binding)
- Embedding `tenant_id` from request body / `_state` / `_input` (forgeable — always `_user: tenant_id`)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@lowdefy/blocks-aggrid@5.3.0` ships AG Grid 32.3.9 community (no master-detail) | Stack pins | If wrong (i.e., master-detail IS available), mobile UX can use simpler pattern; not a blocker. Mitigation: verify by running `docker exec shifty-lowdefy cat /build/.lowdefy/server/node_modules/ag-grid-community/package.json | grep version` at Plan-03-05 implementation time. |
| A2 | Lowdefy 5.3 `_repeat` operator supports `$` substitution for the iterated item | Mobile-first patterns | If wrong, fall back to per-row Box generation in a server-side handler that returns prerendered block YAML. Mitigation: cite Lowdefy operators reference at Plan-write time. |
| A3 | ShiftySessionCallback does not currently expose `soldier_id` | Pitfall 4 | If wrong, the one-line callback extension is unnecessary. Mitigation: grep `session.user` in `callbacks.js` during Plan 03-02 Wave-0. |
| A4 | `availability.planning_window_id` does not currently exist in the live schema | Migration 0014 | If wrong, migration 0014 is a no-op for column 1. Mitigation: verify via `\d availability` against hpg5 prior to applying 0014. |
| A5 | `org_unit.template_picked_at` does not currently exist in the live schema | Migration 0014 | Same as A4. Verified — 0012 added `last_color_index`; no `template_picked_at` reference in any migration. |
| A6 | The `migrate` service can apply 0014 without manual intervention | Migration 0014 | If wrong, document manual psql fallback. Mitigation: run on hpg5 once before declaring Plan 03 wave-0 done. |
| A7 | Playwright's `page.getByRole('button', { name: '<Hebrew>' })` works with RTL Hebrew labels | Test strategy Pattern A | If wrong, fall back to `page.locator('button:has-text("<text>")')`. Both work; the role-based selector is preferred for accessibility verification. |
| A8 | The 3,600 instance ceiling is sufficient for v1 (no real customer hits it) | Risk R-03-5 | Tenant-#1 (kibbutz fixture) is 12 soldiers × 64 days × 2 slots × headcount 1 = 128 instances. v1 launch tenants are similar scale. Mitigation: telemetry post-launch. |

All A1-A8 are LOW risk; none block planning.

## Open Questions

1. **EditPlanningWindow availability preservation strategy**
   - What we know: Current schema has `ON DELETE CASCADE` from `shift_instance.planning_window_id` to `availability`. Deleting+re-INSERTing instances wipes availability.
   - What's unclear: Is the "wipe + re-default" UX acceptable to managers, or do we need the more complex "preserve by (slot_id, date, headcount_index) match"?
   - Recommendation: Plan 03-04 (planning_window edit) implements wipe + re-default with explicit Hebrew warning ("הצהרות זמינות עבור חלקי החפיפה יישמרו אוטומטית; משמרות חדשות יאופסו לברירת מחדל 'זמין'"). Then implement preservation in Plan 03-04 Task 3 if time permits — otherwise defer to v1.1.

2. **SeedTeamRules timing — at CreateTeam time or lazily on first Rules-tab load?**
   - What we know: CONTEXT D-Area-4 says "called from `CreateTeam` OR lazily on first rules-tab load". Both work; the choice is operational.
   - What's unclear: Phase 02's `CreateTeam` handler is the org_unit creation in `manage_org_units.yaml`. Modifying it touches Phase 02 surface area.
   - Recommendation: **Lazy** — call SeedTeamRules from the Rules tab's `events.onMount`. The ON CONFLICT IGNORE makes it idempotent. Avoids touching Phase 02 code.

3. **Source rank when display order matters for cross-soldier rendering**
   - What we know: Read query orders by `(date, slot.display_order, headcount_index)`. Each (date, slot, hc_idx) tuple has exactly one row in the result set.
   - What's unclear: When a manager views all team soldiers' availability simultaneously (planning_window_detail "זמינות חברי צוות" tab — UI-SPEC Surface 7), do we render N parallel grids or one pivot grid?
   - Recommendation: Phase 03 v1 renders the status SUMMARY only ("X/Y הצהירו"). Per-soldier drill goes through the manager-override path. The full team pivot is deferred to Phase 04 (when the solver shows assignments and the pivot becomes load-bearing).

4. **constraint_lock_at as TIMESTAMPTZ — UI display in Hebrew/RTL**
   - What we know: Postgres returns `TIMESTAMPTZ` as ISO8601 UTC. Lowdefy auto-converts to user locale via `_format`.
   - What's unclear: Whether the existing Phase 02 Hebrew date formatter handles the conversion correctly for the lock countdown badge.
   - Recommendation: Plan 03-03 (planning_window page) Task includes a UAT step confirming "נעילה בעוד {N} ימים" calculates correctly across DST boundaries (Asia/Jerusalem observes DST). Use `moment.duration` or `date-fns/formatDistance` inside a `_function` operator.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Lowdefy 5.3 + shifty-plugin (hpg5) | Every Phase 03 deployment | ✓ | 5.3.0 | — |
| Postgres 16 (hpg5 docker) | All migrations + handlers | ✓ | 16 | — |
| PsExec wrapper (hpg5 SSH) | Rebuild Lowdefy after handler changes | ✓ | (system) | — |
| Playwright runner | All e2e tests | ✓ | (Phase 02 baseline) | — |
| node-postgres `pg` package | Test fixtures + integration tests | ✓ | (Phase 02 baseline) | — |
| node:test runtime | Unit tests | ✓ | Node 22 builtin | — |
| AG Grid Enterprise | Master-detail expand on `my_availability` | ✗ (community only via `@lowdefy/blocks-aggrid@5.3.0`) | n/a | Lowdefy `Box` + `_repeat` + `visible:` toggle (Pattern 1 above). |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** AG Grid Enterprise — fallback path documented.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.x (config: `playwright.config.ts`) + node:test for unit |
| Config file | `playwright.config.ts` (sequential, 30s timeout, BASE_URL from env) |
| Quick run command | `pnpm exec playwright test tests/e2e/<spec>.spec.ts` |
| Full suite command | `pnpm exec playwright test && node --test --experimental-strip-types tests/unit/*.spec.ts` |

### Phase Requirements → Test Map

(Full mapping in the Test strategy section above; key items shown.)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| P02-HF-05 | 21 deferred specs rebuilt as UI flows | Playwright UI | `pnpm exec playwright test tests/e2e/{soldier-crud,roster-csv-import,org-unit-crud,tenant-isolation,ui-smoke-phase2}.spec.ts` | ❌ Plan 03-01 (overwrite existing files) |
| SHFT-01..04 | Shift slot CRUD | Playwright UI | `tests/e2e/shift-slot-crud.spec.ts` | ❌ Plan 03-02 |
| SHFT-02 (template) | Template wizard | Playwright UI | same | ❌ Plan 03-02 |
| SHFT-05,06,07 | OpenPlanningWindow + cross-product | Playwright UI + direct PG | `tests/e2e/planning-window-open.spec.ts` | ❌ Plan 03-03 |
| AVAL-02..07 | DeclareAvailability all modes + lock + audit | Playwright UI + direct PG | `tests/e2e/availability-declare.spec.ts` | ❌ Plan 03-05 |
| AVAL-04 | Source precedence (read query) | Direct PG | `tests/integration/availability-source-precedence.spec.ts` | ❌ Plan 03-05 |
| RULE-01..03 | Team rule CRUD + seed | Playwright UI + direct PG | `tests/e2e/team-rules.spec.ts` | ❌ Plan 03-06 |
| RULE-04,05 | Override tightening guard | Unit + Playwright | `tests/unit/rule-override-tightening.spec.ts` + `tests/e2e/rule-override.spec.ts` | ❌ Plan 03-06 |

### Sampling Rate
- **Per task commit:** `pnpm exec playwright test tests/e2e/<plan>.spec.ts` (<60s)
- **Per plan merge:** all Phase 03 specs (~5 min total)
- **Phase gate:** full Playwright suite + unit suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tools/check-handler-registration.mjs` — structural verifier (Plan 03-01 deliverable)
- [ ] `tests/unit/rule-override-tightening.spec.ts` — pure JS unit test
- [ ] `tests/integration/availability-source-precedence.spec.ts` — direct-PG integration
- [ ] Extension to `seed-tenants.ts`: `seedFullWindow(tenantId, teamId)` helper
- [ ] `ShiftySessionCallback` extension: add `soldier_id` to `session.user` (one-line)
- [ ] 0014 migration applied on hpg5 (golang-migrate via `migrate` compose service)
- [ ] `tools/check-queries.mjs` extension: scan plugin JS for `.update(` / `.delete(` missing `tenant_id` predicate

## Security Domain

> `security_enforcement` is the project default (Goal G5: zero cross-tenant data leaks); section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherits Phase 01 Auth.js magic link) | Existing — no Phase 03 changes |
| V3 Session Management | yes (HTTP-only secure cookies + `__Secure-` prefix) | Existing — no Phase 03 changes |
| V4 Access Control | yes — Layer 4 RBAC in every new handler | Pattern: derive roles from `request.user.roles`; check `is_admin || is_manager_of(team_id)` |
| V5 Input Validation | yes | Pattern: `.schema = { type: 'object', required: [...] }` per handler; Lowdefy enforces |
| V6 Cryptography | n/a — Phase 03 has no new crypto | — |
| V8 Data Protection | yes — tenant isolation (4-layer + RLS Layer 5) | Pattern: every handler uses `withTenantTx(connection, request.user.tenant_id, ...)` |
| V11 Business Logic | yes — tightening guard, lock guard | Pattern: server-side semantic validation BEFORE INSERT/UPDATE |
| V13 API and Web Service | yes — `tenant_id` NEVER from request body | Pattern: enforced in every handler; CI grep gate scans for violations |

### Known Threat Patterns for Lowdefy 5.3 + Postgres 16

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged `tenant_id` in request body | Tampering | `request.user.tenant_id` from session only; reject `request.properties.tenant_id` |
| Forged `soldier_id` in DeclareAvailability (soldier writing as another soldier) | Spoofing | `soldier_id` derived from `(session.user_id → soldier.user_id)` lookup, NEVER from request body, unless `mode=manager_override` |
| Manager writing availability for soldier in another team | Elevation of Privilege | Layer-4 scope check in DeclareAvailability: membership-with-team_manager-role must exist for target soldier's team |
| Soldier loosening own rule via API even though UI hides it | Tampering | `UpsertRuleOverride` requires `unit_admin` or `team_manager` role; soldier role rejects at the role check |
| Tenant-A admin opens planning window for tenant-B team | Tampering | `OpenPlanningWindow` SELECT FOR UPDATE on `org_unit` filters by `tenant_id` — cross-tenant team_id returns zero rows |
| Direct-pg INSERT to `availability` bypassing handlers (SQL injection via KnexRawTenant) | Tampering | KnexRawTenant uses parameterized `:tenant_id` bindings — never string concatenation. Plus RLS Layer 5 blocks cross-tenant writes |
| Replay of `OpenPlanningWindow` to create N parallel windows for same team | DoS | UI prevents (only state=open is editable; admin sees existing window) but handler is idempotent in the sense that two windows for same (team, dates) are allowed — design decision, not a bug |
| Schema drift between SeedTeamRules JS constant and Phase 04 solver expectations | Information Disclosure / Tampering | Frozen `rule_key` list in DB CHECK + JS DEFAULTS constant + Phase 04 solver enum must all agree. CI test asserts the three sets are identical. |

## Sources

### Primary (HIGH confidence)
- `app/plugins/shifty-plugin/src/connections/Knex/requests/CreateSoldier.js` — canonical handler shape `[VERIFIED: in-repo]`
- `app/plugins/shifty-plugin/src/connections/Knex/requests/CommitRosterImport.js` — two-stage transactional pattern `[VERIFIED: in-repo]`
- `app/plugins/shifty-plugin/src/connections/Knex/requests/KnexRawTenant.js` — RLS-aware read pattern `[VERIFIED: in-repo]`
- `app/plugins/shifty-plugin/src/hooks/with-tenant-tx.js` — Layer 5 SET LOCAL wrapper `[VERIFIED: in-repo]`
- `app/plugins/shifty-plugin/src/connections/Knex/Knex.js` — merged connection + request map `[VERIFIED: in-repo]`
- `app/plugins/shifty-plugin/src/types.js` — types registry `[VERIFIED: in-repo]`
- `db/migrations/0003_shifts_and_windows.up.sql` — shift_slot, planning_window, shift_instance schema `[VERIFIED: in-repo]`
- `db/migrations/0004_availability_rules_swaps.up.sql` — availability, rule, rule_override schema `[VERIFIED: in-repo]`
- `db/migrations/0006_audit_and_solver_runs.up.sql` — schedule_audit schema `[VERIFIED: in-repo]`
- `db/migrations/0009_rls_policies.up.sql` — RLS Layer 5 policies for Phase 03 tables `[VERIFIED: in-repo]`
- `db/migrations/0013_layer5_rls_app_role.up.sql` — shifty_app role + SET ROLE auto-bypass `[VERIFIED: in-repo]`
- `tests/e2e/cross-tenant-leak.spec.ts` — auto-discovery + page-leak proof pattern `[VERIFIED: in-repo]`
- `tests/e2e/ui-smoke-phase2.spec.ts` — direct-API spec template (the pattern Phase 03 REPLACES with UI flows) `[VERIFIED: in-repo]`
- `tests/e2e/_fixtures/seed-tenants.ts` — multi-tenant seed via `SET ROLE NONE` `[VERIFIED: in-repo]`
- `tests/e2e/_fixtures/teardown.ts` — TRUNCATE reverse-FK pattern `[VERIFIED: in-repo]`
- `.planning/phases/02-org-people/02-UAT-FINDINGS.md` — load-bearing root cause of plugin-registration + payload-binding `[VERIFIED: in-repo]`
- `.planning/phases/02-org-people/02-11-SUMMARY.md` — 02-11 hotfix outcome + P02-HF-05 explicit deferral `[VERIFIED: in-repo]`
- `.planning/phases/02-org-people/02-PATTERNS.md` — full Phase 02 file → analog mapping (Phase 03 inherits) `[VERIFIED: in-repo]`
- `.planning/phases/03-availability-rules/03-CONTEXT.md` — all 4 decision areas locked `[VERIFIED: in-repo]`
- `.planning/phases/03-availability-rules/03-UI-SPEC.md` — 11 surface wireframes + Hebrew copy `[VERIFIED: in-repo]`
- `docs/PRD.md` §7.4 / §7.5 / §7.6 — shift slot templates, hybrid availability, 8-rule catalog `[VERIFIED: in-repo]`
- `CLAUDE.md` — hpg5 deployment, PsExec, plink invocation, git pull deploy workflow `[VERIFIED: in-repo]`

### Secondary (MEDIUM confidence — inferred from upstream behavior, not verified at this research time)
- `[CITED: AG Grid 32.x community vs Enterprise feature matrix]` — master-detail is Enterprise. `[ASSUMED]` until verified with `docker exec` package.json inspection at implementation time (A1 in Assumptions Log).
- `[CITED: Postgres LATERAL JOIN with generate_series]` — the per-row CROSS JOIN LATERAL idiom. Documented in Postgres manual; sister to similar use in `tools/migrate-from-sheet/` (future Phase M).
- `[CITED: Ant Design 5 Row/Col responsive grid]` — `xs/sm/md/lg/xl/xxl` props are documented; verified-by-similar-use in Phase 02's roster_import.yaml.
- `[CITED: WCAG 2.5.5 Target Size minimum 24×24 CSS pixels; Apple HIG 44×44; Android Material 48×48]` — Phase 03 adopts 48 floor for mobile.

### Tertiary (Phase 02 inheritance — VERIFIED via Phase 02 RESEARCH stack section)
- `[VERIFIED: Phase 02 RESEARCH `## Recommended Stack` section]` — Lowdefy 5.3 / Postgres 16 / shifty-plugin / Auth.js stack pins (all carry over to Phase 03 unchanged).

## Metadata

**Confidence breakdown:**
- Stack pins: HIGH — Phase 02 baseline, no new packages
- Implementation recipes: HIGH — every recipe has a verbatim in-repo analog
- Migration 0014 design: HIGH — simple ADD COLUMN; no complex migration
- Mobile-first RTL patterns: MEDIUM — depends on A1 (AG Grid Enterprise) and A2 (`_repeat` operator behavior); both fall back to documented alternatives if wrong
- Test strategy: HIGH — Pattern A template is straightforward; Phase 02's ui-smoke-phase2 already proves the cookie/session path works
- Common pitfalls: HIGH — all 7 pitfalls derived from concrete Phase 02 UAT findings or schema inspection
- Risks + mitigations: HIGH — all 5 risks have explicit mitigations with effort estimates

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for stable; Lowdefy 5.3 unlikely to ship breaking changes inside this window; no dependency upgrades planned for Phase 03)
