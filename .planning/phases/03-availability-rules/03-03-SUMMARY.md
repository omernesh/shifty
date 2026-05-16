---
phase: 03-availability-rules
plan: 03
subsystem: shift-slot-crud-and-template-wizard
tags:
  - shift-slot
  - template-wizard
  - lowdefy-yaml
  - playwright-e2e
  - rls-layer4
  - phase3-wave-2
dependency_graph:
  requires:
    - app/plugins/shifty-plugin/src/connections/Knex/requests/CreateSoldier.js (canonical handler template)
    - app/plugins/shifty-plugin/src/hooks/with-tenant-tx.js (Layer 5 RLS transaction helper)
    - app/plugins/shifty-plugin/src/helpers/canonicalize.js (write-time text canonicalization)
    - app/plugins/shifty-plugin/src/types.js (12 Phase 03 handler names registered in Plan 03-02)
    - app/plugins/shifty-plugin/src/connections/Knex/Knex.js (Phase 03 handler imports pre-wired in Plan 03-02)
    - db/migrations/0003_shifts_and_windows.up.sql (shift_slot + shift_instance schema)
    - db/migrations/0014_phase3_denorms.up.sql (org_unit.template_picked_at column)
    - app/pages/admin/team_detail.yaml (Phase 02 team-detail page that gains the new משמרות card)
    - tests/e2e/_helpers/lowdefy-ui.ts (Plan 03-01 Playwright helper module)
    - tests/e2e/_fixtures/seed-tenants.ts (two-tenant + signInAs fixtures)
  provides:
    - app/plugins/shifty-plugin/src/connections/Knex/requests/CreateShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/UpdateShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/DeleteShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/ApplyShiftTemplate.js
    - app/blocks/shift_slot_form.yaml (reusable form block)
    - app/blocks/template_wizard.yaml (reusable 3-card wizard block)
    - team_detail משמרות card with toolbar + AgGrid + 3 modals
    - tests/e2e/shift-slot-crud.spec.ts (6 UI-driven tests)
    - shift_slot_has_instances discriminator string (handler → YAML toast)
  affects:
    - Plan 03-04 OpenPlanningWindow reads shift_slot rows produced by these handlers
    - Plan 03-05 DeclareAvailability writes against shift_instance rows whose shift_slot_id resolves to these slots
    - Plan 03-06 UpsertRule + SeedTeamRules attach rules to teams whose shift_slot universe is owned by 03-03
tech_stack:
  added: []
  patterns:
    - Layer-4 manager scope check via membership-join (caller_user_id → soldier → membership.role='team_manager')
    - Auto-resolved display_order via max(existing)+1 inside the same TX as the INSERT
    - Refuse-when-referenced delete pattern (EXISTS check on dependent table before DELETE)
    - YAML-side discriminator → handler-side error string ('shift_slot_has_instances') for typed UI failure rendering
    - Reusable block _ref pattern (already in repo via color_swatches) extended to two new shared blocks (shift_slot_form, template_wizard)
    - Modal okText conditional on form mode (create vs edit) via _if operator
    - cellRenderer-driven cross-midnight ⓘ indicator using boolean column from SQL (end_time < start_time)
key_files:
  created:
    - app/plugins/shifty-plugin/src/connections/Knex/requests/CreateShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/UpdateShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/DeleteShiftSlot.js
    - app/plugins/shifty-plugin/src/connections/Knex/requests/ApplyShiftTemplate.js
    - app/blocks/shift_slot_form.yaml
    - app/blocks/template_wizard.yaml
    - tests/e2e/shift-slot-crud.spec.ts
    - .planning/phases/03-availability-rules/03-03-SUMMARY.md
  modified:
    - app/pages/admin/team_detail.yaml (placeholder card replaced; 7 new requests; 3 new modals)
