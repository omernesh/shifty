---
phase: 03-availability-rules
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - tools/budibase-cli/src/login.mjs
  - tools/budibase-cli/src/client.mjs
  - tools/budibase-cli/src/dump.mjs
  - tools/budibase-cli/src/smoke-roundtrip.mjs
  - tools/budibase-cli/src/dump-configs.mjs
  - tools/budibase-cli/src/apply-tenantid.mjs
  - tools/budibase-cli/src/diagnose-binding.mjs
  - tools/budibase-helpers/build.mjs
  - tools/budibase-helpers/src/canonicalize.js
  - tools/budibase-helpers/src/palette.js
  - tools/budibase-helpers/src/role-tag.js
  - tools/budibase-helpers/src/availability-source.js
  - tools/check-bb-queries.mjs
  - tools/snapshot-budibase.ps1
  - tools/test/check-bb-queries.test.mjs
  - tests/unit/bundle-shifty-global.spec.ts
  - tests/unit/canonicalize.spec.ts
  - tests/unit/color-palette.spec.ts
  - tests/unit/role-tag-canonical.spec.ts
findings:
  critical: 3
  warning: 9
  info: 6
  total: 18
status: gaps_found
---

# Phase 3 (Wave 0): Code Review Report

**Reviewed:** 2026-05-18
**Depth:** standard
**Files Reviewed:** 18 (note: list contains 19; `tools/budibase-helpers/build.mjs` is one of the 18 source files plus the .ts/.mjs tests)
**Status:** gaps_found

## Summary

Wave-0 tooling for the post-Lowdefy pivot is largely sound: the pure-function helper ports (`canonicalize.js`, `palette.js`, `role-tag.js`, `availability-source.js`) are verbatim ports with consistent test coverage, and `check-bb-queries.mjs` (the new top-defense Layer-2 CI gate) is well-tested with a self-test mode that runs offline.

However, three Critical issues require attention before any subsequent wave depends on this tooling:

1. **`dump.mjs` writes datasource connection objects (which include the Postgres password) to stdout** — operators following the documented usage (`> snapshot.json`) end up with cleartext database creds in a JSON file. No redaction.
2. **`snapshot-budibase.ps1` ships a hard-coded SSH password as a default parameter value** (`'Onclaude2103'`). Anyone with read access to the repo learns the canonical hpg5 SSH credential.
3. **`apply-tenantid.mjs` Step 4 will always fail in any future re-execution** because `{{ Current User.* }}` bindings do not resolve via `POST /api/queries/<id>` per the documented W0-02 spike finding. Re-running the script (it advertises itself as idempotent) leaves a non-deterministic outcome: idempotent path skips it, non-idempotent path always exits 5 — meaning the script is silently broken for any future tenant change.

Warnings flag the `EXEMPT_QUERIES` semantic gap (no scope to specific app/query-id, so a malicious clone in another app inherits exempt status by name collision), the `dump.mjs` swallow-all-errors loop hiding real failures, the `Object.freeze` on `SOURCE_RANK` that the bundle test correctly does not assume but the JSDoc implies, and Windows/PowerShell-specific issues in `snapshot-budibase.ps1` (path-with-spaces handling on the local checkout, race condition in atomic-move pattern, missing `Stop-Transcript`/error path leaving credentials on disk if a throw fires between steps 2 and 8).

## Critical Issues

### CR-01: `dump.mjs` writes Postgres password into the snapshot JSON

**File:** `tools/budibase-cli/src/dump.mjs:18-26`
**Issue:** The loop iterates over `['datasources', 'screens', 'automations', 'queries', 'tables', 'roles']` and calls `c.list(resource)` for each. The Budibase Internal API endpoint `GET /api/datasources` returns each datasource's `config` object, which for the Postgres datasource includes the cleartext `password` field used to connect to Shifty's business-data database (the `POSTGRES_PASSWORD` from hpg5 `.env`). The script then `JSON.stringify`s the entire `dump` object straight to stdout — and the documented usage in the file header is `node /cli/src/dump.mjs <appId> > snapshot.json`, which produces a file on the operator's workstation containing the database password.

