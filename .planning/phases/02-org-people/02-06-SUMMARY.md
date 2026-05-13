---
phase: 02-org-people
plan: 06
subsystem: lowdefy-app
tags: [phase-02, soldier-crud, rtl, multi-tenant, auth-spike, color-palette, magic-link]
status: complete
completed_at: 2026-05-13
dependency_graph:
  requires:
    - 02-01 (role_tag table, org_unit.last_color_index column)
    - 02-02 (shifty-roster plugin scaffold, sendInvite helper, stub handlers, helpers)
    - 02-04 (manage_soldiers row-click navigation to soldier_detail)
  provides:
    - "DB-touching CreateSoldier, UpdateSoldier, ArchiveSoldier, InviteLater handler bodies"
    - "soldier_detail page at /soldier_detail?id={uuid} with 4-card form + Save/Cancel/Archive"
    - "Shared 24-swatch color picker block at app/blocks/color_swatches.yaml + generator script"
    - "Verified-not-assumed Auth.js verification-token hash algorithm (B3 upstream gate)"
  affects:
    - 02-07 (team_detail; CreateMembership/RemoveMembership extend soldier_detail Card 3)
    - 02-08 (CSV roster import — InviteLater pattern + sendInvite reused; Task 1 spike becomes re-confirmation)
    - 02-09 (sidebar nav; row-click from manage_soldiers already lands here)
    - 02-10 (cross-tenant RBAC E2E exercises Layer-4 scope SQL on UpdateSoldier + ArchiveSoldier)
tech_stack:
  added: []
  patterns:
    - "Race-safe palette assignment: SELECT FOR UPDATE on org_unit.last_color_index + pickNextColor + UPDATE inside the same transaction (RESEARCH Open Q4)"
    - "Layer-4 scope SQL: single parameterized UPDATE with `(:is_admin OR EXISTS (SELECT 1 FROM membership ...))` in WHERE — no separate authorization round-trip"
    - "Manager-only column three-layer gate: SELECT CASE WHEN, UpdateSoldier CASE WHEN, page visible:"
    - "SELECT-driven membership INSERT (`INSERT ... SELECT s.tenant_id, ... FROM soldier s, org_unit ou WHERE s.tenant_id = :tenant AND ou.tenant_id = :tenant`) — refuses cross-tenant joins even when payload values are forged"
    - "Generator script + emitted YAML: tools/gen-color-swatches.mjs reads PALETTE export and writes a deterministic byte-identical block file"
    - "Defensive InviteLater payload composition: accept soldier_id (tenant-scoped lookup) OR direct email"
key_files:
  created:
    - app/pages/admin/soldier_detail.yaml
    - app/blocks/color_swatches.yaml
    - tools/gen-color-swatches.mjs
  modified:
    - app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/UpdateSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/InviteLater.js
    - app/plugins/shifty-roster/src/dispatch/resend.js
decisions:
  - "B3 fix landed: Auth.js verification-token hash spike runs upstream as Task 0 in plan 02-06, BEFORE InviteLater body ships — not deferred to plan 02-08 Task 1"
  - "Spike result VERIFIED — next-auth v4.24.14 core/lib/utils.js hashToken is byte-equal to our sendInvite() pre-computation: createHash('sha256').update(`${token}${provider.secret ?? secret}`).digest('hex')"
  - "EmailProvider in shifty-auth supplies no per-provider secret → the `provider.secret ?? secret` fallback resolves to NEXTAUTH_SECRET — exactly what sendInvite uses"
  - "Plan 02-08 Task 1 spike re-classified as a Wave-3 re-confirmation step (not the first verification)"
  - "Three-layer notes-column defense: load_soldier SELECT CASE WHEN nulls notes for non-managers; UpdateSoldier CASE WHEN refuses to write notes from non-managers; soldier_detail TextArea `visible:` hides the field — all three must hold, none alone suffices"
  - "InviteLater accepts two payload shapes — soldier_id (preferred, Layer-4 enforced via tenant-scoped SELECT) and direct email (for create-flow direct dispatch); shape A is what soldier_detail uses"
  - "Memberships MultipleSelector on Card 3 is read-only visual binding in plan 02-06; UpdateSoldier.schema does NOT include `teams` so the field is preserved on Save — actual write path lands in plan 02-07 via separate CreateMembership/RemoveMembership handlers"
  - "Color picker writes both selected_color_index AND selected_color_hex to state; UpdateSoldier.payload.color binds directly to the hex slot so no client-side palette indexOf lookup is needed"