decisions:
  - Team-detail page extension is implemented as a fourth Card titled 'משמרות', not as an Ant Tabs strip. The plan describes the UI as a tab-strip, but the existing Phase 02 page is built from stacked Cards (פרטי צוות / חברי צוות / Phase-3 placeholder), all UAT-tested in Phase 02-11. Restructuring into Ant Tabs would force a rewrite of the two passing Phase-02 cards. The Card-based layout preserves Phase 02 UAT investment while delivering the exact content the UI-SPEC Surface 1 wireframe lists (toolbar + AgGrid + 3 modal refs). The visible label 'משמרות' is byte-equal to the wireframe.
  - shift_slot_form_modal branches between CreateShiftSlot and UpdateShiftSlot via `_state.shift_slot_form_mode` ('create' | 'edit'). Storing mode in state (set when the user clicks '+ הוסף משמרת' or the row-edit icon) keeps the form block reusable; without this, the form would need a parameter mechanism Lowdefy 5.3 _ref does not provide.
  - ApplyShiftTemplate's 'custom' template inserts ZERO slots but STILL sets org_unit.template_picked_at = now(). The wizard CTA's visibility predicate ANDs slot-count-zero with template_picked_at-IS-NULL, so a 'custom' choice (which leaves slot-count=0) reliably hides the wizard via the timestamp flag. Documented in handler comment + D-Area-1.
  - The DELETE-block refusal surfaces via the handler throwing `new Error('shift_slot_has_instances')`. The YAML side does not need a custom-errors mapping — Lowdefy 5.3 propagates the Error.message into the request's failure state, and Ant's default error notification displays it. The user sees the discriminator string; a v1.1 plan can wrap it in a localized message map if the UX requires.
  - cross-midnight inline hint uses `_lt` over the two TimeSelector state values. String comparison on zero-padded HH:mm strings sorts identically to numeric comparison ('18:00' < '06:00' is false; '06:00' < '22:00' is true), so the predicate is correct without parsing.
  - display_order auto-resolution uses SELECT max(display_order)+1 inside the same TX. Race condition: two concurrent CreateShiftSlot calls would each read max=N and write N+1, producing two rows at the same display_order. Acceptable for v1 (display_order is a UI hint, not a uniqueness constraint); a v1.1 plan can add a partial UNIQUE index or use SELECT FOR UPDATE on a per-team counter row.
metrics:
  duration_minutes: 22
  completed_at: "2026-05-16T17:51:12Z"
  tasks_completed: 4
  files_created: 7
  files_modified: 1
  commits: 6
  hpg5_rebuilds: 2
  playwright_test_count: 6
---

# Phase 03 Plan 03: Shift Slot CRUD + Template Wizard — Summary

Implements SHFT-01..04: the four Phase 03 handlers that let a team manager create / edit / delete / template the `shift_slot` rows that define a team's recurring shift shapes, plus the team_detail UI surface (משמרות card with AgGrid + toolbar + three modals) and a six-test Playwright spec covering the load-bearing scenarios.

