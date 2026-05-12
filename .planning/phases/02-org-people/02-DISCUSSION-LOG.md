# Phase 2: Org & People - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 2-Org & People
**Areas discussed:** Org-tree UX & manager scope, Soldier CRUD entry points & flow, CSV import preview UX & invite dispatch, Color palette & adjacency rule

---

## Org-tree UX & manager scope

### Q1: UI shape for manage_org_units

| Option | Description | Selected |
|--------|-------------|----------|
| Tree-table | AgGrid tree-table, expand/collapse, "Add child here" per row, auto-derive level | ✓ |
| Keep flat-list, polish it | Stay with current shape; polish parent_id Selector to path-display, auto-derive level | |
| Two-panel: tree on left, detail on right | Left tree (read-only), right form for rename/delete/add-child | |

**User's choice:** Tree-table

### Q2: Where team-manager R+U-own-team lives

| Option | Description | Selected |
|--------|-------------|----------|
| Same page with role gating | Lowdefy conditional visibility on inline Rename button when row.id in _user.team_ids | ✓ |
| Separate manager-scoped page | New `manage_my_teams` page for team_managers | |
| Defer team-manager rename UI to a later phase | Phase 2 ships admin-only; wire team-manager rename in Phase 3+ | |

**User's choice:** Same page with role gating

### Q3: Team-create flow vs shift_slot templates

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 3 owns slots entirely | Phase 2 team-create writes only org_unit row | ✓ |
| Phase 2 seeds defaults; Phase 3 builds the UI | INSERT 2x12h defaults on team create; Phase 3 ships picker UI | |
| Phase 2 ships the template picker | Pull SHFT-01/02 forward | |

**User's choice:** Phase 3 owns slots entirely

### Q4: Grow org_depth post-creation

| Option | Description | Selected |
|--------|-------------|----------|
| Allow growing depth via add-child | Confirmation modal on first add-child past current depth; UPDATE tenant.org_depth + INSERT child | ✓ |
| Lock depth at signup, defer growth to v1.1 | Phase 2 enforces cannot exceed tenant.org_depth | |
| Always allow depth=3, hide unused levels | Weakens TEN-02 semantics | |

**User's choice:** Allow growing depth via add-child

---

## Soldier CRUD entry points & flow

### Q1: Single-row "add soldier" entry point

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level manage_soldiers page | Single tenant-wide AgGrid | |
| Team-detail page with embedded members | Per-team only | |
| Both: top-level + team-detail | manage_soldiers AND team_detail with embedded members | ✓ |

**User's choice:** Both: top-level + team-detail

### Q2: Soldier edit UX

| Option | Description | Selected |
|--------|-------------|----------|
| Row→detail edit page | Navigate to soldier_detail/{id}; single save = single audit row | ✓ |
| AgGrid inline-edit | Editable cells, auto-save | |
| Modal edit | Click row → modal opens with form | |

**User's choice:** Row→detail edit page

### Q3: Email requirement at create

| Option | Description | Selected |
|--------|-------------|----------|
| Email required at create | Single-row AND CSV require email | |
| Email optional, can be added later | Manager fills email later; triggers invite | |
| Email optional + 'invite later' button | Email optional; soldier_detail shows Invite button when email is filled and no app_user exists | ✓ |

**User's choice:** Email optional + 'invite later' button

### Q4: Multi-team membership UI

| Option | Description | Selected |
|--------|-------------|----------|
| Soldier-detail: 'Teams' section with multi-select | Primary write surface on soldier_detail; team_detail mirror | ✓ |
| Team-detail: 'Add member' picker only | Membership lives on team_detail; soldier_detail read-only | |
| Both write surfaces, single source of truth | Editable from both views, shared membership table | |

**User's choice:** Soldier-detail: 'Teams' section with multi-select (with team-detail mirror per CONTEXT)

---

## CSV import preview UX & invite dispatch

### Q1: Inline-edit richness on preview

| Option | Description | Selected |
|--------|-------------|----------|
| Edit any field; bulk 'fix common errors' actions | AgGrid editable cells + Lowercase/Trim/Assign-team toolbar | ✓ |
| Inline-edit only; no bulk actions | Lower YAML cost, manual fix per row | |
| Read-only preview; user fixes the CSV and re-uploads | Punishes the user for typos | |