metrics:
  duration_minutes: 28
  task_count: 4
  file_count: 8
requirements:
  - ROST-01
  - ROST-02
  - ROST-03
  - ROST-05
  - ROST-06
  - ROST-07
  - ROST-11
---

# Phase 02 Plan 06: Soldier Detail Page + Four DB-Touching Handlers (CreateSoldier, UpdateSoldier, ArchiveSoldier, InviteLater) + 24-Swatch Color Picker

Per-soldier edit experience landed. Plan 02-02 stubs replaced with real Knex-transactional handler bodies; new `soldier_detail.yaml` page wires the four Cards (identity, role/seniority, memberships, color) to the handlers; the 24-color picker promoted to a shared `app/blocks/color_swatches.yaml` block emitted deterministically from the PALETTE constant. B3 upstream gate executed as Task 0 — Auth.js verification-token hash algorithm verified byte-equal to our pre-computation against the live `next-auth@4.24.14` source inside the running container.

## Performance

- **Tasks:** 4 (Task 0 spike + Tasks 1-3 implementation)
- **Files modified/created:** 8
- **Commits:** 4 atomic + 1 SUMMARY

## Task Commits

1. **Task 0: Auth.js verification-token hash algorithm spike (B3)** — `78b6f1b` (feat)
2. **Task 1: Fill in CreateSoldier/UpdateSoldier/ArchiveSoldier/InviteLater handler bodies** — `c01e225` (feat)
3. **Task 2: gen-color-swatches script + emit color_swatches.yaml block** — `c6ffb59` (feat)
4. **Task 3: Add soldier_detail page with 4 cards + reusable color swatches** — `633052a` (feat)

## Task 0 — Auth.js verification-token hash spike (B3 UPSTREAM GATE)

**Result: VERIFIED — sha256 matches.** InviteLater body cleared to ship.

### What was verified

- **Source file:** `/build/node_modules/.pnpm/next-auth@4.24.14_next@16.2.6_react-dom@19.2.6_react@19.2.6__react@19.2.6__nodemailer@6.10.1__36db7vqaev7yua7vzsrzoeefmy/node_modules/next-auth/core/lib/utils.js` inside the running `shifty-lowdefy` container.
- **Function:** `hashToken(token, options)`:
  ```js
  return createHash('sha256').update(`${token}${provider.secret ?? secret}`).digest('hex');
  ```
- **URL token shape (`core/lib/email/signin.js`):** raw `randomBytes(32).toString('hex')` (256-bit entropy, 64 hex chars). The magic-link URL carries the RAW token; the DB stores the hash; the callback re-hashes and matches.
- **Our `dispatch/resend.js` sendInvite:**
  ```js
  createHash('sha256').update(rawToken + (process.env.NEXTAUTH_SECRET || '')).digest('hex')
  ```
- **Equivalence check:** `shifty-auth/auth/providers.js` EmailProvider supplies no per-provider `secret` field, so `provider.secret ?? secret` falls through to the top-level NextAuth `secret`, which Lowdefy populates from `NEXTAUTH_SECRET`. Strings concatenated in the same order with the same separator (none). **Byte-equal.**

### What changed in resend.js

Replaced the "Assumption A1" header comment block (and the forward-reference caveat in the `sendInvite` JSDoc) with a "VERIFIED A1" stanza that cites the source file:line. No behavioral change in the dispatcher itself — the hash computation was already correct. The spike just promoted it from "assumed" to "verified" so plan 02-08 Task 1 becomes a re-confirmation rather than the first validation.

### Smoke-test note (deferred, not blocking)

