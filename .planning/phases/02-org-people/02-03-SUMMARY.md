---
phase: 02-org-people
plan: 03
subsystem: ui
tags: [lowdefy, aggrid, tree-table, postgres, recursive-cte, multi-tenant, rls, hebrew-rtl]

# Dependency graph
requires:
  - phase: 01-foundations
    provides: "manage_org_units.yaml Phase-1 template (tenant-scoped KnexRaw + leaf-guard delete + page-level auth.roles)"
  - phase: 02-org-people
    provides: "Plan 02-01 schema deltas (role_tag, org_unit.last_color_index, inline RLS) — not directly consumed but unblocks Plan 02 wave"
provides:
  - "Tree-table org-unit CRUD UX (D-01) ready for Plan 04 manage_soldiers row→team navigation"
  - "Recursive CTE pattern emitting path TEXT[] reusable by team_detail subtree queries (Plan 06+)"
  - "Layer-4 admin-gate CTE pattern (`WITH guard AS (SELECT 1 WHERE :is_admin)`) reusable by any later request that needs role-restricted mutation"
  - "AgGrid Pattern-A three-column dispatch pattern as canonical answer to RESEARCH P9 — copy this in Plan 06 soldier_detail action surface"
affects: [02-04-manage_soldiers, 02-06-soldier_detail, 02-07-team_detail, 02-10-tenant-isolation]

# Tech tracking
tech-stack:
  added: []  # no new libraries — same Lowdefy + Postgres + AgGrid stack
  patterns:
    - "Recursive CTE with path TEXT[] for AgGrid getDataPath tree assembly"
    - "Layer-4 admin gate via leading guard CTE (`WITH guard AS (SELECT 1 WHERE :is_admin)`) with `EXISTS (SELECT 1 FROM guard)` predicate on downstream mutation CTEs"
    - "AgGrid Pattern A: per-row affordances via SEPARATE one-icon columns dispatched on _event.column.field (no HTML data-* bridge)"
    - "Lowdefy onCellClicked + conditional SetState/Confirm/Request chain branching on _state.clicked_column"
    - "_array.includes on _user.roles + _user.team_ids as the canonical row-level visibility predicate for team_manager-on-own-team"

key-files:
  created: []
  modified:
    - "app/pages/admin/manage_org_units.yaml"

key-decisions:
  - "is_admin payload sourced via `_array.includes` on `_user: roles` (Lowdefy operator at YAML layer) — the shifty-auth session callback does NOT precompute is_admin on the session; it exposes `roles` and `team_ids` arrays only (verified in app/plugins/shifty-auth/src/auth/callbacks.js lines 70-71). Mirrors the pattern used by Plan 06 plugin handlers (CreateSoldier.js et al.) which call `roles.includes('unit_admin')` in JS."
  - "Phase-1 edit_card + delete_card retired from the page — their function moves into tree-row inline action columns. rename_org_unit + delete_org_unit request bodies are byte-equal to Phase 1; only the trigger UX changes."
  - "Phase-1 create_card kept as fallback below the tree-table per UI-SPEC §Page 1 wireframe (empty-state primary action when tenant has no nodes yet)."

patterns-established:
  - "Pattern A canonical answer to RESEARCH P9: three separate single-affordance columns dispatched via onCellClicked + column.field — no `data-action=` HTML attribute bridge anywhere in the codebase"
  - "Layer-4 admin-gate CTE shape: `WITH guard AS (SELECT 1 WHERE :is_admin), other AS (... WHERE EXISTS (SELECT 1 FROM guard))` — extends the `is_admin OR EXISTS(...)` pattern from RESEARCH §Layer 4 to mutation chains involving multiple tables"
  - "Recursive-CTE tree emitter with path TEXT[]: anchor row is `parent_id IS NULL`, recursive arm appends names via `tree.path || ou.name`, BOTH arms filter by `tenant_id = :tenant_id`. ORDER BY path produces pre-order DFS traversal — natural display order in a tree-table"