**User's choice:** Edit any field; bulk 'fix common errors' actions

### Q2: Import → invite pipeline shape

| Option | Description | Selected |
|--------|-------------|----------|
| Sync with progress bar | INSERT in one tx + sync Resend dispatch with progress + NOTF-07 backoff on 429 | ✓ |
| Async via dispatcher queue, status polled later | Pulls Phase 6 dispatcher forward | |
| Two-step: row INSERT now, invite click separately | Decouples import and invite; deviates from ROST-12 | |

**User's choice:** Sync with progress bar

### Q3: Where role_tags live as 'created' state

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `role_tag` table per tenant | New table, RLS policy, autocomplete-from-table, inline-create button | ✓ |
| Derive autocomplete from existing soldier.role_tags via DISTINCT | No new table; loses CRUD entity | |
| Tags-in-soldier-array + 'manage tags' admin page | Hybrid: arrays only + atomic rename across soldiers | |

**User's choice:** Dedicated `role_tag` table per tenant

### Q4: Re-invite UX on preview

| Option | Description | Selected |
|--------|-------------|----------|
| Per-row toggle | Yellow ⚠ duplicate rows get re-invite checkbox column + bulk button at top | ✓ |
| Bulk-only toggle at preview top | Single checkbox affects all duplicates | |
| Two-stage: import first, manage duplicates in a separate flow | Decouples import from invite-management | |

**User's choice:** Per-row toggle

---

## Color palette & adjacency rule

### Q1: Where the 24-color palette lives

| Option | Description | Selected |
|--------|-------------|----------|
| Plugin module export | `app/plugins/shifty-roster/palette.js` exported alongside `pickNextColor` helper | ✓ |
| Postgres table seeded by migration | Editable palette table; overkill for 24-color frozen palette | |
| Lowdefy config constant | YAML constant; harder to unit-test adjacency | |

**User's choice:** Plugin module export

### Q2: Adjacency definition

| Option | Description | Selected |
|--------|-------------|----------|
| Index-position in palette array | Palette is ordered (max-perceptual-distance), adjacency = positions ±1 | ✓ |
| Perceptual HCL hue distance | Compute HCL hue difference against existing members; requires HCL conversion lib | |
| Hash(soldier_id) into palette + collision check | No adjacency, only identical-collision avoided | |

**User's choice:** Index-position in palette array

### Q3: Round-robin anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Last-used color in team + 2 | Track org_unit.last_color_index (new column); next = (last + 2) mod 24 | ✓ |
| First-unused color in palette | Scan 0→23 for first non-used + non-adjacent | |
| Hash(soldier_id) seeded, then collision-resolve | Spreads colors; less deterministic for manual UAT | |

**User's choice:** Last-used color in team + 2

### Q4: Color-override UI scope

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 2 ships minimal profile color override | Add `my_profile` page with swatch picker; ~20 YAML lines; reusable in Phase 7 | ✓ |
| Defer override UI to Phase 7 | Phase 2 assigns colors only; soldier waits ~5 phases | |
| Phase 2 ships override on soldier_detail (manager-driven) | Manager-only; less aligned with PRD wording | |

**User's choice:** Phase 2 ships minimal profile color override

---

## Claude's Discretion

- Exact palette hex values (Glasbey-style or curated — picked at planning time)
- Migration filename ordering: `0008_assignment_state_and_legacy_drop` + new `0011_role_tag` (or `0008b`)
- Migration `0008` timing within plan sequence (likely last plan; planner decides)
- AgGrid tree-table column shape and "Add child here" button render
- Exact Hebrew labels across pages
- Menu grouping for `manage_soldiers` / `manage_org_units` (flat vs submenu)

## Deferred Ideas

- Soldier self-service of profile fields beyond color (phone, locale, notifications) — Phase 6/7
- Schedule migration when growing org_depth — Phase 4+ when schedule data exists
- `role_tag` rename/delete cascade — v1.1
- CSV import history view (drill into past `roster_import_log` rows) — Phase 7 polish
- Bulk-archive soldiers / bulk-edit seniority — v1.1
- Soldier-without-app_user stale-roster report — v1.1 dashboard
- GitHub Actions CI — strongly considered for Phase 2 (trigger from Phase 1 D-10); planner decides