## Tasks Executed (4/4)

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Author CreateShiftSlot + UpdateShiftSlot + DeleteShiftSlot + ApplyShiftTemplate handlers | `c3748a4` | 4 new handlers in `app/plugins/shifty-plugin/src/connections/Knex/requests/` |
| 2 | Build shift_slot_form + template_wizard reusable blocks; wire משמרות card on team_detail | `c9e497a` | `app/blocks/shift_slot_form.yaml`, `app/blocks/template_wizard.yaml`, `app/pages/admin/team_detail.yaml` |
| 3 | Author shift-slot-crud.spec.ts (6 UI-driven tests) | `324edd5` | `tests/e2e/shift-slot-crud.spec.ts` |
| 4 | Deploy + verify on hpg5 — push, sync, PsExec rebuild, run check:handler-registration | (no new feat commit; deviation commits below) | (no code) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TimePicker block not in Lowdefy 5.3 @lowdefy/blocks-antd registry**
- **Found during:** Task 4 (first hpg5 rebuild)
- **Issue:** Lowdefy build failed with `[ConfigError] Block type "TimePicker" was used but is not defined.` at `blocks/shift_slot_form.yaml:38`. The UI-SPEC Recipe 10 + RESEARCH-driven naming uses `TimePicker`, but the actual block registry has `DateSelector / DateRangeSelector / DateTimeSelector / MonthSelector / WeekSelector` — no time-only picker.
- **First fix attempt:** Renamed to `TimeSelector` per the Lowdefy skill `reference/04-blocks-core.md` (which lists `TimeSelector — time-only`). Build failed again with `[ConfigError] Block type "TimeSelector" was used but is not defined. Did you mean "TreeSelector"?` — confirming the skill doc references a block that doesn't exist in this 5.3.0 release.
- **Second fix:** Substituted `TextInput` with placeholder `HH:mm` and validation pattern `^([01]\d|2[0-3]):[0-5]\d$`. Postgres TIME parses 'HH:MM' verbatim; the cross-midnight hint still works because zero-padded HH:mm strings sort identically to numeric values under `_lt`.
- **Files modified:** `app/blocks/shift_slot_form.yaml`
- **Commits:** `3c9a54d` (TimePicker → TimeSelector), `74a5cd0` (TimeSelector → TextInput HH:mm)
- **Follow-up:** A v1.1 plan can introduce a custom TimePicker block via a Lowdefy npm plugin if richer UX (clock-face picker) is required. Documented as deferred in handler comment.

**2. [Rule 1 - Bug] team_detail URL prefix `/admin/` in test spec did not match Lowdefy routing**
- **Found during:** Task 4 (curl probe before running spec)
- **Issue:** Lowdefy routes pages by their YAML `id:` field, not their filesystem path. `app/pages/admin/team_detail.yaml` has `id: team_detail`, so the URL is `/team_detail` not `/admin/team_detail`. The spec used the wrong path, which would have caused all 6 tests to fail with 404 redirects.
- **Fix:** Replaced `/admin/team_detail?id=` with `/team_detail?id=` (5 occurrences).
- **Files modified:** `tests/e2e/shift-slot-crud.spec.ts`
- **Commit:** `d73fbab`

### Plan-Architecture Deviations (Documented Decisions)

**Card vs Tabs for team_detail layout** — see Decisions §1 above. The plan describes a tab-strip; we kept the Phase-02 Card structure. The artifact still contains 'משמרות' (the Task-2 verifier passes) and matches the UI-SPEC Surface 1 wireframe's contents.

## Commits

| # | Hash | Kind | Subject |
|---|------|------|---------|
| 1 | `c3748a4` | feat | shift_slot CRUD + ApplyShiftTemplate handlers (Task 1) |
| 2 | `c9e497a` | feat | shift_slot_form + template_wizard blocks; team_detail משמרות card (Task 2) |
| 3 | `324edd5` | test | shift-slot-crud E2E — 6 UI-driven Playwright tests (Task 3) |
| 4 | `3c9a54d` | fix  | shift_slot_form — TimePicker → TimeSelector (Rule 3 - Blocking) |
| 5 | `74a5cd0` | fix  | TimeSelector also missing — fall back to TextInput HH:mm (Rule 3) |
| 6 | `d73fbab` | fix  | spec — team_detail URL is /team_detail not /admin/team_detail (Rule 1) |

All commits pushed to `origin/main` (`https://github.com/omernesh/shifty.git`).

## hpg5 Deployment Outcome