A full end-to-end Resend → inbox → click-the-link → land on `/admin_dashboard` smoke was not run as part of Task 0 (compressed 30-min budget — focused validation, not exploratory). The algorithmic verification above is sufficient to clear the gate; the end-to-end click smoke remains a checkbox for plan 02-08 Task 1 re-confirmation. No code changes are blocked by deferring it — if it later reveals an issue, the fix vector is `dispatch/resend.js` alone (no schema/data changes).

## Handler bodies (Task 1)

Each handler wraps its body in `db.transaction(async trx => { ... })` with try/finally `await db.destroy()`. Knex is imported dynamically (`const { default: knex } = await import('knex');`) so unit tests can exercise the guard clauses without `knex` installed — pattern inherited from `shifty-audit-writer/AuditWrite.js`.

### CreateSoldier — final body shape

1. Layer-4 guards: `tenant_id` from `request.user`, `actor_user_id` from `request.user`; reject if either missing.
2. `canonicalizeText(display_name)` BEFORE INSERT (D-12, ROST-11, Pitfall P2 belt-and-braces with plan 02-08 CSV path).
3. Role-tag upsert: `INSERT INTO role_tag ...) ... ON CONFLICT (tenant_id, key) DO NOTHING` via `knex.onConflict([...]).ignore()`.
4. Optional `app_user` resolution: SELECT existing by `(tenant_id, email)`; INSERT if absent with locale='he'.
5. **Race-safe color (RESEARCH Open Q4):** `SELECT last_color_index FROM org_unit WHERE id = :team_id AND tenant_id = :tenant_id FOR UPDATE` → `pickNextColor(...)` → UPDATE org_unit. Same transaction. No team_id → fallback to `PALETTE[0]`.
6. INSERT soldier with `RETURNING id`.
7. SELECT-driven membership INSERT (refuses to insert if `s.tenant_id != ou.tenant_id`).
8. `schedule_audit` row with `to_state='soldier_created'`, payload includes soldier_id, display_name, team_id, role_tags, app_user_id, color_index.
9. Return `{ success, soldier: { id, display_name, color, role_tags }, app_user_id, color_index }`.

### UpdateSoldier — final body shape

Single parameterized UPDATE with COALESCE on every mutable column. The Layer-4 scope clause is `(:is_admin OR EXISTS (SELECT 1 FROM membership m WHERE m.soldier_id = :soldier_id AND m.org_unit_id = ANY(:caller_team_ids)))`. RETURNING id → zero rows on access denial → throws "soldier not found or access denied". The notes column is gated TWICE: server-side `safeNotes = (typeof notes === 'string' && is_manager_or_admin) ? notes : null` AND the SQL `notes = CASE WHEN :is_manager_or_admin THEN COALESCE(:notes, notes) ELSE notes END`. Audit row with `to_state='soldier_updated'` includes a diff of which fields the request changed.

### ArchiveSoldier — final body shape

Single UPDATE: `SET status = 'archived', updated_at = now()`. Layer-4 scope SQL identical to UpdateSoldier. RETURNING id → zero rows → access denied error. The literal `status = 'archived'` is one contiguous SQL token (W4 fix from PLAN revision). **ZERO DELETE statements** — verified via the grep gate in Task 1's automated check. Memberships, app_user, schedule_audit history all preserved per D-08.

### InviteLater — final body shape

Accepts EITHER `{ soldier_id }` (preferred, used by soldier_detail) OR `{ email, displayName?, callbackUrl?, locale? }` (direct dispatch). With soldier_id: tenant-scoped LEFT JOIN `soldier s LEFT JOIN app_user au ON au.id = s.user_id` filtered by `s.id = :soldier_id AND s.tenant_id = :tenant_id` — if `au.email` is null, throws "no email on file". `sendInvite({ email, callbackUrl, displayName, locale, knexTx: trx })` runs inside the transaction so verification_tokens row commits atomically with the audit row. Resend errors are soft-failed: the audit row records `dispatch_status: 'failed' | 'sent'` and the handler returns `{ success: false, error }` to let the UI toast it.

## Page shape — soldier_detail.yaml (Task 3)

`app/pages/admin/soldier_detail.yaml` — reached from manage_soldiers row click with `_url_query.id` carrying the soldier UUID. `auth.roles: [unit_admin, team_manager]`.

