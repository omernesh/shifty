---
phase: 02-org-people
plan: 04
subsystem: ui
tags: [lowdefy, aggrid, hebrew-rtl, multi-tenant, plugin-request, soldier-crud]

# Dependency graph
requires:
  - phase: 02-org-people
    provides: "Plan 02-01 role_tag table + 0011 RLS policy (list_role_tags reads from it)"
  - phase: 02-org-people
    provides: "Plan 02-02 shifty-roster plugin scaffold + CreateSoldier stub handler (create_soldier_request wiring)"
  - phase: 01-foundations
    provides: "manage_invites.yaml + manage_org_units.yaml Phase-1 templates (header + KnexRaw + Card+Form + AgGrid shape)"
provides:
  - "Tenant-wide soldier roster page (manage_soldiers) — admin + team_manager visible per D-05"
  - "AgGrid color-dot cellRenderer + onRowClicked Link pattern reusable by Plan 02-07 team_detail members grid"
  - "AgGrid quickFilterText + TextInput.onChange→SetState pattern reusable by every Phase-2 list page"
  - "Modal-with-Form action chain (Validate → Request → refresh → close → reset → toast) reusable by Plan 02-07 add-member modal"
  - "Empty-state Result block + dual primary/default Button actions pattern for first-run tenants"
affects: [02-06-soldier_detail, 02-07-team_detail, 02-08-roster_import, 02-09-lowdefy-yaml-wiring, 02-10-tenant-isolation]

# Tech tracking
tech-stack:
  added: []  # no new libraries — same Lowdefy 5.3 + Postgres + AgGrid 32.3.9 stack
  patterns:
    - "Plugin-typed request block (type: CreateSoldier from shifty-roster) wired alongside KnexRaw reads on the same page"
    - "AgGrid color-dot cellRenderer via `_function` + `_nunjucks` template (UI-SPEC §Reusable 9, copied byte-equal)"
    - "AgGrid onRowClicked → Link action with urlQuery binding `_event.data.id` (Lowdefy 5.3 event-arg shape per skill ref 05)"
    - "Action chain Validate → Request → Request (refresh) → SetState → Reset → Message in a single Modal.onOk handler"
    - "`enableRtl: true` mandatory toggle on every Phase-2 AgGrid (UI-SPEC §Reusable 8)"
    - "Empty-state Result block visibility gated by `_eq: [{ _request: <list>.length }, 0]`"

key-files:
  created:
    - "app/pages/admin/manage_soldiers.yaml"
  modified: []

key-decisions:
  - "Page binds CreateSoldier request via `_state: new_soldier_form.<field>` so the field block ids and the form id are coupled by string-prefix convention — same as manage_invites.yaml's `_state: org_unit_select` flat-binding pattern (not a nested Form object). This is the Lowdefy 5.3 idiom; the Validate action targets the form-wrapper id (`new_soldier_form`) which iterates child block validators."
  - "search TextInput drives AgGrid `quickFilterText` (AgGrid native filter, no server roundtrip) per UI-SPEC Page 2 toolbar. Server-side search lands in v1.1 when roster size justifies it."
  - "CSV-import button uses Link to `roster_import` — that page lands in plan 02-08; meanwhile a Lowdefy 404 renders gracefully (acceptable per plan scope_constraints). Same dead-route treatment for `soldier_detail` row-click destination, which lands in plan 02-06."
  - "Modal.onOk does NOT include an explicit Audit-write Request — the audit row is written inside the CreateSoldier plugin handler (plan 02-06's body-fill task) in the same DB transaction as the soldier INSERT, eliminating a partial-failure window where the soldier exists but no audit row was written. Confirmed against shifty-audit-writer pattern (AuditWrite.js can also be called from JS, not only from YAML)."

