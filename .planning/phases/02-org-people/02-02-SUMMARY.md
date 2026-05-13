---
phase: 02-org-people
plan: 02
subsystem: shifty-roster plugin scaffold
tags: [phase-2, plugin, scaffolding, helpers, lowdefy]
requires:
  - phase-1 shifty-audit-writer plugin pattern (D-08)
  - phase-1 shifty-auth createRequire idiom
provides:
  - app/plugins/shifty-roster/ (full plugin tree)
  - 5 pure-JS helpers (palette + canonicalize + role-tag + dispatch/resend)
  - 7 request-handler stubs (frozen API surface)
  - 3 unit-test files (42 assertions, all green)
affects:
  - app/package.json (added shifty-roster, papaparse)
  - app/lowdefy.yaml (added shifty-roster plugin entry)
tech-stack:
  added:
    - papaparse@5.5.3 (CSV parser — used by plan 02-08)
  patterns:
    - createRequire(process.cwd() + '/package.json') for SDK resolution
    - Dynamic import('knex') inside handler body (test-friendly)
    - try/finally db.destroy() lifecycle on every handler
    - Static-property tail (.schema + .connectionType = 'Knex' + export default)
key-files:
  created:
    - app/plugins/shifty-roster/package.json
    - app/plugins/shifty-roster/src/types.js
    - app/plugins/shifty-roster/src/connections.js
    - app/plugins/shifty-roster/src/helpers/palette.js
    - app/plugins/shifty-roster/src/helpers/canonicalize.js
    - app/plugins/shifty-roster/src/helpers/role-tag.js
    - app/plugins/shifty-roster/src/dispatch/resend.js
    - app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js
    - app/plugins/shifty-roster/src/connections/requests/CommitRosterImport.js
    - app/plugins/shifty-roster/src/connections/requests/CreateSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/UpdateSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/ArchiveSoldier.js
    - app/plugins/shifty-roster/src/connections/requests/CreateMembership.js
    - app/plugins/shifty-roster/src/connections/requests/InviteLater.js
    - app/plugins/shifty-roster/tests/canonicalize.test.mjs
    - app/plugins/shifty-roster/tests/palette.test.mjs
    - app/plugins/shifty-roster/tests/role-tag.test.mjs
  modified:
    - app/package.json
    - app/lowdefy.yaml
decisions:
  - "PALETTE frozen byte-equal to UI-SPEC §'Color B' 24-element array; deepStrictEqual locks it (W3 fix)"
  - "canonicalize.js uses single STRIP_REGEX /[U+2019U+200EU+200FU+202A-U+202E]/g; preserves Hebrew gershayim U+05F4 and ASCII U+0027"
  - "role-tag canonicalizer chains through canonicalizeText (smart-quoted CSV cell normalizes identically to plain ASCII)"
  - "Dispatch helper centralizes Resend in src/dispatch/resend.js so plans 06+08 share one primitive"
  - "Token hash uses sha256(rawToken + NEXTAUTH_SECRET) per Assumption A1 — plan 08 owns 2h spike to verify against live next-auth source"
  - "Stubs return { todo: 'plan-NN' } placeholders; deep DB writes deferred to 06/07/08 per scaffold contract"
metrics:
  duration_minutes: 35
  tasks_completed: 4
  files_changed: 18
  test_assertions: 42
  completed_date: 2026-05-13
---

# Phase 2 Plan 02: shifty-roster Plugin Scaffold Summary

Stood up the `shifty-roster` Lowdefy custom plugin as a sibling to `shifty-auth` and `shifty-audit-writer`. The plugin centralizes every write-time defense for the Phase 2 roster pipeline: the 24-color palette (D-14, D-15), the smart-quote / bidi-mark canonicalizer (D-12), the role-tag kebab normalizer (D-13), and a shared Resend dispatcher with NOTF-07 backoff. Seven request-handler stubs freeze the API surface that pages 06–08 will consume; their guard clauses (tenant_id-from-session + actor_user_id + per-request property guards) are live now so the only thing plans 06/07/08 fill in is SQL bodies.

## Directory Tree Shipped