Compare with `dump-configs.mjs:48-52`, which explicitly redacts user fields with a "DO NOT log password hashes / private fields" comment and returns a summary shape. `dump.mjs` has no such filter.

If anyone subsequently commits a `snapshot.json` to the repo (the README pattern invites it), the database password is now in git history.

**Fix:**
```javascript
// In dump.mjs, after collecting `datasources`, scrub the secret fields before
// emitting. The fields Budibase populates in `config` include `password`,
// `username` (sometimes), `ssl.cert`, and possibly bearer tokens for non-PG
// datasources. Belt-and-braces — drop the whole `config` from the dump and
// keep only the metadata the caller actually needs for diffing.
if (Array.isArray(dump.datasources)) {
  dump.datasources = dump.datasources.map(ds => ({
    _id: ds._id,
    name: ds.name,
    source: ds.source,
    plus: ds.plus,
    // entities + relations are non-secret schema metadata — keep them
    entities: ds.entities,
    relations: ds.relations,
    // Replace config with a redaction sentinel; do NOT keep the cleartext password
    config: '<redacted: contains cleartext datasource password — fetch via Budibase API directly if needed>',
  }));
}
```
Also add a top-of-file warning in the JSDoc that the snapshot must not be committed and the README should advise gitignoring `snapshot.json` patterns.

### CR-02: Hard-coded SSH password as PowerShell default parameter

**File:** `tools/snapshot-budibase.ps1:85`
**Issue:** The script declares `[string]$HpgPassword = $(if ($env:HPG_SSH_PASSWORD) { $env:HPG_SSH_PASSWORD } else { 'Onclaude2103' })`. The fallback literal is the canonical hpg5 SSH password for the `claude` account. While CLAUDE.md does document this password publicly inside the repo, normalizing it as a script default value:

1. Makes it trivially discoverable to anyone with `git clone` access (a single grep, not a doc read).
2. Means a contributor who unknowingly forgets to set `$env:HPG_SSH_PASSWORD` quietly authenticates using the canonical credential — there is no "fail loudly" path.
3. The same applies to `$HpgHostKey` on line 86 — pinning is correct, but having the fingerprint as a default rather than a required input means a future hostkey rotation needs a code edit, not a config change.

The script's own comment on line 50–51 explicitly says "Prefer setting `$env:HPG_SSH_PASSWORD` so the password never appears in shell history or script source" — but then violates that exact guidance two lines later.

**Fix:**
```powershell
# Remove the literal fallback. Fail loudly if HPG_SSH_PASSWORD is unset.
[Parameter(Mandatory = $false)]
[string]$HpgPassword = $env:HPG_SSH_PASSWORD,
...
# Guard near the top of the script body:
if ([string]::IsNullOrWhiteSpace($HpgPassword)) {
    throw 'HPG_SSH_PASSWORD env var is required (or pass -HpgPassword). See CLAUDE.md "SSH access" for the canonical credential.'
}
```
The hostkey fingerprint can stay as a default since it is a public verification value, not a secret.

### CR-03: `apply-tenantid.mjs` Step 4 will always fail on any future re-run

**File:** `tools/budibase-cli/src/apply-tenantid.mjs:68-102`
**Issue:** Step 4 creates a disposable query whose SQL is `SELECT '{{ Current User.shiftyTenantId }}'::uuid AS resolved;`, executes it via `POST /api/queries/<id>` (the Builder API path), and exits 5 if the result is not the sentinel UUID. Per the project context provided for this review and per `tools/budibase-cli/SPIKE-FINDINGS.md`, `{{ Current User.* }}` bindings only resolve at published-app runtime; they resolve to `null` (and `'null'::uuid` throws) when executed via the Builder API path.

Two practical consequences:

1. **The script is non-idempotent in the failure direction.** The first run succeeded (per W0-02 SUMMARY) because step 2 PATCHed the tenant ID, but Step 4 was supposed to verify the binding — the verify step happened to also pass during the spike, then later analysis showed the binding doesn't actually resolve via this path. If a future operator runs this script to re-apply (e.g., after a tenant ID rotation), step 2 is correctly idempotent on line 39, but step 4 will exit 5 — and the `console.error` message ("This means {{ Current User.shiftyTenantId }} does NOT resolve from a schemaless field") is now misleading: it doesn't mean the field doesn't resolve at runtime, it means the binding can't be tested this way at all.

2. **The `try { … } finally { cleanup }` block on lines 84–102 contains `process.exit(5)` inside the `try`.** On Node.js, `process.exit()` runs the `finally` block synchronously before terminating (this is correct semantic), so cleanup is attempted — but the cleanup itself uses `await fetch(...)` and `console.log(...)` (lines 99–101). When `process.exit()` is called, the event loop is drained synchronously and pending microtasks are flushed, BUT outgoing HTTP requests in flight are aborted. Whether the DELETE actually reaches Budibase before the process exits is racy and undefined. Re-runs may leave orphan `_W0_02_BINDING_TEST_DELETE_ME` queries, which then have to be cleaned up by `diagnose-binding.mjs` (which does include this cleanup, confirming the orphan-leak is real).

**Fix:** Step 4 should be deleted from this script entirely. The binding verification belongs in a separate, manually-invoked diagnostic (which `diagnose-binding.mjs` already is) — and the diagnostic's own conclusion is that the Builder-API path cannot verify Current-User bindings. Replace lines 68–102 with a clear log line:
```javascript
console.log(`\n[4] SKIPPED — binding test against the Builder API is known to return null`);
console.log(`     for {{ Current User.* }} bindings (see SPIKE-FINDINGS.md). Verify the`);
console.log(`     binding resolves by visiting the published app at /app/<slug> and`);
console.log(`     observing the value in a Builder UI data binding preview.`);
```
At minimum, if Step 4 stays in the file as living documentation of the spike outcome, rename the file to make it explicit (e.g., `apply-tenantid-with-FAILING-binding-probe.mjs`) so future operators do not run it expecting it to work.

## Warnings

### WR-01: `EXEMPT_QUERIES` matches only on bare name — silently inherits across apps

**File:** `tools/check-bb-queries.mjs:79-82,210-212`
**Issue:** The exemption check is `exemptSet.has(query.name)`. In `main_default`, the gate iterates all applications returned by `listApplications`, and for each app's queries calls `validateQuery` with the same global `exemptSet`. If an attacker creates a second Budibase app (or a legitimate developer creates a feature-flag clone) that happens to contain a query named `resolveInviteCode_GetTenantId` with arbitrary unfiltered SQL, that query is treated as exempt without question. There is no scoping to `(appId, queryName)` or `(appId, queryId)`.

In the post-pivot world where Budibase apps may multiply (dev workspace + per-tenant workspace + staging clone), this is a real-shaped bypass: name-collision exempts. The W0-04 plan touched on this but the implementation chose the simpler scope.

**Fix:** Either (a) scope exemptions to `(appName, queryName)` tuples in `EXEMPT_QUERIES`, or (b) restrict the gate to a single canonical app ID (`SHIFTY_APP_ID` env var) and refuse to scan additional apps:
```javascript
// Option (a) — tuple-scoped exemptions
export const EXEMPT_QUERIES = [
  { app: 'shifty', name: 'resolveInviteCode_GetTenantId' },
  { app: 'shifty', name: 'insertAppUserOnInviteRedemption' },
];
function isExempt(appName, queryName, exemptList) {
  return exemptList.some(e => e.app === appName && e.name === queryName);
}
```

### WR-02: `dump.mjs` swallows per-resource errors silently