patterns-established:
  - "Reusable AgGrid color-dot cellRenderer YAML fragment (lines 167-179 of manage_soldiers.yaml) — copy to plan 02-07 team_detail members grid verbatim."
  - "Reusable role-tag autocomplete query (list_role_tags) — Plan 02-06 soldier_detail TagSelector reads from same query shape."
  - "Reusable leaf-team Selector query (list_leaf_teams with NOT EXISTS sub-select) — Plan 02-06 + 02-07 multi-team membership picker reads from same query."

metrics:
  duration_minutes: 8
  completed_date: 2026-05-13
  tasks_completed: 1
  files_changed: 1
  commits:
    - hash: a248230
      message: "feat(02-04): add manage_soldiers page (READ + single-row CREATE)"
---

# Phase 2 Plan 04: manage_soldiers (READ + single-row CREATE) Summary

Tenant-wide soldier roster page wired to the shifty-roster plugin's CreateSoldier
handler — Lowdefy YAML using the canonical PageHeaderMenu + multi-KnexRaw + Form-Modal
+ AgGrid shape from Phase 1.

## What shipped

One new file: `app/pages/admin/manage_soldiers.yaml` (396 lines).

### Four requests

| id                       | type            | role                                                              |
| ------------------------ | --------------- | ----------------------------------------------------------------- |
| `list_soldiers`          | `KnexRaw`       | SELECT active soldiers in tenant + LEFT JOIN app_user for email   |
| `list_role_tags`         | `KnexRaw`       | SELECT key/label catalog feeding TagSelector autocomplete (D-13)  |
| `list_leaf_teams`        | `KnexRaw`       | SELECT org_unit leaf rows (NOT EXISTS sub-select) for team Selector (TEN-05) |
| `create_soldier_request` | `CreateSoldier` | Custom plugin request (shifty-roster); plan 02-06 fills SQL body  |

All three KnexRaw blocks set `payload.tenant_id: { _user: tenant_id }` and SQL
filters `WHERE … tenant_id = :tenant_id`. Layer 1 (session) + Layer 2 (query) +
Layer 5 (RLS on `soldier` from 0009) defend; Layer 4 lives inside the
CreateSoldier handler (plan 02-02 stub reads `request.user.tenant_id`, never
`request.properties.tenant_id`).

### AgGrid column shape (UI-SPEC §Page 2)

| Column        | Width   | Renderer                                                              |
| ------------- | ------- | --------------------------------------------------------------------- |
| color         | 40px    | 12px filled circle, hex from `soldier.color`, 1px white + 1px #D9D9D9 ring (UI-SPEC §Reusable 9 verbatim) |
| display_name  | flex 2  | text (default AgGrid renderer)                                        |
| email         | flex 2  | text                                                                  |
| seniority     | 80px    | numericColumn                                                         |
| role_tags     | flex 2  | `valueFormatter` joins array with `", "` via Nunjucks                 |
| status        | 100px   | maps `'active' → פעיל`, else `מארכב` via Nunjucks                      |

Grid-level: `enableRtl: true`, `pagination: true`, `paginationPageSize: 25`,
`rowSelection: single`, `quickFilterText: { _state: search_query }`, `defaultColDef`
has `sortable + resizable + filter + flex: 1`. `onRowClicked` → Link to
`soldier_detail` with `urlQuery.id = _event.data.id` (D-06).

### Add-soldier Modal action chain (onOk)

1. `Validate` — runs all child block validators on `new_soldier_form`
2. `Request: create_soldier_request` — POSTs to CreateSoldier plugin handler
3. `Request: list_soldiers` — refreshes the AgGrid
4. `Request: list_role_tags` — refreshes the TagSelector options (CreateSoldier
   may have created new role_tag rows for unknown tags — plan 02-06 wiring)
5. `SetState { show_add_modal: false }` — close
6. `Reset new_soldier_form` — clear inputs
7. `Message { type: success, content: 'החייל "{{ name }}" נוצר' }` — toast

`onCancel` simply closes the modal (no Reset — preserve user's draft if they
re-open).