```
app/plugins/shifty-roster/
├── package.json                                    # ESM, exports map, deps: knex/papaparse/resend
├── src/
│   ├── types.js                                    # Registers 7 request types
│   ├── connections.js                              # Aggregator: re-exports all 7 handlers
│   ├── dispatch/
│   │   └── resend.js                               # sendInvite + bulkDispatchWithBackoff
│   ├── helpers/
│   │   ├── palette.js                              # FROZEN 24-color array + pickNextColor + colorByIndex
│   │   ├── canonicalize.js                         # canonicalizeText (D-12 strip set)
│   │   └── role-tag.js                             # canonicalizeRoleTag (chains canonicalizeText)
│   └── connections/requests/
│       ├── ParseCsvAndValidate.js                  # stub → plan 02-08
│       ├── CommitRosterImport.js                   # stub → plan 02-08
│       ├── CreateSoldier.js                        # stub → plan 02-06 (canonicalizes display_name)
│       ├── UpdateSoldier.js                        # stub → plan 02-06
│       ├── ArchiveSoldier.js                       # stub → plan 02-06
│       ├── CreateMembership.js                     # stub → plan 02-07
│       └── InviteLater.js                          # stub → plan 02-06
└── tests/
    ├── canonicalize.test.mjs                       # 16 assertions
    ├── palette.test.mjs                            # 13 assertions
    └── role-tag.test.mjs                           # 13 assertions
```

## FROZEN 24-Color PALETTE (UI-SPEC §"Color B")

The `PALETTE` exported by `app/plugins/shifty-roster/src/helpers/palette.js` is byte-equal to this list. The unit test `palette.test.mjs` asserts `assert.deepStrictEqual(PALETTE, EXPECTED_PALETTE)` against the literal 24-element array (W3 fix — uniqueness+length alone is not enough; the FROZEN ORDER is the adjacency identifier persisted to `org_unit.last_color_index`).

```
[0]  #1F77B4   [1]  #FF7F0E   [2]  #2CA02C   [3]  #D62728
[4]  #9467BD   [5]  #8C564B   [6]  #E377C2   [7]  #7F7F7F
[8]  #BCBD22   [9]  #17BECF   [10] #AEC7E8   [11] #FFBB78
[12] #98DF8A   [13] #FF9896   [14] #C5B0D5   [15] #C49C94
[16] #F7B6D2   [17] #C7C7C7   [18] #DBDB8D   [19] #9EDAE5
[20] #393B79   [21] #637939   [22] #8C6D31   [23] #843C39
```

`pickNextColor(lastIndex)` returns `(lastIndex + 2) % 24`; sentinel `-1` / `null` / `undefined` returns `0`. The even-stride keeps adjacent assignments visually distinct (D-15).

## Strip-Regex Literal (D-12 / ROST-11)

```javascript
const STRIP_REGEX = /[U+2019 U+200E U+200F U+202A-U+202E]/g;
```

The actual source literal in `canonicalize.js` line 30 uses the codepoints inline:

```javascript
const STRIP_REGEX = /[’‎‏‪-‮]/g;
```

Strip set:
- U+2019 RIGHT SINGLE QUOTATION MARK
- U+200E LEFT-TO-RIGHT MARK
- U+200F RIGHT-TO-LEFT MARK
- U+202A LEFT-TO-RIGHT EMBEDDING
- U+202B RIGHT-TO-LEFT EMBEDDING
- U+202C POP DIRECTIONAL FORMATTING
- U+202D LEFT-TO-RIGHT OVERRIDE
- U+202E RIGHT-TO-LEFT OVERRIDE

Preserves (asserted by tests): Hebrew gershayim U+05F4, ASCII apostrophe U+0027, ASCII double-quote U+0022, all letters in any script.

The canonicalizer also applies NFC normalization and collapses internal whitespace runs to a single space.

## 7 Request Handlers (API Frozen — SQL Bodies Owned by Downstream Plans)