**File:** `tools/budibase-cli/src/dump.mjs:19-24`
**Issue:** The `try/catch` records `dump[resource] = { error: e.message }` on failure but otherwise lets execution continue. If, for example, the cookie expires mid-loop and every subsequent resource fetches return 401, the resulting JSON has `{error: "GET /api/screens: HTTP 401 — …"}` for every resource — and the script still exits 0 with what looks like a successful dump. A caller diffing two snapshots may not notice the dump is half-empty.

**Fix:** After the loop, if any resource resulted in an `error` field, log a warning to stderr and exit non-zero. The dump JSON can still be emitted to stdout but the operator gets a clear signal:
```javascript
const errored = Object.entries(dump).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && v.error);
if (errored.length > 0) {
  console.error(`dump.mjs: ${errored.length} resource(s) failed: ${errored.map(([k]) => k).join(', ')}`);
  console.log(JSON.stringify({ appId: APP_ID, capturedAt: new Date().toISOString(), ...dump }, null, 2));
  process.exit(3);
}
```

### WR-03: `client.mjs` truncates error body to 300 chars — loses diagnostic context

**File:** `tools/budibase-cli/src/client.mjs:49-52`
**Issue:** On a non-2xx response the error message is `txt.slice(0, 300)`. Budibase's Internal API can return JSON error envelopes with stack-trace fields >300 chars; truncation cuts off the actual cause string. Operators have no way to see beyond what the wrapper let through. The 300-char limit appears arbitrary.

**Fix:** Either keep the full body (the caller catches and decides what to log), or attach the full text as a property on the error so structured logging can capture it:
```javascript
const err = new Error(`${method} ${path}: HTTP ${r.status}`);
err.status = r.status;
err.bodyText = txt;
throw err;
```

### WR-04: `apply-tenantid.mjs` sends entire user document on PATCH — re-introduces stale fields

**File:** `tools/budibase-cli/src/apply-tenantid.mjs:43-47`
**Issue:** The PATCH is `POST /api/global/users` with body `{ ...me, shiftyTenantId: SENTINEL_TENANT }`. The user object returned from `GET /api/global/users` includes every field — including `password` (hashed), `_rev`, and Budibase-managed timestamps. Round-tripping these means: (a) if the hash format changes between Budibase versions, this re-writes the old hash, (b) Budibase-managed fields could be inadvertently regressed if a race condition between read and write modified the user. The Budibase Internal API supports partial updates; sending the whole doc invites accidental rollback.

Also: the `users` list endpoint may have omitted secret fields by design (the dump-configs.mjs explicitly chose a summary projection — line 47–52), in which case the spread now LOSES fields rather than preserving them. Either way, the spread is the wrong shape for a partial update.

**Fix:** Either fetch the single user via `GET /api/global/users/${me._id}` (a complete doc, including `_rev`), then send only the necessary keys; or use the patch endpoint if Budibase exposes one. The script already does a `GET /api/global/users/${me._id}` at line 59 for verification — use that earlier to get the full doc, then spread that into the patch:
```javascript
const fullUserResp = await fetch(`${WORKER}/api/global/users/${me._id}`, { headers: HW });
if (fullUserResp.status !== 200) { /* error */ }
const fullMe = await fullUserResp.json();
const patch = { ...fullMe, shiftyTenantId: SENTINEL_TENANT };
```

### WR-05: `snapshot-budibase.ps1` — credential file leaks on mid-script throw

**File:** `tools/snapshot-budibase.ps1:163-192,251-259`
**Issue:** Step 2 (lines 163–192) writes `$HpgStageDir\budi.env` on hpg5 containing CouchDB and MinIO credentials. Step 8 (lines 251–259) removes that file. Any `throw` between line 192 and line 259 (steps 3, 4, 5, 6, 7) leaves `budi.env` on hpg5 with credentials in cleartext. The script header comment promises "credentials never persist on disk longer than the duration of one snapshot" — that promise is violated on any error path.

Examples of throws that skip cleanup:
- `throw "budi backups --export failed on $HpgHost (exit $LASTEXITCODE)"` (line 212)
- `throw "pscp failed (exit $LASTEXITCODE)"` (line 223)
- `throw "Tarball suspiciously small (...)"` (line 231)
- `throw "Tarball does not contain a couchdb/ directory ..."` (line 243)