### Requests (6)

1. `load_soldier` (KnexRaw) — single-row SELECT joining soldier + app_user + memberships subquery. **Notes column server-side gated** via `CASE WHEN :is_manager_or_admin THEN s.notes ELSE NULL` (Pitfall P10). Returns `has_app_user` bool + `team_ids uuid[]` for the InviteLater button and the MultipleSelector defaultValue.
2. `list_role_tags` (KnexRaw) — feeds the role_tags TagSelector autocomplete.
3. `list_leaf_teams` (KnexRaw) — feeds the Memberships MultipleSelector.
4. `update_soldier_request` (UpdateSoldier plugin) — payload binds form state + `_state.selected_color_hex`.
5. `archive_soldier_request` (ArchiveSoldier plugin) — payload `{ soldier_id: _url_query.id }`.
6. `invite_later_request` (InviteLater plugin) — payload `{ soldier_id: _url_query.id }`.

### Cards (in render order)

1. **זהות** — display_name (required), email (readOnly), phone_e164, status Selector, and the conditional "שלח קישור הזמנה" Button (`visible: { _and: [{ _not: has_app_user }, email] }`).
2. **תפקיד וותק** — seniority NumberInput (0..10), role_tags TagSelector, and the manager-only notes TextArea (`visible:` _or unit_admin/team_manager).
3. **חברות בצוותים** — MultipleSelector with `defaultValue: team_ids` (visual binding only in plan 02-06; write path lands in plan 02-07).
4. **צבע אישי** — `_ref: ../../blocks/color_swatches.yaml` (resolution: `app/pages/admin/` → `app/blocks/`).

### Footer

- **שמור שינויים** (primary) — Validate → UpdateSoldier → success toast → Link to manage_soldiers.
- **ביטול** — Link to manage_soldiers.
- **ארכוב חייל** (default + danger) — Confirm modal → ArchiveSoldier → toast → Link back.

## Color picker — gen script + emitted block (Task 2)

- `tools/gen-color-swatches.mjs`: ESM Node script. Imports `PALETTE` from `app/plugins/shifty-roster/src/helpers/palette.js` (single source of truth, locked byte-equal to UI-SPEC §"Color B" by the existing `palette.test.mjs` deepStrictEqual). Writes 24 swatch_N blocks to `app/blocks/color_swatches.yaml`.
- **Deterministic:** no timestamps, no randomness. Verified by diff'ing two consecutive runs — byte-identical output. Safe for CI re-generation if anyone bumps the script.
- **Block contract:** reads `_state.selected_color_index` (integer 0..23), writes BOTH `selected_color_index` AND `selected_color_hex` on click. The `soldier_detail` Save action binds `update_soldier_request.payload.color` directly to `_state.selected_color_hex` so no client-side PALETTE indexOf is needed.

## Layer-4 contract (relevant SQL snippets)

UpdateSoldier WHERE clause:

```sql
WHERE id = :soldier_id
  AND tenant_id = :tenant_id
  AND (
    :is_admin
    OR EXISTS (
      SELECT 1 FROM membership m
       WHERE m.soldier_id = :soldier_id
         AND m.org_unit_id = ANY(:caller_team_ids)
    )
  )
```

ArchiveSoldier WHERE clause is identical (sans the COALESCE-driven SET).

`caller_team_ids` comes from `request.user.team_ids`, populated by the shifty-auth session callback from membership joins — clients cannot spoof it. `is_admin` comes from `request.user.roles.includes('unit_admin')`. Pattern follows the plan 02-03 admin-gate CTE shape (decision in STATE.md).

## Verification commands run