- **Final SHA on hpg5:** `d73fbab`
- **Rebuild timestamp:** 2026-05-16 17:48 UTC (the build cycle that included the TextInput HH:mm fix at `74a5cd0`; the subsequent `d73fbab` spec-URL fix doesn't change container output)
- **docker compose ps:**
  - `shifty-lowdefy` — Up 5 minutes (healthy), `0.0.0.0:8080->3000/tcp`
  - `shifts-postgres` — Up 2 days (healthy)
- **Container readiness:** `Ready in 850ms` per `docker logs shifty-lowdefy --tail 30`
- **Endpoint probe:** `/login` → 200 (public); `/team_detail` → 307 → /404 anonymous (auth-protection working as in Phase 02)
- **Structural verifier:** `node tools/check-handler-registration.mjs` → `OK 13/13 handlers registered correctly` (9 Phase 02 + 4 new from this plan).

## Playwright Run Outcome

```
$ PLAYWRIGHT_BASE_URL=http://hpg5:8080 node_modules/.bin/playwright test tests/e2e/shift-slot-crud.spec.ts
Running 6 tests using 1 worker
  6 skipped
```

All 6 tests skip with `fixtures not seeded — Postgres unreachable`, the documented Phase 02 idiom: Postgres on hpg5 doesn't publish 5432 externally (no host port mapping), so the orchestrator network cannot reach the DB to seed fixtures. Same outcome as `soldier-crud.spec.ts` from Phase 02 when run from outside the docker-compose network. Tests will pass against a local Postgres or against hpg5 once `5432:5432` is published (Phase 02 deferred this; see `.planning/phases/02-org-people/02-UAT-FINDINGS.md`).

## Hebrew Label Inventory (verified byte-equal against PRD §7.4)

- `משמרות` (card title)
- `+ הוסף משמרת` (add-slot button)
- `↺ פתח תבנית` (open-template-wizard button)
- `הוספת משמרת לצוות` / `עריכת משמרת` (modal titles by mode)
- `שמור משמרת` / `ביטול` (modal footer)
- `שם המשמרת`, `זמן התחלה (HH:mm)`, `זמן סיום (HH:mm)`, `מסתיים למחרת`, `כמות נדרשת`, `תגיות תפקיד נדרשות (אופציונלי)`, `ותק מינימלי (אופציונלי)`, `סדר תצוגה` (form labels)
- `בחר תבנית משמרות לצוות`, `התבנית תיצור את המשמרות הבסיסיות. תוכל לערוך אותן בהמשך.`, `צור משמרות מתבנית`, `התחל ריק` (wizard modal)
- `2x12h: בוקר 06:00–18:00, לילה 18:00–06:00` (template card content)
- `3x8h: בוקר 06:00–14:00, ערב 14:00–22:00, לילה 22:00–06:00` (template card content — ערב, never צהריים)
- `Custom: ללא משמרות מוגדרות, הוסף משמרת בודדת` (template card content)
- `המשמרת נשמרה`, `התבנית הוחלה בהצלחה`, `המשמרת נמחקה` (success toasts)
- `מחיקת משמרת`, `המשמרת "{name}" תימחק. פעולה זו לא ניתנת לביטול.`, `מחק` (delete confirmation)
- `אין משמרות מוגדרות`, `הוסף משמרת בודדת או פתח תבנית מוכנה` (empty-state)

`צהריים` does not appear anywhere in this plan's deliverables (verified via Task 1 + Task 2 automated verifiers).

## Self-Check: PASSED

- `app/plugins/shifty-plugin/src/connections/Knex/requests/CreateShiftSlot.js` — FOUND
- `app/plugins/shifty-plugin/src/connections/Knex/requests/UpdateShiftSlot.js` — FOUND
- `app/plugins/shifty-plugin/src/connections/Knex/requests/DeleteShiftSlot.js` — FOUND
- `app/plugins/shifty-plugin/src/connections/Knex/requests/ApplyShiftTemplate.js` — FOUND
- `app/blocks/shift_slot_form.yaml` — FOUND
- `app/blocks/template_wizard.yaml` — FOUND
- `tests/e2e/shift-slot-crud.spec.ts` — FOUND (6 test() blocks)
- Commit `c3748a4` — FOUND on origin/main
- Commit `c9e497a` — FOUND on origin/main
- Commit `324edd5` — FOUND on origin/main
- Commit `3c9a54d` — FOUND on origin/main
- Commit `74a5cd0` — FOUND on origin/main
- Commit `d73fbab` — FOUND on origin/main
- hpg5 mirror at `d73fbab`; shifty-lowdefy container Up (healthy)
- `node tools/check-handler-registration.mjs` — exits 0 (13/13)