**Fix:** Wrap steps 3–7 in `try { ... } finally { <step 8 cleanup> }`. PowerShell supports trap/finally:
```powershell
try {
    # steps 3–7 unchanged
} finally {
    Write-Host "[6/6] Cleaning up remote staging area ..."
    $CleanupScript = @"
Remove-Item -Force '$HpgStageDir\$ContainerTarballName' -ErrorAction SilentlyContinue
Remove-Item -Force '$HpgStageDir\budi.env' -ErrorAction SilentlyContinue
"@
    $Bytes2 = [System.Text.Encoding]::Unicode.GetBytes($CleanupScript)
    $EncodedCleanup = [Convert]::ToBase64String($Bytes2)
    & plink @PlinkArgs "powershell -NoProfile -EncodedCommand $EncodedCleanup" | Out-Null
}
```

### WR-06: `snapshot-budibase.ps1` — path-with-spaces breaks `Resolve-Path` on the local checkout

**File:** `tools/snapshot-budibase.ps1:101`
**Issue:** `$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path`. The local repo path on the reviewer's workstation is `C:\Projects\shifts manager\` (with a space). `Resolve-Path` itself handles the space, but downstream usage on line 106 (`$LocalTmpPath = Join-Path $ExportsDir "$TarballName.tmp"`) and line 222 (`pscp` invocation with `$LocalTmpPath`) does not quote the path. `pscp` accepts the path with spaces only when wrapped in quotes — when the PowerShell call operator `&` passes the variable as a positional arg, PowerShell handles quoting, but a path containing spaces still trips edge cases (notably when `$LocalTmpPath` happens to also contain a colon-prefix like `C:`).

The script has been seemingly tested only against the hpg5-side `C:\shifts-manager\` path (no spaces). Verify the local-side path-with-spaces case works:

**Fix:** Add a guard or use single-quoted arg arrays:
```powershell
# Belt and braces — wrap pscp invocation with explicit -- to terminate flag parsing
& pscp -pw $HpgPassword -hostkey $HpgHostKey -batch "--" "${HpgUser}@${HpgHost}:$RemoteTarballFwd" "$LocalTmpPath"
```
At minimum, add a test that exercises the path-with-spaces case so future regressions are caught.

### WR-07: `check-bb-queries.mjs` — `TENANT_FILTER_PATTERN` is bypassed by string interpolation

**File:** `tools/check-bb-queries.mjs:71-72,234`
**Issue:** The pattern requires the literal text `{{ Current User.shiftyTenantId }}`. A query author who wants to bypass the gate can write `WHERE tenant_id = '{{ "Current" + " User.shiftyTenantId" }}'::uuid` — Budibase's Handlebars-like template engine would still interpolate, but the regex won't match. Worse: the gate also misses the pattern if the SQL is built via the JS `transformer` field (Budibase supports a JS post-processor on queries that can re-shape the SQL or row data); the gate only inspects `fields.sql`.

This is less an injection-grade bypass and more a "the gate trusts authors to use the canonical form." Document this assumption or remove it.

**Fix:** Add a comment near `TENANT_FILTER_PATTERN` documenting the assumption ("queries must use the canonical literal binding; do not template-construct the binding name"). Also, the gate should fail if `query.transformer` is non-empty and the query references a domain table — the transformer is a vector for post-validation logic that could skew tenant filtering:
```javascript
// In validateQuery, after the "no domain table" check:
if (typeof query.transformer === 'string' && query.transformer.trim() !== 'return data' && query.transformer.trim() !== '') {
  return {
    violation: true,
    reason: `query has a non-trivial transformer (${query.transformer.length} chars) — manual review required; ` +
            `transformers can mutate row shape and bypass tenant filtering. Add an exemption with rationale if intended.`,
    table: referenced[0],
  };
}
```

### WR-08: `check-bb-queries.mjs` — `getDomainTables` does not handle multi-statement DROP or schema-qualified names

**File:** `tools/check-bb-queries.mjs:158-190`
**Issue:** The regexes are:
- Create: `/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi`
- Drop:   `/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi`

The DROP regex matches `DROP TABLE foo, bar, baz` as just `foo` (the comma-separated form is a single statement). If a future migration uses the comma syntax to drop multiple tables (postgres supports it), `bar` and `baz` stay in the domain-tables set even though they no longer exist in the schema — they become permanent false-positive violation sources (any query referencing them by their old name still fails the gate).

Also, the regex does not strip block comments (`/* ... */`) — only line comments. A `CREATE TABLE` inside a block comment would pollute the set.

**Fix:**
```javascript
// Strip block comments too
const stripped = content
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\n]*/g, '');
// Handle DROP TABLE a, b, c — split on commas inside the table list
const dropMultiPattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;
for (const m of stripped.matchAll(dropMultiPattern)) {
  const names = m[1].split(',').map(s => s.trim().replace(/^public\./, '').replace(/^"|"$/g, '').toLowerCase());
  for (const n of names) if (n) tables.delete(n);
}
```

### WR-09: `check-bb-queries.mjs` — `isMainModule()` Windows comparison can false-positive

**File:** `tools/check-bb-queries.mjs:120-126`
**Issue:** The function does `metaPath.endsWith(argPath) || argPath.endsWith(metaPath.replace(/^\/+/, ''))`. With `import.meta.url = file:///c:/projects/shifts%20manager/tools/check-bb-queries.mjs` and `argv[1] = node`, the second branch evaluates `'node'.endsWith('c:/projects/shifts manager/tools/check-bb-queries.mjs')` which is `false` — OK. But if a sibling tool happened to be invoked from inside this directory with a different argv (e.g., a test runner that imports check-bb-queries.mjs and is itself in `tools/check-bb-queries.test.mjs`), `metaPath.endsWith(argPath)` may match unexpected suffixes (a file named `tools/check-bb-queries.mjs.bak` for example). The risk is low but the logic is fragile.