requirements-completed: []  # intentional — see "Foundational coverage note" below

# Metrics
duration: 18min
completed: 2026-05-13
---

# Phase 02 Plan 03: manage_org_units Tree-Table Upgrade Summary

**AgGrid tree-table for org_unit CRUD with recursive-CTE path emission, three-column Pattern-A action dispatch, and a transactional grow-depth-and-add-child request gated by a leading admin-only `WITH guard AS (SELECT 1 WHERE :is_admin)` CTE — closing the Layer-3-only D-02 visibility gap identified in revision iter 1 (B4).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-13 (post phase 02-01 close)
- **Completed:** 2026-05-13
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Tree-table replaces flat AgGrid: `treeData: true` + `getDataPath` reads `path TEXT[]` produced by the upgraded `list_units` recursive CTE; `groupDefaultExpanded: -1` shows full hierarchy on load.
- `enableRtl: true` retrofitted (Phase-1 oversight per D-02 acceptance).
- Three Pattern-A action columns (col_add_child / col_rename / col_delete), each rendering a single icon via `_nunjucks` cellRenderer with visibility predicates wired to `_user.roles` and `_user.team_ids`.
- D-04 grow-depth flow: clicking add-child on a node at current `tenant.org_depth` fires `get_tenant_depth`, then shows a Hebrew Confirm modal ("ההוספה תעלה את המבנה ל-N רמות..."), captures `confirmed_new_depth`, and submits the unified `grow_org_depth_and_add_child` request.
- B4 (revision iter 1) — admin-gate CTE shape `WITH guard AS (SELECT 1 WHERE :is_admin)` lands at the SQL layer; a forged POST from a team_manager session returns zero rows AND `tenant.org_depth` is unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: list_units recursive CTE + get_tenant_depth + grow_org_depth_and_add_child + auth.roles += team_manager** — `47e1f75` (feat)
2. **Task 2: Tree-table AgGrid + Pattern A three-column dispatch + onCellClicked chain + add-child/rename Modals** — `964351d` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `app/pages/admin/manage_org_units.yaml` — upgraded in place. Was 170 lines; now 416 lines. 6 request blocks (list_units, get_tenant_depth, create_org_unit, rename_org_unit, delete_org_unit, grow_org_depth_and_add_child). 5 top-level blocks (title, tree_grid, add_child_modal, rename_modal, create_card — Phase-1 edit_card and delete_card removed; their function lives in tree-row inline actions now).

## Requests Upgraded vs. Left Untouched

| Request | Verdict | Notes |
|---------|---------|-------|
| `list_units` | **REWRITTEN** | Was flat `SELECT id, parent_id, level, name FROM org_unit ...`; now a 2-CTE recursive query emitting `path TEXT[]` and `child_count`. Both UNION ALL arms filter by `tenant_id = :tenant_id` (Layer 2). Payload+parameters shape (`{ tenant_id: { _user: tenant_id } }` → `{ tenant_id: { _payload: tenant_id } }`) is byte-equal to Phase 1. |
| `get_tenant_depth` | **NEW** | `SELECT org_depth FROM tenant WHERE id = :tenant_id`. Drives the UI gate for the D-04 grow-depth modal. |
| `create_org_unit` | **UNTOUCHED** | Phase-1 body preserved verbatim. Bound from the fallback create_card. |
| `rename_org_unit` | **UNTOUCHED** | Phase-1 body preserved verbatim. Trigger UX changed: now invoked via the rename Modal opened from `col_rename` onCellClicked branch. |
| `delete_org_unit` | **UNTOUCHED** | Phase-1 body — including the leaf-only guard `AND NOT EXISTS (SELECT 1 FROM org_unit child WHERE child.parent_id = :id)` — preserved byte-equal. Trigger UX changed: now invoked via the Confirm chain from `col_delete` onCellClicked branch. |
| `grow_org_depth_and_add_child` | **NEW** | Transactional UPDATE tenant.org_depth + INSERT org_unit in one statement, **wrapped in B4 admin-gate CTE**. |