### Form fields (six)

| Field          | Type           | Required | Validation / Source                               |
| -------------- | -------------- | -------- | ------------------------------------------------- |
| display_name   | TextInput      | yes      | `required: true`                                  |
| email          | TextInput      | no       | `validate: [{ type: email, … }]`                  |
| seniority      | NumberInput    | yes      | min 0, max 10, default 0 (mirrors DB CHECK)       |
| role_tags      | TagSelector    | no       | options from `list_role_tags` request             |
| phone_e164     | TextInput      | no       | (E.164 server-side validation in plan 02-06 body) |
| team_id        | Selector       | no       | options from `list_leaf_teams`, `allowClear: true` (admin can create unattached soldier per D-05) |

### Empty-state Result (UI-SPEC line 228)

Visible when `_eq: [{ _request: list_soldiers.length }, 0]`. `status: info`,
`icon: AiOutlineInbox`, title `אין חיילים בארגון`, subtitle
`הוסף חייל בודד או ייבא קובץ CSV`. Footer: same two primary/default buttons
as the toolbar (Add + Import CSV).

## Verification results

```
$ node -e "..." # inline verify-tokens script from PLAN
OK manage_soldiers

$ node tools/check-queries.mjs
check-queries: all Knex request blocks have tenant_id filters.
NO-RLS-BYPASS PASS: no `SET row_security = off` found in tracked source.
```

All 19 verify substrings present (incl. the W4 canonical `s.status = 'active'`
fragment as one contiguous token); no missing tenant_id filter on any KnexRaw
block in the repo.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` block was followed
end-to-end; the only minor presentation choice was binding the search input via
`onChange → SetState { search_query: { _state: search_input } }` rather than
`_event.value` (Lowdefy 5.3's TextInput SetState pattern reads the input value
via `_state.<input-id>`, not `_event.value` which is the event payload shape from
button-style components — verified against `manage_org_units.yaml` `name_input`
shape).

## Known Stubs

| File                                  | Stub                                          | Resolved by  |
| ------------------------------------- | --------------------------------------------- | ------------ |
| (plugin) `CreateSoldier.js` handler   | returns placeholder soldier_id; no INSERT     | Plan 02-06   |
| `pageId: roster_import` Link target   | destination page not yet created              | Plan 02-08   |
| `pageId: soldier_detail` Link target  | destination page not yet created              | Plan 02-06   |
| `app/lowdefy.yaml` `_ref: pages/admin/manage_soldiers.yaml` | page not in main config yet | Plan 02-09 |
| `app/lowdefy.yaml` auth.pages.roles entry for `manage_soldiers` | not yet in admin/team_manager allowlists | Plan 02-09 |

All stubs are intentional and tracked by downstream plans. Page is therefore not
end-to-end live until Plan 02-06 backfills CreateSoldier and Plan 02-09 wires
the page into `lowdefy.yaml`. Plan executor (this run) does NOT manually wire
`_ref` per scope_constraint guidance ("The page MUST be added … but that wiring
lands in plan 09 … For Wave-1 verification, the executor can manually add the
`_ref:` line temporarily; the canonical wiring is plan 09").

## Threat Flags

None. Page introduces no new trust boundary beyond what the plan's `<threat_model>`
already covered (T-02-01 spoofing, T-02-02 cross-tenant leak, T-02-05 XSS via
display_name — all mitigated as documented).

## Self-Check: PASSED

- File `app/pages/admin/manage_soldiers.yaml` exists.
- Commit `a248230` found in git log: `feat(02-04): add manage_soldiers page (READ + single-row CREATE)`.
- `node tools/check-queries.mjs` exits 0; both tenant_id gate and no-RLS-bypass gate green.
- Inline verify-tokens (19 substrings) found; W4 canonical `s.status = 'active'` token confirmed as single contiguous substring at line 38 of the YAML.
