---
phase: 03-availability-rules
fixed_at: 2026-05-18T00:00:00Z
review_path: .planning/phases/03-availability-rules/03-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 3 (Wave 0): Code Review Fix Report

**Fixed at:** 2026-05-18
**Source review:** `.planning/phases/03-availability-rules/03-REVIEW.md`
**Iteration:** 1
**Scope:** critical + warning (3 critical, 9 warning); Info findings (IN-01..IN-06) out of scope per orchestrator instruction.

**Summary:**
- Findings in scope: 12
- Fixed: 12
- Skipped: 0

All Critical and Warning findings were fixed. Unit tests (`npm run test:check-bb-queries-unit`) and self-test (`npm run test:check-bb-queries-selftest`) both green post-fix: 36/36 unit pass, 4/4 selftest pass. The unit-test suite grew from 23 to 36 cases through this pass (new cases cover WR-01 tuple-scoping, WR-07 transformer gate, WR-08 comma-DROP + block comments, and the `isExempt` helper).

## Fixed Issues

### CR-01: `dump.mjs` writes Postgres password into the snapshot JSON

**Files modified:** `tools/budibase-cli/src/dump.mjs`, `tools/budibase-cli/src/dump-configs.mjs`
**Commits:** `01199e8` (`dump.mjs`), `0beb964` (`dump-configs.mjs`)
**Applied fix:**
- `dump.mjs`: added `SECRET_CONFIG_KEYS` set (`password`, `apiKey`, `auth`, `token`) and a `redactDatasourceConfig` helper that walks `dump.datasources[*].config` and replaces matching values with the literal string `"[REDACTED]"`. The JSON shape stays valid for downstream tooling (diff, schema introspection). Added a SECURITY NOTE at the top of the file warning operators not to commit `snapshot.json`.
- `dump-configs.mjs`: extended the same pattern with a deep-walk `redactSecrets()` covering `password`, `apiKey`, `auth`, `token`, `clientSecret`, `secret`, `privateKey` keys (case-insensitive). Applied at the emit point so worker configs that include `google`/`oidc`/SMTP credentials are also redacted.
- `apply-tenantid.mjs` was checked per the orchestrator note: it currently only logs `_rev` and `shiftyTenantId` post-PATCH (the redaction does NOT need to extend there).

### CR-02: Hard-coded SSH password as PowerShell default parameter

**Files modified:** `tools/snapshot-budibase.ps1`
**Commit:** `3b560b6`
**Applied fix:** Dropped the literal `'Onclaude2103'` fallback from the `$HpgPassword` default expression. The parameter now sources its value exclusively from `$env:HPG_SSH_PASSWORD` (or an explicit `-HpgPassword` CLI arg). Added a fail-loudly guard near the top of the script body (after `Set-StrictMode`) that throws with a pointer to `CLAUDE.md "SSH access"` if neither is set. Verified no remaining `Onclaude` references in the file.

### CR-03: `apply-tenantid.mjs` Step 4 always fails on re-run

**Files modified:** `tools/budibase-cli/src/apply-tenantid.mjs`
**Commit:** `5d176e4`
**Applied fix:** Deleted the entire Step 4 try/finally block (~35 lines). Replaced with a 4-line `console.log` block pointing operators at `tools/budibase-cli/SPIKE-FINDINGS.md` and noting that binding verification must happen at published-app runtime (deferred to Phase 3 W1+). Removed the now-unused `APP_URL`, `APP_ID`, `PG_DS`, and `HA` constants — those were referenced only by the removed step. The `process.exit()`-inside-try cleanup race is eliminated because the try/finally is gone entirely (no async cleanup paths remain).

### WR-01: `EXEMPT_QUERIES` matches only on bare name — silently inherits across apps