Node 22 has `import.meta.filename` (no URL parsing required) — use it.

**Fix:**
```javascript
function isMainModule() {
  if (!process.argv[1] || !import.meta.filename) return false;
  // Both are native paths on Node 22+ — normalize case (Windows) and compare.
  return path.resolve(import.meta.filename).toLowerCase()
       === path.resolve(process.argv[1]).toLowerCase();
}
```
Requires importing `path` from `node:path`.

## Info

### IN-01: `availability-source.js` — `SOURCE_VALUES` is not frozen

**File:** `tools/budibase-helpers/src/availability-source.js:23-30`
**Issue:** `SOURCE_RANK` is frozen via `Object.freeze`. `SOURCE_VALUES = Object.keys(SOURCE_RANK)` is a regular array — callers can mutate or sort it in place. The bundle test (`bundle-shifty-global.spec.ts:94-99`) does `[...Shifty.SOURCE_VALUES].sort()`, which is safe because it copies first, but a Builder UI JS code block doing `Shifty.SOURCE_VALUES.sort()` would mutate the shared array.

**Fix:**
```javascript
export const SOURCE_VALUES = Object.freeze(Object.keys(SOURCE_RANK));
```

### IN-02: `canonicalize.js` — STRIP_REGEX uses literal Unicode chars in source

**File:** `tools/budibase-helpers/src/canonicalize.js:29`
**Issue:** `const STRIP_REGEX = /[’‎‏‪-‮]/g;` — the regex source literally contains U+2019 plus invisible bidi marks U+200E/U+200F/U+202A-U+202E. The comment above explicitly says "STRIP_REGEX uses explicit Unicode escape sequences in the source so any editor / file-encoding conversion preserves the codepoints faithfully" — but the code uses literal characters, not `‎`-style escapes. Any editor that auto-normalizes invisible characters (some IDE setups do this for files under git) silently corrupts the regex.

