---
phase: 02-org-people
plan: 07
subsystem: org-people
tags: [membership, multi-team, color-override, layer-4, w7-fix]
requires: [02-01, 02-02, 02-04, 02-06]
provides:
  - CreateMembership handler (SELECT-driven safe INSERT + audit)
  - team_detail.yaml (members AgGrid + Add/Remove + D-03 placeholder)
  - my_profile.yaml (minimal color override per D-16)
  - Layer-4 SQL gate for remove_membership with W7-locked binding
affects:
  - app/plugins/shifty-roster (CreateMembership stub → full body)
tech-stack:
  added: []
  patterns:
    - SELECT-driven INSERT with cross-tenant cross-check (RESEARCH §Membership)
    - ON CONFLICT DO NOTHING idempotent membership-add
    - already_member post-check distinguishes idempotent retry vs scope error
    - Layer-4 SQL gate `(:is_admin OR :team_id = ANY(:caller_team_ids))`
    - W7 grep-locked payload binding `caller_team_ids: { _user: team_ids }`
    - Pattern A action column (single icon, _event.column.field dispatch)
    - Both-from-_user mutation guard (user_id + tenant_id both session-derived)
key-files:
  created:
    - app/pages/admin/team_detail.yaml
    - app/pages/my_profile.yaml
  modified:
    - app/plugins/shifty-roster/src/connections/requests/CreateMembership.js