**Files modified:** `tools/check-bb-queries.mjs`, `tools/test/check-bb-queries.test.mjs`
**Commit:** `2eae43f` (combined with WR-07; same files touched)
**Applied fix:** Refactored `EXEMPT_QUERIES` from `string[]` to `Array<{app: string, name: string}>`. The seed entries are scoped to the canonical dev app id (`app_dev_169e766804934fd18f2e20200d8fd22d`). Added an exported `isExempt(appId, queryName, exemptList)` helper for tuple matching. `validateQuery` gained a fourth `appId` parameter; `main_default` passes the current app's id; a backwards-compat shim accepts a `Set<string>` third arg so pre-existing unit tests keep their semantics. New unit tests cover same-app match, cross-app non-match, bare-name non-match, malformed list handling, and the W0-02 seed-shape invariant.

### WR-02: `dump.mjs` swallows per-resource errors silently

**Files modified:** `tools/budibase-cli/src/dump.mjs`
**Commit:** `01199e8` (combined with CR-01; same file touched)
**Applied fix:** After the loop, scan for resources whose value is an object with a string `.error` field. If any are found, emit the dump JSON to stdout as before but ALSO write a stderr line listing the failed resources and exit with code 3. Operators following the documented `> snapshot.json` pattern see the failure on stderr; `set -e` callers see a non-zero exit.

### WR-03: `client.mjs` truncates error body to 300 chars — loses diagnostic context

**Files modified:** `tools/budibase-cli/src/client.mjs`
**Commit:** `94b4177`
**Applied fix:** Construct a proper `Error` with `.status` (the HTTP status code) and `.bodyText` (the FULL response body) properties. The 300-char truncation is retained ONLY for the `.message` string so terminal output stays legible; structured-logging callers can still access the full text via `err.bodyText`.

### WR-04: `apply-tenantid.mjs` sends entire user document on PATCH — re-introduces stale fields

**Files modified:** `tools/budibase-cli/src/apply-tenantid.mjs`
**Commit:** `dd68c46`
**Applied fix:** Step 1 now fetches the canonical full user doc via `GET /api/global/users/<id>` (using the `_id` discovered from the list endpoint) before spreading it into the PATCH body. The list-endpoint projection may omit fields by design; spreading the canonical full doc guarantees the round-trip preserves every server-side field rather than the subset the list happened to project. The PATCH body spread is unchanged in shape — only its source is now the canonical doc.

### WR-05: `snapshot-budibase.ps1` — credential file leaks on mid-script throw

**Files modified:** `tools/snapshot-budibase.ps1`
**Commit:** `a2f0cb2`
**Applied fix:** Wrapped steps 5–7 (budi backups, pscp, tarball sanity checks — the throw-prone region between `budi.env` creation and the original step-8 cleanup) in a `try { ... } finally { ... }` block. The cleanup logic was migrated INTO the `finally` so the credential-bearing `budi.env` and the staging tarball are removed from hpg5 even when a throw fires from any of the wrapped steps. The plink invocation inside the finally is itself wrapped in `try/catch` so a secondary cleanup failure surfaces as `Write-Warning` rather than masking the original error. PowerShell parser validates the file post-fix.

### WR-06: `snapshot-budibase.ps1` — path-with-spaces breaks pscp on the local checkout

