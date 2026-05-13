---
phase: 02-org-people
plan: 05
subsystem: lowdefy-app
tags: [phase-02, role-tags, admin, read-only, rtl, multi-tenant]
status: complete
completed_at: 2026-05-13
dependency_graph:
  requires:
    - 02-01 (role_tag table + inline RLS policy from migration 0011)
  provides:
    - "admin-only read-only role_tag catalog viewer at /manage_role_tags"
  affects:
    - 02-09 (sidebar nav must add manage_role_tags_link entry)
tech_stack:
  added: []
  patterns:
    - "READ-ONLY page pattern — KnexRaw SELECT + AgGrid + info Alert (no mutation requests)"
    - "Empty-state Result block with AiOutlineInbox icon + Hebrew copy verbatim from UI-SPEC"
    - "DD/MM/YYYY HH:mm valueFormatter on TIMESTAMPTZ columns (I18N-04 he-locale)"
key_files:
  created:
    - app/pages/admin/manage_role_tags.yaml
  modified: []
decisions:
  - "Phase 2 ships role_tag UI as READ-ONLY only — edit/rename/delete cascade deferred to v1.1 per D-13"
  - "auth.roles = [unit_admin] only; team_manager intentionally excluded per RESEARCH Layer 3 table"
  - "New role tags will be born only via plan 02-06 single-row Add-soldier path or plan 02-08 CSV import 'צור' affordance — no direct create form on this page"
  - "ORDER BY key (not label) — slug-style keys give predictable alphabet ordering across mixed Hebrew/English labels"
metrics:
  duration_minutes: 7
  task_count: 1
  file_count: 1
requirements:
  - ROST-07
---

# Phase 02 Plan 05: Read-Only Role Tag Catalog Viewer Summary

Tenant-scoped read-only viewer for `role_tag` rows at `/manage_role_tags`, accessible to `unit_admin` only.

## Page Shape

`app/pages/admin/manage_role_tags.yaml` — one new file, no edits to existing YAML.

### Blocks (in render order)

1. **`title`** — `Title` h1: "תגיות תפקיד".
2. **`read_only_notice`** — `Alert type=info` with `showIcon: true`. Copy quoted byte-equal from UI-SPEC §"Page 8":
   - **message:** "עריכת תגיות תתווסף בשלב v1.1."
   - **description:** "בינתיים, ניתן ליצור תגיות חדשות בעת ייבוא CSV או הוספת חייל."
3. **`tags_grid`** — `AgGridAlpine` with `enableRtl: true`, `domLayout: autoHeight`, `defaultColDef` { sortable, resizable, filter, flex:1 }. Columns:
   - `key` → "מפתח (key)"
   - `label` → "תיוג בעברית"
   - `created_at` → "נוצר" with `DD/MM/YYYY HH:mm` valueFormatter (`_date.format` operator, I18N-04)
4. **`empty_state`** — `Result` (Ant Design `status: info`, `icon: AiOutlineInbox`) visible only when `_array.length` of `list_role_tags` equals 0. Copy verbatim from UI-SPEC §"Empty states": title "אין תגיות תפקיד", subTitle "תגיות נוצרות אוטומטית עם הוספת חיילים".

### Requests

- **`list_role_tags`** (KnexRaw, `connectionId: shifts_db`):
  ```sql
  SELECT id, key, label, created_at
  FROM role_tag
  WHERE tenant_id = :tenant_id
  ORDER BY key
  ```
  - `payload.tenant_id: { _user: tenant_id }` — Layer 1 (session-derived, never forgeable)
  - `parameters.tenant_id: { _payload: tenant_id }` — Layer 2 (SQL binding)

## Defense Layers (D-10a / PRD §8.3)

| Layer | Mechanism | Implementation in this page |
|-------|-----------|------------------------------|
| Layer 1 — session | `_user: tenant_id` in payload | `payload.tenant_id: { _user: tenant_id }` on `list_role_tags` |
| Layer 2 — query | `WHERE tenant_id = :tenant_id` | Hardcoded in the SELECT query |
| Layer 3 — page | `auth.roles` allowlist | `[unit_admin]` only — `team_manager` NOT listed |
| Layer 4 — plugin | n/a | No plugin-typed requests on this page (read-only SELECT) |
| Layer 5 — RLS | Postgres policy | `tenant_isolation` policy from migration 0011 (inline RLS) |

Auto-covered by `tests/e2e/cross-tenant-leak.spec.ts` — the test discovers any new admin page and runs the cross-tenant leak probe against it.

## Deferred Edit Affordances — Confirmation of READ-ONLY Constraint

Per D-13 in CONTEXT and the Plan 02-05 scope constraints, this page intentionally ships ZERO mutation affordances in Phase 2. Verified via grep:

```
$ grep -E "KnexInsertOne|KnexUpdateOne|KnexDeleteOne|AuditWrite|INSERT |UPDATE |DELETE " app/pages/admin/manage_role_tags.yaml
(no matches)
```

The deferred-edit info Alert (`read_only_notice` block) tells admins where new tags do come from:
- **Plan 02-08** — CSV import preview's "צור" button creates unknown tags in-flight
- **Plan 02-06** — single-row Add-soldier path's `CreateSoldier` plugin handler inserts unknown tags as a side-effect

Edit/rename/delete cascade (renaming a tag must propagate through every `soldier.role_tags[]` array safely) is a v1.1 feature — deferred from Phase 2 to avoid the cascading-rewrite complexity before the calendar + solver are stable.

## Wiring Deferred to Plan 02-09

The sidebar nav entry `manage_role_tags_link` (Hebrew label "תגיות תפקיד", visible to `unit_admin` only per UI-SPEC §"Menu") is NOT added in this plan. Plan 02-09 owns `app/lowdefy.yaml` updates that:
1. Add `manage_role_tags_link` to the menu definitions
2. Add `_ref: pages/admin/manage_role_tags.yaml` to the `pages:` list

Until plan 02-09 lands, the page exists on disk but is unreachable from the menu. Direct URL navigation (`/manage_role_tags`) will still work for admins once `_ref` wiring exists.

## Verification

- `node -e "..."` inline grep gate: **OK** — all 13 required tokens present (id, roles, unit_admin, list_role_tags, SELECT clause, FROM role_tag, WHERE tenant_id, _user: tenant_id, AgGridAlpine, enableRtl: true, read_only_notice, deferral Alert copy, AiOutlineInbox).
- `node tools/check-queries.mjs`: **PASS** — "all Knex request blocks have tenant_id filters" + "NO-RLS-BYPASS PASS".
- Mutation-block grep: **0 matches** — read-only constraint honored.
- File present at `app/pages/admin/manage_role_tags.yaml` (106 lines).

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` block specified the exact YAML shape; this implementation matches it byte-equal aside from extended inline comments that document the defense layers and deferral rationale (no behavioral changes).

## Commits

- `0810f19` — feat(02-05): add read-only role_tag catalog viewer page

## Self-Check: PASSED

- [x] File `app/pages/admin/manage_role_tags.yaml` exists (FOUND)
- [x] Commit `0810f19` present in git log (FOUND)
- [x] `enableRtl: true` on AgGrid (verified)
- [x] `tenant_id` bound from `_user.tenant_id` (verified)
- [x] No mutation blocks on the page (grep returned 0 matches)
- [x] check-queries gate green
- [x] auth.roles = [unit_admin] only (verified — team_manager not present)