decisions:
  - SELECT-driven INSERT with both `s.tenant_id = :tenant_id` AND `ou.tenant_id = :tenant_id` cross-checks is the safe form for membership; bare INSERT…VALUES is forbidden in Phase 2
  - ON CONFLICT (soldier_id, org_unit_id) DO NOTHING + a follow-up EXISTS query is the idempotency contract — distinguishes already_member (no-op success, no audit) from soldier/team-not-found (real error)
  - No round-robin color bump on membership-add — D-15 line 3 mandates "soldier keeps their current color (no recolor on team-add)"; CreateSoldier (02-06) is the only path that mutates org_unit.last_color_index
  - remove_membership is hard DELETE (membership has no archive concept); historical assignment correctness lives in the assignment-table snapshot pattern from Phase 3+, not in membership-row retention (D-08)
  - W7 fix — caller_team_ids in remove_membership.payload binds LITERALLY to `{ _user: team_ids }`; verify regex `caller_team_ids\s*:\s*\{\s*_user:\s*team_ids\s*\}` greps every plan-checker run
  - my_profile UPDATE soldier WHERE filters BOTH user_id AND tenant_id from session (T-02-06 — caller cannot update other users' rows)
  - my_profile reuses the shared color_swatches block via `_ref: ../blocks/color_swatches.yaml` (path depth differs from soldier_detail's `../../blocks/color_swatches.yaml` because my_profile.yaml is at app/pages/, not app/pages/admin/)
metrics:
  duration_minutes: ~30
  completed: 2026-05-13
  tasks_total: 3
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  commits: 3
---

# Phase 2 Plan 07: Membership Write Path + Color Override Summary

**One-liner:** Multi-team membership write path on team_detail + soldier-facing color override on my_profile, with W7-locked Layer-4 binding for remove_membership and SELECT-driven safe INSERT for CreateMembership.

## What was built

Three deliverables completing Wave 2's soldier/team CRUD surface (alongside plan 02-06):

1. **CreateMembership.js (handler body)** — Replaced the plan 02-02 stub with the full SELECT-driven INSERT pattern + idempotency + audit.
2. **team_detail.yaml (new page)** — 3-card team-scoped surface: team metadata, members AgGrid with Add/Remove flows, D-03 Phase 3 placeholder card.
3. **my_profile.yaml (new page)** — Minimal color-override surface per D-16; every authenticated role; both user_id AND tenant_id session-bound.

## CreateMembership SQL body (verbatim)

```javascript
const insertRes = await trx.raw(
  `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
   SELECT s.tenant_id, s.id, ou.id, :role
     FROM soldier s, org_unit ou
    WHERE s.id = :soldier_id
      AND ou.id = :team_id
      AND s.tenant_id = :tenant_id
      AND ou.tenant_id = :tenant_id
      AND s.status = 'active'
   ON CONFLICT (soldier_id, org_unit_id) DO NOTHING
   RETURNING id, tenant_id, soldier_id, org_unit_id`,
  { role: effectiveRole, soldier_id, team_id, tenant_id }
);
```

Key properties:

- `tenant_id` in the INSERT comes from `s.tenant_id` (the DB row), never from the payload — a forged payload tenant_id is only used in the WHERE filter, never written. Cross-tenant probe protection.
- Both `s.tenant_id = :tenant_id` AND `ou.tenant_id = :tenant_id` filters guarantee soldier and team live in the same tenant.
- `s.status = 'active'` blocks adding archived soldiers (ROST-05).
- `ON CONFLICT (soldier_id, org_unit_id) DO NOTHING` makes the call idempotent on retry.
- A follow-up `SELECT EXISTS(...) AS already_member` distinguishes idempotent retry (success, no audit row) from soldier/team-not-found (error).

Layer-4 caller-scope check fires before the INSERT:

```javascript
const canWrite = is_admin || caller_team_ids.includes(team_id);
if (!canWrite) {
  throw new Error('CreateMembership: access denied — team not in caller scope');
}
```

`schedule_audit` row written with `to_state: 'membership_added'` only when a real INSERT occurred (not on idempotent retry).

## remove_membership Layer-4 SQL gate (verbatim)

```sql
DELETE FROM membership
 WHERE id = :membership_id
   AND org_unit_id = :team_id
   AND tenant_id = :tenant_id
   AND (:is_admin OR :team_id = ANY(:caller_team_ids))
 RETURNING soldier_id, org_unit_id
```

The trailing `(:is_admin OR :team_id = ANY(:caller_team_ids))` clause is the Layer-4 SQL gate: admins unconditionally permitted, team_managers only when `team_id` appears in their `caller_team_ids` array.

## W7-locked caller_team_ids binding (verbatim YAML)

In `app/pages/admin/team_detail.yaml`, the `remove_membership` request payload binds `caller_team_ids` literally from session:

```yaml
  - id: remove_membership
    type: KnexRaw
    connectionId: shifts_db
    payload:
      tenant_id: { _user: tenant_id }
      membership_id: { _state: remove_target_membership_id }
      team_id: { _url_query: id }
      caller_team_ids: { _user: team_ids }
      is_admin:
        _array.includes:
          on: { _user: roles }
          value: unit_admin
```

The verify-command regex `caller_team_ids\s*:\s*\{\s*_user:\s*team_ids\s*\}` matches this exact form. If a future edit accidentally rebinds it to `_state.something` or `_payload.something`, the regex fails and the plan-checker blocks the change. This is the W7 fix in action: the Layer-4 SQL gate is only as good as the source of `caller_team_ids`; locking the binding makes the surface traceable in code review.

## my_profile UPDATE WHERE clause (verbatim)

```sql
UPDATE soldier
   SET color = :color,
       updated_at = now()
 WHERE user_id = :user_id
   AND tenant_id = :tenant_id
 RETURNING id, color
```

Both `:user_id` and `:tenant_id` flow from `_user` (session). The payload:

```yaml
payload:
  user_id: { _user: user_id }
  tenant_id: { _user: tenant_id }
  color: { _state: selected_color_hex }
```

T-02-06 mitigation: a forged request body cannot update any soldier but the caller's own. The WHERE clause hard-binds to the row keyed by `(user_id, tenant_id)`, both session-derived.

## check-queries gate output

```
check-queries: all Knex request blocks have tenant_id filters.
NO-RLS-BYPASS PASS: no `SET row_security = off` found in tracked source.
```

Both green. All 6 new KnexRaw blocks across team_detail.yaml and my_profile.yaml pass the tenant_id filter check.

## Tests

- `app/plugins/shifty-roster/tests/canonicalize.test.mjs` — 18 tests pass
- `app/plugins/shifty-roster/tests/palette.test.mjs` — 13 tests pass
- `app/plugins/shifty-roster/tests/role-tag.test.mjs` — 11 tests pass
- **Total: 42/42 pass**

CreateMembership now has DB-touching code paths but Phase 2 ships no unit-test for it (matches CreateSoldier from plan 02-06 — DB-touching handlers are exercised by Playwright RBAC E2E in plan 02-10). The handler is syntactically validated via `node --check`.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed with green verifies on first pass:

- Task 1: 9/9 required tokens present, no stub literal, `node --check` OK, 42/42 plugin tests green.
- Task 2: 20/20 required tokens present, W7 regex matches, check-queries gate green.
- Task 3: 16/16 required tokens present, check-queries gate green.

## Cross-references

- **CreateMembership called from:** `app/pages/admin/team_detail.yaml` (`create_membership_request` block). Soldier-detail's Teams MultipleSelector remains read-only per plan 02-06 scope choice — all add/remove concentrated on team_detail.
- **remove_membership chained with:** `audit_remove_membership` (AuditWrite plugin handler with `to_state: 'membership_removed'`). The soldier_id comes from `remove_membership.0.soldier_id` (the DELETE's RETURNING clause).
- **color_swatches block reused by:** soldier_detail.yaml (via `../../blocks/color_swatches.yaml`) AND my_profile.yaml (via `../blocks/color_swatches.yaml`). Same block, different relative paths because the pages live at different directory depths.
- **D-03 placeholder card:** Phase 3's plan-03 (shift_slot CRUD) is the consumer — the placeholder turns into the live "Shift template" card when Phase 3 ships.
- **Phase 2 plan 10 (Playwright RBAC E2E):** Auto-covers the new `team_detail` and `my_profile` routes via the `tests/e2e/cross-tenant-leak.spec.ts` fixture. The remove_membership Layer-4 SQL gate is exercised there.

## Threat-flag scan

No new threat surface introduced outside the plan's threat_model. All new pages and KnexRaw blocks follow the Phase 2 5-layer tenant isolation pattern; remove_membership and update_my_color are the only writes, both with explicit Layer-4 guards documented in the threat register.

## Known Stubs

None. CreateMembership stub from plan 02-02 has been fully replaced.

## Self-Check: PASSED

Files exist:

- FOUND: app/pages/admin/team_detail.yaml
- FOUND: app/pages/my_profile.yaml
- FOUND: app/plugins/shifty-roster/src/connections/requests/CreateMembership.js (modified — stub replaced)

Commits in `git log`:

- FOUND: 428a62a feat(02-07): fill CreateMembership handler with SELECT-driven safe INSERT
- FOUND: 1ecf6f3 feat(02-07): add team_detail.yaml — members AgGrid + Add/Remove + Phase 3 placeholder
- FOUND: 82635e1 feat(02-07): add my_profile.yaml — every-role color override (D-16)