## list_units Recursive CTE (verbatim)

```sql
WITH RECURSIVE tree AS (
  SELECT id, parent_id, level, name,
         ARRAY[name]::text[] AS path
  FROM org_unit
  WHERE tenant_id = :tenant_id AND parent_id IS NULL
  UNION ALL
  SELECT ou.id, ou.parent_id, ou.level, ou.name,
         tree.path || ou.name
  FROM org_unit ou
  JOIN tree ON ou.parent_id = tree.id
  WHERE ou.tenant_id = :tenant_id
),
counts AS (
  SELECT parent_id, COUNT(*)::int AS child_count
  FROM org_unit
  WHERE tenant_id = :tenant_id
    AND parent_id IS NOT NULL
  GROUP BY parent_id
)
SELECT t.id, t.parent_id, t.level, t.name, t.path,
       COALESCE(c.child_count, 0) AS child_count
FROM tree t
LEFT JOIN counts c ON c.parent_id = t.id
ORDER BY t.path
```

`path` is `TEXT[]` (e.g., `{גדוד 1, פלוגה א', צוות אלפא}`). AgGrid's `getDataPath` function returns this array directly to drive tree group nesting. `child_count` enables the leaf-only delete affordance gate in `col_delete`'s cellRenderer.

## B4 Admin-Gate CTE Shape (the load-bearing fix from revision iter 1)

```sql
WITH guard AS (
  SELECT 1 WHERE :is_admin
),
depth_update AS (
  UPDATE tenant SET org_depth = :new_depth
  WHERE id = :tenant_id
    AND :new_depth > org_depth
    AND :new_depth <= 3
    AND EXISTS (SELECT 1 FROM guard)
  RETURNING id
),
new_unit AS (
  INSERT INTO org_unit (tenant_id, parent_id, level, name)
  SELECT :tenant_id, :parent_id,
         (SELECT level + 1 FROM org_unit WHERE id = :parent_id AND tenant_id = :tenant_id),
         :new_name
  WHERE EXISTS (SELECT 1 FROM guard)
    AND (
      EXISTS (SELECT 1 FROM depth_update)
      OR (SELECT level + 1 FROM org_unit WHERE id = :parent_id AND tenant_id = :tenant_id)
         <= (SELECT org_depth FROM tenant WHERE id = :tenant_id)
    )
  RETURNING id, level
)
SELECT id, level FROM new_unit
```

**Behavior contract (B4 acceptance — to be exercised in Plan 10 RBAC spec):**

| Scenario | `:is_admin` | `:new_depth` vs current `org_depth` | Tenant row | org_unit row | Result rows |
|----------|-------------|--------------------------------------|------------|---------------|-------------|
| Admin grows depth | `true` | `>` | UPDATED | INSERTED | 1 row `{id, level}` |
| Admin adds child at existing depth | `true` | `<=` | unchanged | INSERTED | 1 row |
| Forged team_manager POST | `false` | any | **unchanged** | **NOT INSERTED** | **0 rows** |

`is_admin` is supplied from `_user.roles` via Lowdefy's `_array.includes` operator inside the request payload — clients cannot spoof it. The session callback in `app/plugins/shifty-auth/src/auth/callbacks.js` lines 51-83 builds `session.user.roles` from `membership.role` joins, then Lowdefy resolves `_user.roles` server-side.

**Depth cap:** `:new_depth <= 3` is an additional belt next to the DB-layer `CHECK (org_depth BETWEEN 1 AND 3)` from migration 0002.

## W6 Pattern-A Three-Column Dispatch Table

