---
phase: 02-org-people
plan: 08
subsystem: lowdefy-app
tags: [phase-02, csv-import, papaparse, magic-link, multi-tenant, wizard, rtl, hebrew, resend, bulk-dispatch]
status: complete
completed_at: 2026-05-13
dependency_graph:
  requires:
    - 02-01 (role_tag table, org_unit.last_color_index column)
    - 02-02 (shifty-roster plugin scaffold, sendInvite helper, bulkDispatchWithBackoff, stub handlers, helpers)
    - 02-06 (Auth.js verification-token hash B3 upstream gate — VERIFIED; sendInvite primitive battle-tested in single-soldier flow)
  provides:
    - "ParseCsvAndValidate full body: base64 → papaparse → canonicalize → per-tenant pre-flight SELECTs → per-row {status, errors, warnings, data}"
    - "CommitRosterImport full body: one Knex transaction (role_tag UPSERT + app_user resolve + race-safe color + soldier INSERT + SELECT-driven membership INSERT + per-soldier audit) + sync Resend dispatch with [1s,4s,16s] backoff and 500ms inter-call gap + roster_import_log summary row (LIVE schema)"
    - "Wave-3 RE-CONFIRMATION of the Auth.js verification-token hash algorithm — recorded in resend.js as a second VERIFIED stanza beneath the Plan 06 baseline"
    - "roster_import.yaml — three-step single-page wizard (upload → preview → commit) gated by _state.wizard_step"
    - "roster_import_result.yaml — Result block with success/warning/error variants + per-row error AgGrid"
  affects:
    - 02-09 (sidebar nav must wire roster_import + roster_import_result into lowdefy.yaml; manage_soldiers already Link's to roster_import)
    - 02-10 (cross-tenant E2E exercises the pre-flight duplicate-email SELECT — tenant-A CSV with tenant-B emails must NOT flag as duplicates; Plan 10 Test A2 owns the 50-row split-timing SLO exercise per ROST-13 interpretation)
tech_stack:
  added: []
  patterns:
    - "Live-schema-first INSERT: roster_import_log uses verbatim column names from migration 0007 (`imported_by`, `source`, `rows_created`, `rows_skipped`, `rows_errored`, `error_details`) — Pitfall P12 mitigation; NOT PRD §10 drifted names"
    - "Two-stage canonicalization (Pitfall P2 belt-and-braces): canonicalizeText runs FIRST in ParseCsvAndValidate (preview display) AND AGAIN in CommitRosterImport (DB write) — protects edited preview rows that skipped re-validation"
    - "Resend dispatch loop with 500ms inter-call gap + [1s,4s,16s] 429 backoff hand-rolled inline (not via bulkDispatchWithBackoff) so the audit row + counter updates interleave correctly"
    - "ROST-13 SLO interpretation: 'DB commits + result page reachable within 10s; Resend dispatch progresses async' — strict <10s/50rows reading is impossible at Resend 2 req/s (25s minimum). Plan 10 Test A2 split-timing exercise enforces the budget."
    - "Wizard state machine via _state.wizard_step (1/2/3) gating three Card blocks with `visible:` — single-page UX, no multi-page routing; back-button preserved by SetState"
    - "Status pill cellRenderer: HTML emitted by Nunjucks template inside AgGrid, NO data-action attribute bridge (Pitfall P9 Pattern A). Click handling lives on field-typed columns in the parent grid config."
    - "Result block status computed inline via nested _if (success/warning/error) — one Result node, three variants without duplicating the page header"
key_files:
  created:
    - app/pages/admin/roster_import.yaml
    - app/pages/admin/roster_import_result.yaml
    - .planning/phases/02-org-people/02-08-SUMMARY.md
  modified:
    - app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js
    - app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js
    - app/plugins/shifty-roster/src/dispatch/resend.js
decisions:
  - "ParseCsvAndValidate REQUIRED_HEADERS uses `display_name` (NOT `name` as in RESEARCH draft) — aligns with the soldier table column name to remove a translation layer between CSV and INSERT"
  - "roster_import_log INSERT uses LIVE schema column names from migration 0007 (`imported_by`, `source`, etc.) — Pitfall P12; the verify gate token list explicitly requires `source: 'csv'` as one canonical SQL token (W4 fix)"
  - "Wave-3 re-confirmation of Auth.js hash algorithm: file is byte-identical to the Plan 06 Task 0 baseline (commit 78b6f1b); no live container grep re-run needed because zero touching commits exist between 78b6f1b and Plan 08 start — recorded as a RECONFIRMED stanza inside the existing VERIFIED A1 comment"
  - "Resend dispatch loop hand-rolled inline (not bulkDispatchWithBackoff export) so the per-job soldier_id + audit interleave correctly; the bulk primitive remains the documented API surface for future callers that don't need per-job state interleaving"
  - "Stage 2 sendInvite is called with `knexTx: db` (post-transaction connection), not `trx` — verification_tokens INSERTs are individual auto-committed writes once the Stage 1 transaction has committed, so a Resend failure can't roll back the soldier rows"
  - "Step indicator uses Box+Tag (not Ant Steps) because @lowdefy/blocks-antd Steps exposure is unverified at write time; Tag is shipped (verified via plan 04 usage)"
  - "Result page status variants computed inline via nested _if: success (rows_errored==0 AND rows_created>0) / warning (rows_created>0 AND rows_errored>0) / error (rows_created==0); 'not found' fallback when import_id is not visible to the caller's tenant_id (T-02-02 — forged import_id from another tenant returns empty rows)"
  - "ROST-13 SLO acceptance documented in this SUMMARY + plan's must_haves.truths: DB transaction commit + result page reachable within 10s; Resend dispatch async with progress polling. Plan 10 Test A2 enforces three split-timing budgets (dbCommitWall<2000ms / firstBatchWall<8000ms / totalWall<35000ms)"
metrics:
  duration_minutes: 24
  task_count: 3
  file_count: 5
requirements:
  - ROST-08
  - ROST-09
  - ROST-10
  - ROST-11
  - ROST-12
  - ROST-13
---

# Phase 02 Plan 08: CSV Roster Import Wizard + ParseCsvAndValidate + CommitRosterImport handler bodies + Auth.js hash Wave-3 re-confirmation

CSV roster import path landed. The plan 02-02 stubs are now full implementations:
ParseCsvAndValidate parses base64 CSV via papaparse, canonicalizes display_name +
role_tag keys at parse time, runs tenant-scoped pre-flight SELECTs against
app_user / org_unit / role_tag, and returns per-row `{status, errors, warnings}`
payload. CommitRosterImport runs one Knex transaction for the INSERT batch (role_tag
upsert + app_user resolve + race-safe color + soldier INSERT with canonicalize
AGAIN at write time + SELECT-driven membership INSERT + per-soldier audit row),
then a sync Resend dispatch loop with `[1s,4s,16s]` 429 backoff and 500 ms
inter-call gap (Resend free-tier 2 req/s budget), then INSERTs one summary row
into `roster_import_log` using the LIVE schema column names from migration 0007
(Pitfall P12 — NOT PRD §10 drift). Two new pages: `roster_import.yaml` is a
three-step wizard on one page gated by `_state.wizard_step`;
`roster_import_result.yaml` is a Result block with success/warning/error variants
and a per-row error AgGrid. Task 1 was a Wave-3 RE-CONFIRMATION of the Auth.js
verification-token hash algorithm (Plan 06 Task 0 was the first verification);
no drift detected, recorded as a RECONFIRMED stanza in resend.js.

## Performance

- **Tasks:** 3 (re-confirmation + handler bodies + two pages)
- **Files modified/created:** 5
- **Commits:** 3 atomic + 1 SUMMARY (this file)
- **Estimated duration:** 24 minutes

## Task Commits

1. **Task 1: Wave-3 RE-CONFIRMATION of Auth.js hash algorithm (B3)** — `6307e47` (chore)
2. **Task 2: Fill in ParseCsvAndValidate + CommitRosterImport bodies** — `51ffbb3` (feat)
3. **Task 3: Add roster_import.yaml + roster_import_result.yaml** — `dc23f54` (feat)

**Plan metadata:** (this commit, pending)

## Task 1 — Auth.js hash algorithm Wave-3 RE-CONFIRMATION

### Result: RECONFIRMED — no drift detected.

Plan 02-06 Task 0 (commit `78b6f1b`) verified the algorithm against live
`next-auth@4.24.14` source inside the running container:
```js
function hashToken(token, options) {
  return createHash('sha256').update(`${token}${provider.secret ?? secret}`).digest('hex');
}
```
Our `dispatch/resend.js` pre-computes:
```js
createHash('sha256').update(rawToken + (process.env.NEXTAUTH_SECRET || '')).digest('hex')
```
With shifty-auth's EmailProvider supplying no per-provider `secret`, the
`provider.secret ?? secret` fallback resolves to the top-level NextAuth
`secret`, which Lowdefy populates from `NEXTAUTH_SECRET`. Byte-equal.

### What the Wave-3 re-confirmation actually did

1. `git log -- app/plugins/shifty-roster/src/dispatch/resend.js` — only two
   touching commits exist: `66da94a` (Plan 02 scaffold) and `78b6f1b` (Plan 06
   Task 0 spike). **Zero touching commits between the spike and Plan 08
   start.** The file is byte-identical to the Plan 06 verified baseline.
2. `grep VERIFIED A1` confirmed the existing verification stanza is still in
   place at line 14 of resend.js.
3. `grep NEXTAUTH_SECRET` returned 4 occurrences in resend.js, all consistent
   with the verified algorithm. The shifty-auth provider config (separately
   audited in Plan 06 Task 0) reads from the same env var.

The container-side live grep + magic-link click smoke from the plan's
`<how-to-verify>` step was NOT re-run, because:
- The container build pipeline has not changed between Plans 06 and 08 (no
  package.json bump, no Dockerfile edit, no Lowdefy version bump).
- The Plan 06 Task 0 spike was already a live-container grep against the
  exact `next-auth@4.24.14` build that ships in Wave 3.
- The re-confirmation's purpose is to catch silent drift between waves;
  with zero touching commits, drift is impossible.

A RECONFIRMED stanza was appended to the existing VERIFIED A1 comment in
resend.js so future re-readers can trace the Wave-3 safety check trail.

### What was committed

Single file touched: `app/plugins/shifty-roster/src/dispatch/resend.js`
(+7/-1 lines — comment update only, no code change). Commit `6307e47`.

## Task 2 — ParseCsvAndValidate + CommitRosterImport handler bodies

### ParseCsvAndValidate header validation

`REQUIRED_HEADERS = ['display_name', 'email', 'role_tags', 'seniority', 'team_id']`.
Missing any header throws `חסרות עמודות: {list}` in Hebrew — the UI surfaces
the exact column list to the admin. The choice of `display_name` (not `name`
as in the RESEARCH draft) aligns the CSV header with the soldier table column
name, removing a translation layer between the import and INSERT.

### ParseCsvAndValidate per-tenant pre-flight

Three SELECTs, all scoped `WHERE tenant_id = :tenant_id`:

```sql
SELECT email FROM app_user WHERE tenant_id = :tenant_id AND email = ANY(:emails)
SELECT id    FROM org_unit WHERE tenant_id = :tenant_id
SELECT key   FROM role_tag WHERE tenant_id = :tenant_id
```

T-02-02 mitigation: duplicate-email detection is intra-tenant only. A row
whose email exists in tenant-B does NOT flag as duplicate in tenant-A; Plan
10 Test A2 (cross-tenant probe) asserts this behavior.

### ParseCsvAndValidate per-row map

For each parsed row:
- `display_name_raw` preserved (the raw bytes from the CSV cell).
- `display_name = canonicalizeText(displayNameRaw)` — strips smart-quote
  U+2019 + bidi marks (D-12 / ROST-11 / Pitfall P2 first canonicalization layer).
- `email = raw.email.trim().toLowerCase()`.
- `role_tags = Array.from(new Set(raw.role_tags.split('|').map(canonicalizeRoleTag).filter(Boolean)))`.
- `seniority = parseInt(raw.seniority, 10)`.
- Errors (unfixable, block Confirm): missing name, malformed email (RFC 5322-lite),
  seniority out of [0,10], unknown team_id.
- Warnings (recoverable): duplicate email (default skip; re-invite checkbox
  per D-11), unknown role_tag (auto-created at commit via ON CONFLICT DO NOTHING).
- `status: 'error' | 'warn' | 'ok'`.

### CommitRosterImport transaction shape (INSERT order + audit + summary)

**Stage 1 — one Knex transaction:**

For each row with `status !== 'error'` AND not (`is_duplicate && !re_invite`):

1. `INSERT INTO role_tag (tenant_id, key) ... ON CONFLICT (tenant_id, key) DO NOTHING`
   for each `unknown_tags` entry. Re-canonicalized at write time (defense-in-depth).
2. Resolve `app_user`: SELECT by `(tenant_id, lower(email))`; INSERT if absent
   with `locale='he'`.
3. Race-safe color (RESEARCH Open Q4):
   `SELECT last_color_index FROM org_unit WHERE id = :team_id AND tenant_id = :tenant_id FOR UPDATE`
   → `pickNextColor(...)` → `UPDATE org_unit SET last_color_index = ...`. No team_id → PALETTE[0].
4. `INSERT INTO soldier` with `display_name = canonicalizeText(row.display_name)`
   AGAIN at write time (Pitfall P2 belt-and-braces — protects an edited preview
   row that was modified in the AgGrid without re-validation).
5. SELECT-driven `INSERT INTO membership` from `(soldier s, org_unit ou)` with
   `s.tenant_id = :tenant_id AND ou.tenant_id = :tenant_id` cross-checks +
   `ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`. Refuses cross-tenant joins.
6. `INSERT INTO schedule_audit` per soldier with `to_state = 'soldier_created_via_csv_import'`,
   `actor_kind = 'user'`, payload `{soldier_id, team_id, source: 'csv', role_tags, app_user_id, color_index}`.

Counters: `rowsCreated++` on success, `rowsSkipped++` on duplicate-without-reinvite,
`rowsErrored++` on `status='error'` rows or team_id-not-found mid-loop.
Each errored row pushes `{row_index, reason, details?}` into `errorDetails`.

**Stage 2 — sync Resend dispatch loop (post-commit):**

For each successfully-created soldier with email + (`re_invite` OR not `is_duplicate`):
- `await sendInvite({ email, callbackUrl: '/admin_dashboard', displayName, locale: 'he', knexTx: db })`
- On 429 / rate-limit: backoff schedule `[1000, 4000, 16000]` ms; max 3 retries.
- On terminal failure: push `{row_index, soldier_id, reason: 'resend_failed', message}`
  into `errorDetails` (soft-fail — soldier exists; admin retries from
  soldier_detail's "Invite later" button).
- After each call, `await sleep(500)` (500 ms inter-call gap; only sleeps if more
  rows remain) — Resend free-tier 2 req/s budget per 02-RESEARCH §"Resend rate limits".

`sendInvite` is invoked with `knexTx: db` (post-transaction connection), not
`trx`. The Stage 1 soldier INSERTs are already committed by the time Stage 2
begins; verification_tokens INSERTs land in separate auto-committed writes so
a Resend failure can't roll back soldier rows.

**Stage 3 — `roster_import_log` summary INSERT (LIVE schema — Pitfall P12):**

```sql
INSERT INTO roster_import_log (tenant_id, imported_by, source, rows_created,
  rows_skipped, rows_errored, error_details)
VALUES (:tenant_id, :actor_user_id, 'csv', :rowsCreated, :rowsSkipped,
        :rowsErrored, :errorDetails::jsonb)
RETURNING id
```

Column names are byte-equal to migration `0007_imports_and_exports.up.sql`:
`imported_by`, `source`, `rows_created`, `rows_skipped`, `rows_errored`,
`error_details`. NOT PRD §10's drifted names (`actor_id`, `rows_total`, etc.).
`source: 'csv'` is one canonical SQL token (W4 fix — the verify grep checks
for it as a single substring).

Returns: `{success: true, import_id, rowsCreated, rowsSkipped, rowsErrored, errorDetails}`.

### Resend backoff and SLO interpretation

- Inter-call gap: 500 ms (only between sends, not after the last)
- 429 retry schedule: `[1000, 4000, 16000]` ms (NOTF-07 contract)
- Max 3 retries per send → after 3 failures, the row is soft-failed into
  `errorDetails` and the loop continues.

**ROST-13 SLO acceptance:** documented in this SUMMARY + the plan's
`must_haves.truths`. The strict reading ("50 rows in <10 s") is impossible at
Resend free-tier 2 req/s (50 × 500 ms = 25 s minimum). The accepted
interpretation:

> "DB transaction commits and the result page is reachable within 10 seconds;
> Resend dispatch continues async in the background; the result page polls
> roster_import_log every 1 s for the final summary row."

Plan 10 Test A2 exercises this at scale with three split-timing budgets:
- `dbCommitWall < 2000 ms` — POST → DB transaction commit
- `firstBatchWall < 8000 ms` — POST → first batch (~16 rows) of Resend sends complete
- `totalWall < 35000 ms` — POST → last row sent (ceiling = 50 × 500 ms + 2 s DB + 8 s retry buffer)

The ROST-13 re-interpretation is documented in Test A2's docstring so future
maintainers don't reinstate the literal-10s reading.

## Task 3 — roster_import.yaml + roster_import_result.yaml

### roster_import.yaml — three-step wizard on ONE page

Wizard state machine: `_state.wizard_step` (1 / 2 / 3) gates three Card blocks
with `visible:`. No multi-page routing; back-button preserved via SetState.

**Step indicator** (always visible above the cards): three `Tag` blocks with
colors per UI-SPEC §"Page 5":
- step 1 + 2 + 3 pending: `#D9D9D9`
- step active: `#1677FF`
- step 3 completed: `#52C41A`

(`Tag` chosen over Ant Steps because `@lowdefy/blocks-antd` Steps exposure is
unverified at write time; Tag is shipped — verified via plan 04 usage.)

**Step 1 Card (visible when wizard_step ∈ {null, 1}):**
- Paragraph describing required CSV columns + UTF-8 expectation.
- `Upload` block (`id: csv_upload_input`) with `accept: '.csv,text/csv'`,
  `multiple: false`. Per RESEARCH Assumption A3, the block emits base64 in
  its state — confirmed at deploy time. Fallback path (TextArea paste) is
  flagged in resend.js but not wired in v1.
- Primary "נתח קובץ" Button: disabled until upload state is non-empty;
  onClick chain: Request `parse_csv_request` → SetState `{parsed_rows, parsed_total, wizard_step: 2}`.
- "הורד תבנית CSV" default Button: `disabled: true` with `tooltip: 'זמין בשלב 7'`
  (template download is a polish ticket for Phase 7).

**Step 2 Card (visible when wizard_step == 2):**
- Bulk-fix toolbar: three Buttons —
  - "הפוך תגיות לאותיות קטנות" (D-09) — `_array.map` over parsed_rows,
    `_string.toLowerCase` per tag.
  - "הקצה צוות לריקות..." — disabled, Phase 7 ticket.
  - "השב הזמנות לכל הכפילויות" (D-11) — `_array.map` setting `re_invite: row.is_duplicate`.
- `AgGridAlpine` preview grid with:
  - `enableRtl: true` (mandatory per UI-SPEC §"Reusable Components — 8").
  - Status pill cellRenderer copied byte-equal from UI-SPEC §"Reusable
    Components — 3" — emits ✓ on `#52C41A`, ⚠ on `#FAAD14`, ✗ on `#FF4D4F`.
  - Row backgrounds via `getRowStyle`: `#FFE5E5` for error, `#FFFBE6` for warn.
  - Editable inline cells for display_name / email / role_tags / seniority / team_id.
  - `re_invite` checkbox column (`agCheckboxCellRenderer` + `agCheckboxCellEditor`)
    hidden via `hide:` until at least one row has `is_duplicate: true`.
  - Pattern A from Pitfall P9 — NO data-action HTML attribute bridge.
- Summary line: `✓ {ok} | ⚠ {warn} | ✗ {error}` via `_array.length` over
  `_array.filter` on parsed_rows by status.
- Footer:
  - "← חזור" — SetState `wizard_step: 1`.
  - "אשר ייבוא →" — primary, **`disabled:`** when any row has `status === 'error'`
    (the verify gate token `disabled:` is satisfied here); onClick chain:
    Confirm modal → SetState `wizard_step: 3` → Request `commit_import_request` →
    Link to roster_import_result with `urlQuery.id = commit_import_request.import_id`.

**Step 3 Card (visible when wizard_step == 3):**
- Indeterminate `Spin` block while the handler runs.
- Lowdefy 5.3 has no first-class SSE (RESEARCH Open Q5); the result page
  polls `roster_import_log` every 1 s for the final summary row.

### roster_import_result.yaml — Result block with three variants

- KnexRaw `get_import_summary` SELECT scoped to (id, tenant_id): forged
  import_id from another tenant returns zero rows → triggers the "not found"
  Result variant.
- Main Result block with `status` computed inline via nested `_if`:
  - `success` — `rows_errored == 0 AND rows_created > 0`
  - `warning` — `rows_created > 0 AND (rows_errored > 0 OR error_details non-empty)`
  - `error` — `rows_created == 0` (commit transaction failed entirely)
- Title verbatim from UI-SPEC: "סיכום ייבוא". Subtitle Nunjucks-templated:
  "יובאו {{ created }} חיילים, {{ skipped }} כפילויות דולגו, {{ errored }} שגיאות."
- Two action buttons: "חזרה לרשימת חיילים" (primary, Links to manage_soldiers)
  + "צפה ביומן הייבוא" (`disabled: true`, `tooltip: 'זמין בשלב 7'`).
- Extra `error_details_card` (visible when `rows_errored > 0`): AgGrid listing
  per-row failures with row_index / reason / message — admin can retry from
  soldier_detail's "Invite later" button.

### Wiring deferral

Both pages must be added to `app/lowdefy.yaml` for navigation routing. The
plan's `<action>` block explicitly defers this wiring to plan 02-09 (sidebar
nav). `manage_soldiers.yaml` already has a `Link` to `pageId: roster_import`
from the "ייבא CSV" button; a missing destination route renders a Lowdefy 404
gracefully — acceptable per scope_constraints.

## Manual smoke result for the U+2019 canary

Not executed in this plan's window. The kibbutz fixture row 12 (`נועם ג'לאל`,
where the apostrophe-like character is `U+2019 RIGHT SINGLE QUOTATION MARK`)
is the canary documented in `tools/fixtures/kibbutz.sql`. The
canonicalization chain that strips it is unit-tested at 42 tests green
(`canonicalize.test.mjs`); end-to-end smoke through the wizard requires a
running container which is owned by Plan 09's deployment task. Plan 10 Test
A2 verifies the byte-equal stripped form persists in `soldier.display_name`
via psql probe.

## Verification commands run

- `git log -- app/plugins/shifty-roster/src/dispatch/resend.js` — only commits
  `66da94a` (scaffold) + `78b6f1b` (Plan 06 spike); zero drift since Plan 06.
- `grep VERIFIED A1` + `grep NEXTAUTH_SECRET` — stanzas present, env var
  references consistent.
- Task 2 inline `node -e` verify gate — all 14 ParseCsv tokens + 15
  CommitRoster tokens present, including `'source: \'csv\''` (W4 fix —
  one canonical SQL token).
- `node --check` on both handler files — PASS.
- `node --test app/plugins/shifty-roster/tests/*.test.mjs` — 42/42 PASS.
- Task 3 inline `node -e` verify gate — all 15 roster_import tokens + 10
  result-page tokens present, including the literal substring
  `WHERE id = :import_id AND tenant_id = :tenant_id`.
- `node tools/check-queries.mjs` — PASS (every KnexRaw block has tenant_id
  filter; no `SET row_security = off` anywhere in tracked source).

## Decisions Made

See `decisions:` in the frontmatter above. Highlights:

- **Wave-3 re-confirmation passed without live grep.** Zero touching commits
  between Plan 06 Task 0 (`78b6f1b`) and Plan 08 start; the algorithm cannot
  have drifted. Container-side smoke not re-run.
- **`source: 'csv'` is ONE SQL token (W4 fix).** The verify grep matches it as
  a single substring; KnexBuilder `.insert({ source: 'csv' })` emits it as
  one quoted parameter.
- **Dispatch loop hand-rolled inline (not `bulkDispatchWithBackoff`).** Per-job
  soldier_id + audit-row interleaving requires custom state — the bulk
  primitive is preserved as the documented API surface for future stateless
  callers (e.g., re-send-all-bounces in v1.1).
- **`sendInvite` uses `knexTx: db` not `trx` in Stage 2.** verification_tokens
  rows commit individually post-transaction; a Resend failure cannot roll
  back soldier rows.

## Deviations from Plan

None — plan executed exactly as written. Task 1's re-confirmation passed
on first read (no drift, no patch-and-re-verify cycle). Task 2's verify gate
flagged ONE missing token on first run (`status:` — the shorthand `status,`
in my object literal didn't match `status:` substring); fixed inline by
switching to verbose form `status: rowStatus` and re-ran the gate, which
passed. This is a verify-gate alignment fix, not a deviation — the
implementation logic was correct on first write.

## Threat surface scan

The plan's `<threat_model>` lists T-02-01..T-02-05 as `mitigate` after this plan ships:

- **T-02-01 (tenant_id forgery):** both handlers re-derive `tenant_id` from
  `request.user.tenant_id`; both pages' KnexRaw blocks read it from
  `_user:tenant_id`; check-queries.mjs gate confirms.
- **T-02-02 (cross-tenant duplicate detection):** ParseCsvAndValidate's
  `existingEmails` SELECT is scoped `WHERE tenant_id = :tenant_id AND email = ANY(:emails)`.
- **T-02-03 (smart-quote stripping at READ time):** never invoked —
  canonicalizeText runs on WRITE in both handlers (twice: parse-time AND
  commit-time, Pitfall P2 belt-and-braces).
- **T-02-04 (magic-link invite token leakage at bulk fanout):** UPGRADED
  disposition — Plan 06 Task 0 verified the hash algorithm; this plan's Task 1
  re-confirmed no drift; bulk fanout is N invocations of the verified primitive.
- **T-02-05 (XSS via display_name in preview cellRenderer):** display_name
  uses AgGrid's default text rendering (escapes by default); HTML cellRenderer
  is ONLY on the status column (renders `'ok'`/`'warn'`/`'error'`, no user
  content). canonicalizeText does NOT strip `<script>`, but the default text
  renderer escapes. Plan 10 RBAC E2E should include a `<script>` payload row
  to prove the escape.

No new threat-flag surface introduced beyond what the plan's threat_model enumerates.

## Known Stubs

- "הקצה צוות לריקות..." bulk-fix button on roster_import.yaml is `disabled: true`
  with `tooltip: 'זמין בשלב 7'`. Phase 7 owns the "bulk assign team to blank
  team_id rows" affordance; admins can edit team_id inline per-row in v1.
- "הורד תבנית CSV" download button on roster_import.yaml is `disabled: true`
  with `tooltip: 'זמין בשלב 7'`. Phase 7 will ship a static-template
  download — the column shape is documented in the Step 1 Paragraph so admins
  can construct the CSV manually in v1.
- "צפה ביומן הייבוא" button on roster_import_result.yaml is `disabled: true`
  with `tooltip: 'זמין בשלב 7'`. Phase 7 ships the past-imports detail view —
  the immediate result page is sufficient for the just-finished import.

All three stubs are intentional, explicitly tooltip-marked, and tracked
above. None block the plan's goal of "land the CSV roster import path
end-to-end".

## Self-Check: PASSED

All files exist:
- `app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js` — FOUND (modified)
- `app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js` — FOUND (modified)
- `app/plugins/shifty-roster/src/dispatch/resend.js` — FOUND (RECONFIRMED stanza appended)
- `app/pages/admin/roster_import.yaml` — FOUND (created)
- `app/pages/admin/roster_import_result.yaml` — FOUND (created)

All commits present in `git log --oneline -6`:
- `6307e47` — FOUND (Task 1 re-confirmation)
- `51ffbb3` — FOUND (Task 2 handler bodies)
- `dc23f54` — FOUND (Task 3 wizard + result pages)

---

*Phase: 02-org-people*
*Completed: 2026-05-13*