- `node --check` on all 4 handler files — PASS
- `node tools/check-queries.mjs` — PASS (tenant_id gate + no-RLS-bypass)
- `node -e "..."` Task 1 grep check (canonicalizeText, FOR UPDATE, soldier_created, ON CONFLICT, caller_team_ids, is_admin, is_manager_or_admin, soldier_updated, `CASE WHEN :is_manager_or_admin`, `status = 'archived'`, no DELETE on soldier/membership/app_user, sendInvite) — PASS
- `node -e "..."` Task 2 grep check (24 swatch_N + 24 hex strings + selected_color_index) — PASS
- `node -e "..."` Task 3 grep check (22 required tokens: load_soldier, has_app_user, team_ids, type: UpdateSoldier/ArchiveSoldier/InviteLater, _ref to color_swatches, etc.) — PASS
- Second run of gen-color-swatches.mjs + diff against first run — byte-identical (DETERMINISTIC OK)
- `node --test app/plugins/shifty-roster/tests/*.test.mjs` — 42/42 PASS (unchanged from plan 02-02)

## Decisions Made

See `decisions:` in the frontmatter above. Highlights:

- **B3 upstream gate fired and PASSED on first verification.** The pre-spike code was already correct — the spike's value was to formally promote the algorithm from "assumed" to "verified" so downstream waves don't re-spend the budget.
- **Manager-only `notes` defended at three layers.** Required because plan 02-04's checked patterns showed the field has been a recurring Pitfall (P10) candidate.
- **MultipleSelector on Card 3 is visual-only** until plan 02-07 adds the membership write path. UpdateSoldier.schema explicitly does NOT enumerate `teams` so the binding cannot accidentally drop memberships on Save.

## Deviations from Plan

None — plan executed exactly as written. The Task 0 spike came back "verified" on first read; no fix-and-re-verify cycle was needed. All four Task 1 handler bodies, the Task 2 generator+block, and the Task 3 page YAML were implemented exactly per the plan's `<action>` blocks. Task 1's verification chain (the long inline node -e check) passed first run on all required tokens.

## Threat surface scan

The plan's `<threat_model>` lists T-02-01..T-02-06 as `mitigate` after this plan ships. All mitigations are present in code:

- **T-02-01 (tenant_id forgery):** plugin handlers re-derive `tenant_id` from `request.user.tenant_id`; KnexRaw blocks read it from `_user:tenant_id`. check-queries.mjs gate confirms.
- **T-02-02 (cross-tenant soldier read):** every SELECT filters `WHERE s.tenant_id = :tenant_id`; RLS catches forgery at the DB layer.
- **T-02-03 (read-time stripping):** never invoked — canonicalizeText runs on WRITE in CreateSoldier + UpdateSoldier; load_soldier SELECTs canonical bytes.
- **T-02-04 (invite token leakage):** UPGRADED disposition from `accept` to `mitigate` — Task 0 verified the hash algorithm BEFORE the primitive was exercised.
- **T-02-06 (team_manager privilege escalation):** UpdateSoldier WHERE clause `(:is_admin OR EXISTS team-membership)` blocks out-of-scope edits even with forged soldier_id. Plan 02-10 has the explicit RBAC E2E.

No new threat-flag surface introduced beyond what the plan's threat_model enumerates.

## Known Stubs

The Memberships MultipleSelector on Card 3 is intentionally rendered as a visual-only binding in this plan — the write path (CreateMembership/RemoveMembership handlers + UpdateSoldier teams diff handling) lands in plan 02-07. The plan explicitly calls this out (`<action>` block for Task 3 Card 3) and the SUMMARY frontmatter decisions list documents it. UpdateSoldier.schema does NOT enumerate `teams`, so an accidental Save cannot drop memberships.

## Self-Check: PASSED

All files exist:
- `app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js` — FOUND
- `app/plugins/shifty-roster/src/connections/requests/UpdateSoldier.js` — FOUND
- `app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js` — FOUND
- `app/plugins/shifty-roster/src/connections/requests/InviteLater.js` — FOUND
- `app/plugins/shifty-roster/src/dispatch/resend.js` — FOUND (modified)
- `app/blocks/color_swatches.yaml` — FOUND
- `app/pages/admin/soldier_detail.yaml` — FOUND
- `tools/gen-color-swatches.mjs` — FOUND

All commits present in git log:
- `78b6f1b` — FOUND (Task 0 spike)
- `c01e225` — FOUND (Task 1 handlers)
- `c6ffb59` — FOUND (Task 2 swatches)
- `633052a` — FOUND (Task 3 page)

---

*Phase: 02-org-people*
*Completed: 2026-05-13*