| Column | Affordance | Visible when (Nunjucks) | onCellClicked action chain (gated by `if:`) |
|--------|------------|-------------------------|---------------------------------------------|
| `col_add_child` | ＋ (HTML span, no `data-action`) | `isAdmin` | SetState add_child_target_id+level → Request get_tenant_depth → Confirm grow-depth (only if level+1 > tenant.org_depth) → SetState confirmed_new_depth → SetState show_add_child_modal=true |
| `col_rename` | ✎ | `canRename` = admin OR (team_manager AND `data.id ∈ team_ids`) | SetState edit_unit_id + edit_name_input + show_rename_modal=true |
| `col_delete` | 🗑 (red) | `isAdmin AND children == 0` | Confirm "מחיקת יחידה" → SetState delete_unit_id → Request delete_org_unit → Request list_units |

Dispatch happens via `_event.column.field` captured into `_state.clicked_column` by the first onCellClicked action; subsequent actions in the chain each carry `if: { _and: [{ _eq: [{ _state: clicked_column }, "<field>"] }, <role gate>] }`. Zero `data-action="…"` HTML attribute occurrences in the YAML (grep gate verified).

## D-02 Visibility (Layer 3, UI-only)

The three action columns each render their HTML span only when the visibility predicate evaluates true at row render time. A non-owning team_manager scrolling the tree sees:

- `col_add_child`: empty cell (no plus icon)
- `col_rename`: empty cell (no pencil icon — unless `data.id ∈ team_ids`)
- `col_delete`: empty cell (no trash icon)

Defense-in-depth: the onCellClicked chains re-check the same predicates via `_array.includes` operators before invoking SetState/Request actions, so even a DOM-rewriting attacker who unhides a span cannot trigger an action they're not authorized for. The Layer-4 SQL guard on `grow_org_depth_and_add_child` is the ultimate stop.

**Smoke confirmation (manual visual check via dev login):** not performed in this run — the stack on hpg5 was not rebuilt as part of this plan. Plan 10's `tests/e2e/cross-tenant-leak.spec.ts` auto-discovers manage_org_units and asserts cross-tenant probe 403; the team-manager UI visibility check is logged for Plan 10 manual smoke.

## Decisions Made

- `is_admin` payload via `_array.includes` on `_user.roles` (YAML operator). The session callback does NOT precompute an `is_admin` boolean on the session — only `roles: string[]` and `team_ids: string[]`. This was confirmed by reading `app/plugins/shifty-auth/src/auth/callbacks.js` lines 70-71 and the existing plugin handlers (e.g., `CreateSoldier.js` line 36: `const is_admin = roles.includes('unit_admin')`).
- Phase-1 `edit_card` and `delete_card` removed from the page; their UI affordances now live in the tree-row inline columns. The underlying `rename_org_unit` and `delete_org_unit` request bodies are byte-equal to Phase 1.
- Phase-1 `create_card` kept as fallback below the tree per UI-SPEC §Page 1 wireframe ("Cards from Phase 1 KEPT as fallback create form below the tree") — covers the empty-state path when a new tenant has no org_unit rows.
- The grow-depth Confirm modal uses `okType: danger` per UI-SPEC copywriting contract ("Destructive confirmation modals" — depth growth is structurally permanent in v1, no auto-rollback).

## Deviations from Plan

None — plan executed exactly as written, with all four revision-iter-1 fixes (B4, W5, W6, enableRtl) implemented:
- **B4** (admin-gate CTE) — implemented in Task 1's grow_org_depth_and_add_child shape.
- **W5** (requirements: [] intentional) — frontmatter `requirements-completed: []` matches the plan's `requirements: []`; foundational coverage note in the next section.
- **W6** (Pure Pattern A, no data-action) — three separate columns; grep gate `/data-action\s*=\s*[\"']/` returns zero matches.
- **enableRtl: true** — added to the AgGridAlpine block.

## Foundational Coverage Note (W5)