**Files modified:** `tools/snapshot-budibase.ps1`
**Commit:** `a4892fd`
**Applied fix:** Wrapped `$LocalTmpPath` in double quotes when passed to `pscp` so paths containing spaces (the local checkout lives at `C:\Projects\shifts manager\`) survive argv parsing. PowerShell's `&` call operator already handles argument quoting when the variable is wrapped in double quotes; the original passed it unquoted which let whitespace in the path split into multiple argv entries on some pscp builds.

### WR-07: `check-bb-queries.mjs` — `TENANT_FILTER_PATTERN` is bypassed by string interpolation

**Files modified:** `tools/check-bb-queries.mjs`, `tools/test/check-bb-queries.test.mjs`
**Commit:** `2eae43f` (combined with WR-01)
**Applied fix:** Added a transformer check inside `validateQuery`: if `query.transformer` is a non-empty string and (after trimming) NOT exactly `"return data"` (the canonical default), the query is flagged as a violation with the explanation that a JS post-processor can mutate row shape and bypass tenant filtering. Default-shape transformers (`""`, `"return data"`, `"  return data  \n"`) are accepted. Non-domain-table queries with a transformer still skip via the "no domain table referenced" path (the transformer check fires only AFTER the domain-table guard). Added 5 new unit tests + a selftest case covering this path. Also documented the "canonical-binding form is mandatory" assumption in a new comment near `TENANT_FILTER_PATTERN`.

### WR-08: `getDomainTables` does not handle multi-statement DROP or schema-qualified names

**Files modified:** `tools/check-bb-queries.mjs`, `tools/test/check-bb-queries.test.mjs`
**Commit:** `f88ea9e`
**Applied fix:** Replaced the bare-name DROP pattern with `dropMultiPattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi` which captures the entire table-list payload up to the terminating semicolon. The list is split on commas, each name has trailing `CASCADE`/`RESTRICT` modifiers + `public.` prefix + surrounding quotes stripped, and the lowercased result is removed from the set. Also extended comment stripping from line-only to BOTH `/* ... */` block comments AND `--` line comments, so a commented-out CREATE/DROP inside a block comment no longer pollutes the set. New unit tests use a temp migrations directory to exercise: bare `DROP TABLE foo, bar, baz;`, `DROP TABLE IF EXISTS alpha, beta, gamma CASCADE;`, and `CREATE TABLE` inside `/* … */`.

### WR-09: `check-bb-queries.mjs` — `isMainModule()` Windows comparison can false-positive

**Files modified:** `tools/check-bb-queries.mjs`
**Commit:** `c9e8940`
**Applied fix:** Replaced the dual `endsWith` heuristic with exact resolved-path equality: `path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])`, case-insensitive (Windows + macOS-HFS+ realities). `fileURLToPath` handles Windows `%20` decoding + drive-letter normalisation natively, eliminating the manual URL parsing. The suffix-match false-positive risk (e.g., a sibling `check-bb-queries.mjs.bak` triggering main) is now structurally impossible.

## Skipped Issues

None — all 12 in-scope findings were fixed.

## Manual followups

### SSH password rotation (CR-02 collateral)

The literal `'Onclaude2103'` was removed from `tools/snapshot-budibase.ps1` (commit `3b560b6`), but it remains documented in `CLAUDE.md "SSH access"` and (per `CLAUDE.md`) is the canonical hpg5 password the orchestrator user reads from there before setting `$env:HPG_SSH_PASSWORD`. Rotation of that credential is the operator's manual decision and out of scope for this fix pass. When/if rotated:

1. Pick a new password (this is a manual decision, NOT done by the agent).
2. Run `autologon claude DESKTOP-09VPJKQ <new-password>` on hpg5 to update the auto-login LSA secret (see `CLAUDE.md "Auto-login + autostart"`).
3. Update `CLAUDE.md "SSH access"` block to reference the new password.
4. Notify any team members using `plink ... hpg5 ...` invocations to update their `$env:HPG_SSH_PASSWORD`.
5. The Cloudflare Tunnel runs in a separate Windows user account and is unaffected.

There is intentionally NO automated rotation script — this is a low-frequency, manually-reviewed operation per `CLAUDE.md`.

### Info findings deferred (IN-01..IN-06)

Per orchestrator instruction, Info-level findings are out of scope for this fix pass. They are queued for a follow-up pass when prioritised:

- IN-01: `SOURCE_VALUES` not frozen (defensive immutability for shared array).
- IN-02: `STRIP_REGEX` uses literal Unicode chars in source (editor robustness; comment says one thing, code does another).
- IN-03: Hard-coded `app_dev_169e766804934fd18f2e20200d8fd22d` default in three CLI scripts (dev-instance leak).
- IN-04: `build.mjs` race under concurrent builds (use unique temp filename).
- IN-05: Exit code 2 ambiguity in `smoke-roundtrip.mjs` (documentation gap).
- IN-06: `diagnose-binding.mjs` probe loop has no timeout (manual diagnostic, lower priority than CI gates).

---

_Fixed: 2026-05-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