**Fix:** Make the comment match the code, OR (better) make the code match the comment:
```javascript
const STRIP_REGEX = /[’‎‏‪-‮]/g;
```
The escape-sequence form is robust to editor mangling.

### IN-03: `dump-configs.mjs` — magic admin email check via env

**File:** `tools/budibase-cli/src/dump-configs.mjs:13`
**Issue:** `const APP_ID = process.env.BB_APP_ID || 'app_dev_169e766804934fd18f2e20200d8fd22d';` — same hard-coded default appears in `apply-tenantid.mjs:19` and `diagnose-binding.mjs:8`. The default is a Budibase dev-instance app ID that will not exist on any fresh deploy; if a contributor runs these scripts against a freshly-bootstrapped hpg5 without setting `BB_APP_ID`, they hit confusing 404s instead of a "please set BB_APP_ID" error.

**Fix:** Require `BB_APP_ID` to be set, fail fast with a clear message. The hard-coded ID is a leak of dev-environment state into the tool, not a sane default.

### IN-04: `build.mjs` — synthesized entry file is racy under concurrent builds

**File:** `tools/budibase-helpers/build.mjs:30-49`
**Issue:** The script writes a temp entry at `.entry.mjs`, runs esbuild, and removes it in a `finally`. If two `npm run build:helpers` invocations run concurrently (CI parallelism, watch mode, etc.), the second `writeFileSync` clobbers the first, and the first `rmSync` removes the file before the second build finishes — esbuild then fails with ENOENT.

Probability is low in normal use but real.

**Fix:** Use a unique temp name:
```javascript
const entryPath = join(__dirname, `.entry-${process.pid}-${Date.now()}.mjs`);
```

### IN-05: `smoke-roundtrip.mjs` — exit code 2 in cleanup-failed path is ambiguous

**File:** `tools/budibase-cli/src/smoke-roundtrip.mjs:58-61`
**Issue:** The script exits 2 if cleanup fails, but exit code 2 is also conventionally used for "configuration error" (e.g., in `check-bb-queries.mjs:43-44`). There is no explicit exit-code legend in this file. A CI consumer treating exit 2 as "config error, abort the pipeline" misclassifies a leaked orphan query.

**Fix:** Document exit codes in the file header. Choose distinct codes for distinct failure classes (e.g., 0 = pass, 1 = test failure, 3 = cleanup failure).

### IN-06: `diagnose-binding.mjs` — no timeout on probe loop; can hang indefinitely

**File:** `tools/budibase-cli/src/diagnose-binding.mjs:78-81`
**Issue:** The script probes 6 hardcoded paths sequentially with no AbortController/timeout. If `budibase-worker:4003` is up but extremely slow (e.g., under load), the probe loop blocks indefinitely. Lower priority than `check-bb-queries.mjs:265-273` (which DOES timeout) because this is a manual diagnostic, not a CI gate, but the same pattern should be applied.

**Fix:** Adopt the `fetchWithTimeout` helper from `check-bb-queries.mjs` (or factor it into a shared module under `tools/`).

---

## Structural notes

No `<structural_findings>` block was provided in the prompt; this review is purely narrative.

The Wave-0 tooling is overall well-structured: the test/spec parallel layout is clean, the inline JSDoc consistently explains the "why" (the post-pivot design context shows up in nearly every file), and `tools/budibase-helpers/` correctly enforces the verbatim-port discipline (the .js files match the legacy/ originals' shape).

The most consequential issue is CR-01 (datasource password in snapshot JSON), because the documented usage pattern produces a file that contains a database credential and the file naturally ends up in operator workstations. Fix this before any other operator runs `dump.mjs`.

The second-most-consequential issue is CR-03 (apply-tenantid.mjs Step 4) because the script self-documents as idempotent but actually has a non-deterministic outcome on re-run. Either delete Step 4 or rename the script to flag the known-broken probe.

---

_Reviewed: 2026-05-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