| Handler | Required Props | Owner Plan | Purpose |
|---|---|---|---|
| `ParseCsvAndValidate` | `file_b64` | **plan 02-08** | papaparse + canonicalize + dedup pre-flight; returns `{ rows: [...], total }` |
| `CommitRosterImport` | `rows` | **plan 02-08** | Transactional INSERT batch + Resend bulk-dispatch + roster_import_log write (ROST-13 SLO <10s/50rows) |
| `CreateSoldier` | `display_name` | **plan 02-06** | Single-row create with pickNextColor + canonicalize + schedule_audit |
| `UpdateSoldier` | `soldier_id` | **plan 02-06** | Update with manager-only notes gate + schedule_audit |
| `ArchiveSoldier` | `soldier_id` | **plan 02-06** | `UPDATE soldier SET status='archived'` (preserves membership rows per D-08) |
| `CreateMembership` | `soldier_id`, `team_id` | **plan 02-07** | Atomic INSERT membership + UPDATE org_unit.last_color_index |
| `InviteLater` | `email` | **plan 02-06** | Re-dispatch magic-link invite via shared dispatch/resend.js |

Each handler enforces the T-02-01 mitigation pattern verbatim:
- `request.user.tenant_id` (Layer 4) — throws on missing
- `request.user.user_id` (actor identity) — throws on missing
- Per-handler property guards on REQUIRED fields only
- Dynamic `import('knex')` + `try { ... } finally { await db.destroy(); }`

## Unit Test Counts

```
$ node --test app/plugins/shifty-roster/tests/canonicalize.test.mjs \
              app/plugins/shifty-roster/tests/palette.test.mjs \
              app/plugins/shifty-roster/tests/role-tag.test.mjs

# tests 42
# pass 42
# fail 0
```

- **canonicalize.test.mjs (16 assertions):** kibbutz canary `נועם ג'לאל → נועם גלאל`; each of 7 stripped codepoints (U+2019, U+200E, U+200F, U+202A, U+202B, U+202C, U+202D, U+202E); gershayim U+05F4 preserved; ASCII apostrophe + double-quote preserved; null/undefined → `''`; NFC + whitespace collapse; numeric coercion.
- **palette.test.mjs (13 assertions):** **byte-equal `deepStrictEqual` against the literal 24-element FROZEN array (W3 fix)**; length 24; every entry matches `/^#[0-9A-F]{6}$/i`; no duplicates; `pickNextColor` for sentinels `-1`/`null`/`undefined`/wraparound at 22→0 and 23→1; `colorByIndex` boundary fallback to PALETTE[0].
- **role-tag.test.mjs (13 assertions):** lowercase, spaces→dashes, underscore→dash, leading/trailing dash strip, multi-dash collapse, smart-quote chain (`medic's → medics`), DB-CHECK regex compliance, leading-digit boundary documentation.

## Plugin Dual-Declaration (Pitfall P3 Compliance Confirmed)

```diff
--- a/app/lowdefy.yaml
+++ b/app/lowdefy.yaml
@@ -15,6 +15,8 @@ plugins:
     version: 'file:../../plugins/shifty-auth'
   - name: 'shifty-audit-writer'
     version: 'file:../../plugins/shifty-audit-writer'
+  - name: 'shifty-roster'
+    version: 'file:../../plugins/shifty-roster'

 connections:
   - _ref: connections/shifts_db.yaml

--- a/app/package.json
+++ b/app/package.json
@@ -17,7 +17,9 @@
     "resend": "6.12.3",
     "shifty-auth": "file:./plugins/shifty-auth",
     "shifty-audit-writer": "file:./plugins/shifty-audit-writer",
+    "shifty-roster": "file:./plugins/shifty-roster",
     "knex": "^3.1.0",
-    "nodemailer": "^6.9.0"
+    "nodemailer": "^6.9.0",
+    "papaparse": "5.5.3"
   }
 }
```