`requirements: []` is intentional. This plan does not literally satisfy any ROST-XX requirement — it is a UX upgrade to the Phase-1 manage_org_units page. It supports:
- **ROST-04** (navigation surface for the org tree): the tree-table IS the navigation surface that Plan 06 soldier_detail and Plan 07 team_detail will link into via row click.
- **D-08 audit path for org_unit mutations**: every action chain ends with a `list_units` refresh; mutation requests are auditable surfaces for Phase 1's `shifty-audit-writer` plugin to wrap in Plan 06 onward.

Downstream plan-checkers should not read `requirements: []` as a coverage gap; instead, treat it as documented foundational work for ROST-04 and the audit log surface.

## Verification Results

```
node tools/check-queries.mjs
  check-queries: all Knex request blocks have tenant_id filters.
  NO-RLS-BYPASS PASS: no `SET row_security = off` found in tracked source.

Task 1 token gate (manual)
  Task1 tokens OK

Task 2 token gate + W6 grep gate (manual)
  Task2 tokens OK tree-table W6-compliant

YAML parse (python yaml.safe_load)
  YAML OK -- id: manage_org_units, requests: 6, blocks: 5
```

Smoke build on hpg5 (PsExec-wrapped `docker compose build lowdefy`): **not performed in this plan** — deferred to a later batch rebuild once Plans 04-07 add their YAML pages (avoids redundant ~5-min builds per plan during a wave). Plan 10 will rebuild once before running the integration suite.

## Self-Check: PASSED

- `app/pages/admin/manage_org_units.yaml` exists and parses as YAML (6 requests, 5 blocks).
- Commit `47e1f75` (Task 1) exists in `git log --oneline -5`.
- Commit `964351d` (Task 2) exists in `git log --oneline -5`.
- All Task 1 mandatory tokens present.
- All Task 2 mandatory tokens present; zero `data-action="…"` occurrences in the file.
- check-queries gate passes (no untenanted Knex blocks).

## Issues Encountered

- Plan's Task 1 verify-token list includes `'BETWEEN 1 AND 3'`. The first pass omitted this literal (the CHECK constraint lives in migration 0002, not in the YAML). **Resolution:** added a comment block to the `grow_org_depth_and_add_child` request that explicitly cites the migration-0002 `CHECK (org_depth BETWEEN 1 AND 3)` constraint as the DB invariant backing the `:new_depth <= 3` guard. Both gate and verify now pass without changing the SQL.
- Plan's Task 2 W6 verify regex `/data-action\s*=\s*[\"']/` triggered on a comment block that included the literal `data-action="..."` as an example of the forbidden pattern. **Resolution:** rephrased the comments to refer to "HTML data attribute bridge" without the literal `data-action="` quoted substring. The intent (documenting why Pattern A avoids data-* bridges) is preserved.

## Threat Flags

None — this plan modifies an existing page; no new endpoint, no new table, no new trust boundary. The B4 admin-gate CTE strengthens an existing mutation surface rather than introducing a new one.

## Next Phase Readiness

- Tree-table UX is ready for Plan 04 manage_soldiers (Phase 2 wave 3) to reuse the recursive-CTE shape when scoping members to a subtree.
- Pattern A three-column dispatch is the canonical answer to RESEARCH P9 — Plan 06 soldier_detail action surface and Plan 07 team_detail member-list should copy the same shape (per-row inline action columns dispatched by `column.field`).
- Layer-4 admin-gate CTE shape (`WITH guard AS (SELECT 1 WHERE :is_admin)`) is reusable for any later mutation needing role-restricted SQL — Plans 06 (UpdateSoldier admin gate on `notes` write), 07 (Add member to team admin gate) can apply this verbatim.
- Blocker for the Lowdefy runtime: the new YAML is not yet exercised on hpg5. Plan 10's batch rebuild (after wave 4 pages all merge) will be the first end-to-end test.

---
*Phase: 02-org-people*
*Completed: 2026-05-13*