The two path forms intentionally differ:
- `app/package.json` → `file:./plugins/shifty-roster` (relative from `app/package.json`)
- `app/lowdefy.yaml` → `file:../../plugins/shifty-roster` (relative from `.lowdefy/server/` — Lowdefy's `addCustomPluginsAsDeps.js` writes this verbatim into the server's inner package.json; the path must resolve from that location, NOT from the lowdefy.yaml file's directory)

This intentional asymmetry is captured in Phase 1 P02 STATE.

## Commits

| Hash | Subject |
|------|---------|
| `66da94a` | feat(02-02): scaffold shifty-roster plugin manifest + dispatch helper |
| `fe5a6c7` | test(02-02): unit tests + helpers for canonicalize, palette, role-tag |
| `ef5e2fb` | feat(02-02): add 7 request-handler stubs for shifty-roster plugin |
| `e91f4e3` | feat(02-02): wire shifty-roster plugin in package.json + lowdefy.yaml |

## Decisions Made

- **PALETTE frozen byte-equal to UI-SPEC §"Color B".** The `deepStrictEqual` assertion in `palette.test.mjs` is the load-bearing guard against silent re-tuning. Adjacency identifiers persisted to `org_unit.last_color_index` reference these indices.
- **`canonicalize.js` strip set encoded inline (not via Unicode escape literals)** for readability. Tests assert each codepoint individually so future encoding mishaps will surface immediately.
- **`role-tag.js` chains through `canonicalizeText` FIRST** so a smart-quoted CSV cell (`medic's`) normalizes identically to its plain ASCII counterpart (`medics`). Single source of truth: smart-quote stripping happens once.
- **`dispatch/resend.js` centralizes Resend invocation.** Plans 06 (InviteLater) and 08 (bulk dispatch) share one `sendInvite({ email, callbackUrl, displayName, locale, knexTx })` primitive plus one `bulkDispatchWithBackoff(rows, onProgress)` wrapper with NOTF-07 backoff schedule `[1000, 4000, 16000]` ms and ~500 ms inter-row pacing (Resend free-tier ~2 req/s).
- **Token hash = `sha256(rawToken + NEXTAUTH_SECRET)`** as a best-current-understanding implementation per Assumption A1 (RESEARCH §"Magic-Link Invites"). Plan 08 owns the 2-hour spike to verify against the live `node_modules/next-auth/...` source BEFORE shipping the bulk-invite path. Documented in `resend.js` header comment so plan 08 cannot miss it.
- **Stubs return `{ todo: 'plan-NN' }`** placeholders rather than throwing. This lets downstream YAML wire to the handlers and exercise the API shape during development; the deep SQL bodies fill in cleanly per the locked frozen surface.

## Deviations from Plan

None — plan executed exactly as written. All 4 tasks, all verify gates, all 42 unit tests, all guard-clause smoke tests green on first attempt. No Rule-1/2/3 fixes triggered. No auth gates reached.

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already enumerates:
- T-02-01 (tenant_id forgery): mitigated by every handler's `request.user.tenant_id` guard (no `.schema` property accepts `tenant_id`).
- T-02-03 (write-time canonicalization): mitigated by `canonicalizeText` invocation in `CreateSoldier` stub (proves wiring); plans 06/07/08 will invoke it inside their UPDATE/INSERT bodies.
- T-02-04 (token leakage): accepted with verification spike, see Assumption A1 documentation in `dispatch/resend.js` header.
- T-02-06 (role escalation): mitigated by `canonicalizeRoleTag` output constraint matching the DB CHECK regex `^[a-z][a-z0-9-]*$` (asserted in test).

## Self-Check: PASSED

- `app/plugins/shifty-roster/package.json` — FOUND
- `app/plugins/shifty-roster/src/types.js` — FOUND
- `app/plugins/shifty-roster/src/connections.js` — FOUND
- `app/plugins/shifty-roster/src/dispatch/resend.js` — FOUND
- `app/plugins/shifty-roster/src/helpers/palette.js` — FOUND
- `app/plugins/shifty-roster/src/helpers/canonicalize.js` — FOUND
- `app/plugins/shifty-roster/src/helpers/role-tag.js` — FOUND
- 7 request handlers in `app/plugins/shifty-roster/src/connections/requests/` — ALL FOUND
- 3 test files in `app/plugins/shifty-roster/tests/` — ALL FOUND (42 assertions, 100% pass)
- `app/package.json` modified — FOUND `shifty-roster` and `papaparse` entries
- `app/lowdefy.yaml` modified — FOUND `shifty-roster` plugin block
- `app/.dockerignore` unchanged — `pnpm-workspace.yaml` still excluded (regression guard preserved)
- Commits `66da94a`, `fe5a6c7`, `ef5e2fb`, `e91f4e3` — ALL PRESENT in `git log --oneline`
