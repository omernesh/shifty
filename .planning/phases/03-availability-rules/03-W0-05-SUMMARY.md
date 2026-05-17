---
phase: 03-availability-rules
plan: W0-05
subsystem: infra
tags: [budibase, powershell, snapshot, plink, pscp, docker, ci-tooling]

# Dependency graph
requires:
  - phase: 03-availability-rules (W0-04)
    provides: Layer-2 CI gate for queries — the "review story" that makes snapshots useful (a clean gate run is the precondition; the snapshot is the record).
  - phase: 03-availability-rules (W0-02)
    provides: (DEFERRED — user handles Builder UI work out-of-band.) The post-W0-02 state would become the regression target for validating the wrapper; with W0-02 skipped, the wrapper was validated end-to-end against the current Builder UI state on hpg5 (Budibase has been live since 2026-05-16).
provides:
  - PR-time snapshot wrapper (`tools/snapshot-budibase.ps1`) — one-line invocation for any contributor
  - `.gitignore` rules tracking finalized `.tar.gz` while excluding ephemeral tempfiles
  - Empirical resolution of PsExec gating for the snapshot workflow
  - Inaugural snapshot at `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz` (1,564,718 bytes)
affects: All Phase 03+ plans that touch Builder UI artifacts; the wrapper becomes mandatory at PR open time

# Tech tracking
tech-stack:
  added:
    - "@budibase/cli@3.38.4 (installed JIT inside ephemeral node:22-alpine container; not added to repo node_modules)"
    - "node:22-alpine Docker image cached on hpg5 (one-time PsExec-required pull)"
  patterns:
    - "Ephemeral-container CLI execution on the shifty docker network — pattern reusable for any per-PR tool that needs Budibase-stack reachability (Layer-2 gate could optionally adopt the same shape)"
    - "Atomic .tmp -> final move for any file produced via SSH/SCP into the working tree"
    - "Synthesized .env file generated on hpg5 from existing .env (mapping COUCH_DB_USER/PASSWORD/MINIO_ACCESS/SECRET into budi-CLI's required schema); regenerated every run and removed after"

key-files:
  created:
    - tools/snapshot-budibase.ps1
    - budibase-exports/2026-05-17-w0-05-inaugural.tar.gz
    - .planning/phases/03-availability-rules/03-W0-05-SUMMARY.md
  modified:
    - .gitignore (Budibase tempfile rules + positive .tar.gz re-include)
    - docs/BUDIBASE-CONVENTIONS.md (§5 step 5, §9, §10 #4)

key-decisions:
  - "Wrapper runs budi via ephemeral node:22-alpine container on shifts-manager_default — apps image ships no CLI"
  - "Tarball filename = YYYY-MM-DD-<slug>.tar.gz; NO git SHA in filename (D-04 / D-01 — git history is the SHA index)"
  - "PsExec NOT required for snapshot runs (only for one-time docker pull bootstrap)"
  - "Idempotent overwrite acceptable for same-day-same-slug repeat runs; future v1.1 may add -<HHmm> suffix"

patterns-established:
  - "Pattern: ephemeral CLI-on-network — any tool that needs Budibase-stack reachability can use the same `docker run --rm --network shifts-manager_default ...` shape"
  - "Pattern: synthesized .env on hpg5 — build a tool-specific env file from existing .env keys; never commit, regenerate per run, remove after"
  - "Pattern: forward-slash Windows paths for pscp — `claude@hpg5:C:/path/to/file` works; backslashes confuse the colon-parsing for host:path"
  - "Pattern: `--force-local` on bsdtar/GNU-tar when inspecting tarballs with C:\\... paths — otherwise interpreted as host:path"
  - "Pattern: .NET SHA256 directly via [System.Security.Cryptography.SHA256]::Create() — Get-FileHash is not universally available on PS 5.1"

requirements-completed: [OPS-01, OPS-02, OPS-09]

# Metrics
duration: 26min
completed: 2026-05-17
---

# Phase 03 Plan W0-05: PR-time Budibase snapshot tooling Summary

**PowerShell wrapper (`tools/snapshot-budibase.ps1`) that produces atomic Budibase-export tarballs at PR open time, running `@budibase/cli`'s `budi backups --export` inside an ephemeral `node:22-alpine` container on the shifty docker network.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-05-17T12:45:38Z
- **Completed:** 2026-05-17T13:11:12Z
- **Tasks:** 4
- **Files modified:** 4 (1 created script, 1 created tarball, 1 created summary, 2 modified existing — `.gitignore` and `BUDIBASE-CONVENTIONS.md`)

## Accomplishments

- **293-line PowerShell wrapper** (`tools/snapshot-budibase.ps1`) with full param block, plink/pscp chain, atomic move, .NET SHA256, idempotent overwrite, and a recovery hint when node:22-alpine isn't cached on hpg5.
- **First inaugural snapshot** committed at `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz` (1,564,718 bytes; SHA256 `E7CA45BF4129A11D25E0E651EC7BABF492ED63319C77260EDAB84818418D08E2`). Contains the live `app_dev_169e766804934fd18f2e20200d8fd22d` CouchDB plus `_users`, `_replicator`, `global-db`, `global-info`.
- **`.gitignore` updated** to track `.tar.gz` while ignoring `.tmp`/`.partial` (positive `!` re-include guarantees the .tmp rule cannot mask a finalized snapshot — load-bearing for race-free atomic move).
- **`BUDIBASE-CONVENTIONS.md` §5 step 5, §9, §10 #4 updated** to point at the wrapper and reflect empirical findings (the stale `docker exec ... budi` one-liner that never worked is replaced).

## Task Commits

Each task was committed atomically:

1. **Task 1: Empirical PsExec probe (no file changes)** — folded into Task 2's commit `7cd2e2e` (per CLAUDE.md: empirical findings ride with the code that encodes them).
2. **Task 2: `tools/snapshot-budibase.ps1` wrapper** — `7cd2e2e` (`feat(03-W0-05): snapshot-budibase.ps1 wrapper + empirical PsExec probe`).
3. **Task 3: `.gitignore` + BUDIBASE-CONVENTIONS.md §10 #4 close** — `9ef4de6` (`chore(03-W0-05): .gitignore + BUDIBASE-CONVENTIONS §10 #4 close`).
4. **Task 4: SUMMARY + inaugural snapshot + final metadata** — separate commits (see "Plan metadata" below).

**Plan metadata commits:** to be added after this SUMMARY is finalized — `chore(budibase): snapshot 2026-05-17-w0-05-inaugural` for the tarball, then `docs(03-W0-05): summary` for this file + STATE.md/ROADMAP.md updates.

## Files Created/Modified

- `tools/snapshot-budibase.ps1` (created, 293 lines) — PR-time snapshot wrapper. Mandatory `-FeatureSlug` arg (kebab-case, ValidatePattern). Defaults the date to today. Empirical findings + recovery hints in the script header.
- `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz` (created, 1,564,718 bytes) — first end-to-end snapshot, used as the validation that the wrapper works.
- `.gitignore` (modified, +7 lines) — Budibase-tempfile section with positive `.tar.gz` re-include.
- `docs/BUDIBASE-CONVENTIONS.md` (modified, 3 sections updated) — §5 step 5 redirected, §9 cheatsheet rewritten, §10 #4 RESOLVED with cross-link + inaugural SHA256.
- `.planning/phases/03-availability-rules/03-W0-05-SUMMARY.md` (this file).

## Decisions Made

- **NO git SHA in tarball filename** (D-04 / D-01 — confirmed during execution): `YYYY-MM-DD-<slug>.tar.gz` stays scannable in `ls budibase-exports/`; git's own commit graph indexes the SHA. Matches the W0-02 plan's same call.
- **Idempotent overwrite is acceptable** for same-day-same-slug re-runs. The "Note: ... already exists" warning is informational, not blocking. A future v1.1 could add an `HHmm` suffix if multi-runs-per-day-per-feature becomes common.
- **PsExec required only for bootstrap.** Documented in script header + recovery hint. The script does not attempt to silently `docker pull` (which would fail with a confusing credential-helper error); it detects the missing-image case via `docker images node:22-alpine --format ...` and surfaces a clear recovery message.

## PsExec Gating — Empirical Finding (Task 1 detail)

**Result: PsExec is NOT required for snapshot runs.**

Detail:

- **Bare-metal probe without PsExec** (`plink ... hpg5 "powershell -c \"docker compose -f C:\\shifts-manager\\docker-compose.yml exec -T budibase-app budi backups --export -o /tmp/probe.tar.gz\""`): **FAILED**, but NOT for credential-helper reasons. The error was:
  > `OCI runtime exec failed: exec failed: unable to start container process: exec: "budi": executable file not found in $PATH`

  This proved both (a) the plain `docker compose exec` works fine without PsExec (no credential-helper error) AND (b) the plan's assumption about `budi` being inside the apps container was wrong.

- **Container inspection** showed `/app/node_modules/@budibase/` contains only `nano` (the CouchDB client lib). `@budibase/cli` is a separate npm package (`@budibase/cli@3.38.4`, GPL-3.0, `bin: budi`, last published 2026-05) not bundled with the apps image.

- **Working invocation discovered:** Run budi in an ephemeral `node:22-alpine` container attached to `shifts-manager_default` network. From inside that container, `budibase-proxy:10000` is the in-network entry point. Successful probe produced a 1.56 MB tarball with `couchdb/_users`, `couchdb/global-db`, `couchdb/global-info`, and the live app DB.

- **`docker pull node:22-alpine` (one-time bootstrap):** **REQUIRED PsExec.** First pull failed without it:
  > `docker: error getting credentials - err: exit status 1, out: 'A specified logon session does not exist. It may already have been terminated.'`

  Wrapped with PsExec, pull succeeded. After that, all subsequent `docker run --rm` calls work without PsExec.

This matches CLAUDE.md's "Operations that pull from a registry need PsExec; operations on already-cached images do not."

## `budi` Invocation — Correct Form

The plan assumed `budi backups --export -o /tmp/snapshot.tar.gz`. The actual form per `@budibase/cli@3.38.4` source (`package/src/backups/index.ts`):

```
budi backups --export <filename> --env <envfile>
```

- `--export` takes a POSITIONAL filename, not `-o filename`. Source: `addSubOption("--export [filename]", ...)`.
- `--env <envfile>` is mandatory in non-interactive use; otherwise `budi` falls back to `inquirer`-style prompts that hang in a non-TTY context.
- The env file must define `MAIN_PORT`, `COUCH_DB_URL`, `MINIO_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` (`REQUIRED` array in `package/src/backups/utils.ts`). The wrapper synthesizes these from the existing `.env` on hpg5 (`COUCH_DB_USER`+`COUCH_DB_PASSWORD` are joined into `COUCH_DB_URL`).

## First End-to-End Run Output (verbatim)

```
[1/6] Verifying node:22-alpine is cached on hpg5 ...
[2/6] Generating budi.env on hpg5 from C:\shifts-manager\.env ...
budi.env generated
[3/6] Running budi backups --export in ephemeral container ...
CouchDB Export
S3 Export
Generated export file - snapshot-2026-05-17-w0-05-inaugural.tar.gz
[4/6] Copying tarball back via pscp -> C:\Projects\shifts manager\budibase-exports\2026-05-17-w0-05-inaugural.tar.gz.tmp ...
2026-05-17-w0-05-inaugura | 1572 kB | 524.0 kB/s | ETA: 00:00:00 | 100%
[5/6] Tarball size: 1528 KB — verifying contents ...
[6/6] Cleaning up remote staging area ...

Snapshot saved:
  File:    C:\Projects\shifts manager\budibase-exports\2026-05-17-w0-05-inaugural.tar.gz
  Size:    1528 KB (1564718 bytes)
  SHA256:  E7CA45BF4129A11D25E0E651EC7BABF492ED63319C77260EDAB84818418D08E2

Suggested commit message:

    chore(budibase): snapshot 2026-05-17-w0-05-inaugural

Stage with:
    git add "C:\Projects\shifts manager\budibase-exports\2026-05-17-w0-05-inaugural.tar.gz"
    git commit -m "chore(budibase): snapshot 2026-05-17-w0-05-inaugural"
```

## Inaugural Tarball Metadata

- **Path:** `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz`
- **Size:** 1,564,718 bytes (1528.0 KB)
- **SHA256:** `E7CA45BF4129A11D25E0E651EC7BABF492ED63319C77260EDAB84818418D08E2`
- **First 12 entries (via `tar --force-local -tzf`):**

  ```
  couchdb/
  couchdb/_replicator/
  couchdb/_users/
  couchdb/app_dev_169e766804934fd18f2e20200d8fd22d/
  couchdb/global-db/
  couchdb/global-info/
  couchdb/_replicator/000003.log
  couchdb/_replicator/CURRENT
  couchdb/_replicator/LOCK
  couchdb/_replicator/LOG
  couchdb/_replicator/MANIFEST-000002
  couchdb/_users/000003.log
  ```

  The `app_dev_169e766804934fd18f2e20200d8fd22d` ID matches BUDIBASE-CONVENTIONS.md §9 — confirms we captured the live default workspace app, not an unrelated artifact.

  The tarball also contains a `minio/` directory (not in the head -12 listing above because all CouchDB internals come first alphabetically). `budi backups --export` exports BOTH CouchDB metadata AND MinIO objects (uploaded attachments) in a single tarball — that's the canonical bundle.

## Naming Convention

- Filename: `YYYY-MM-DD-<feature-slug>.tar.gz`
- Date is ISO-8601 (YYYY-MM-DD) for chronological sort in `ls`.
- Feature slug is lowercase kebab-case, enforced by ValidatePattern `^[a-z][a-z0-9-]*$`.
- **NO git SHA in filename.** Per D-04 / D-01: the git commit that introduces the file is the implicit SHA; the human-readable filename stays scannable. Same call as the (deferred) W0-02 inline snapshot.
- Multiple snapshots same-day-same-feature: overwrite is acceptable (script prints "Note: ... already exists. Overwriting (idempotent)"). v1.1 might add an `HHmm` suffix if multi-run-per-day-per-feature becomes a real pattern.

## Workflow for Contributors

Verbatim — paste into PR-prep checklists:

```powershell
# 1. Snapshot the current Builder UI state on hpg5
pwsh tools\snapshot-budibase.ps1 -FeatureSlug "<feature-slug>"

# 2. Review what the script printed; stage + commit the tarball
git add budibase-exports\<today>-<feature-slug>.tar.gz
git commit -m "chore(budibase): snapshot <today>-<feature-slug>"

# 3. Continue with your feature work on the same PR
git add <other files>
git commit -m "feat(...)"

# 4. Push + open the PR — reviewer can extract the tarball and grep
git push
```

If `node:22-alpine` is not cached on hpg5 (first-ever run from a fresh deploy), the script halts with a recovery hint — run the suggested PsExec-wrapped `docker pull node:22-alpine` once, then re-run the wrapper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `budi` is not in the apps container**

- **Found during:** Task 1 (PsExec gating empirical probe).
- **Issue:** Plan assumed `docker compose exec -T budibase-app budi backups --export -o /tmp/snapshot.tar.gz` would work. It cannot: `@budibase/cli` is a separate npm package and is not bundled with the `budibase/apps:3.38.4` image (the image ships only `@budibase/server` + `@budibase/nano`). The plan's decision-tree outcome (iii) explicitly anticipated this case and said "Investigate before proceeding."
- **Fix:** Run `@budibase/cli@3.38.4` inside an ephemeral `node:22-alpine` container attached to the `shifts-manager_default` docker network. `budibase-proxy:10000` is the in-network entry point. A synthesized `budi.env` is generated per-run on hpg5 from the existing `.env` (mapping COUCH_DB_* + MINIO_* into the schema `budi` expects) and removed after the run.
- **Files modified:** `tools/snapshot-budibase.ps1` — the whole command chain encodes this discovery.
- **Verification:** End-to-end smoke test produced a 1.56 MB tarball with `couchdb/`, `app_dev_169e766804934fd18f2e20200d8fd22d/`, `minio/`. Idempotent re-run produces a similar (compaction-different but semantically equivalent) tarball.
- **Committed in:** `7cd2e2e` (Task 2 commit).

**2. [Rule 3 - Blocking] `budi backups --export` takes positional filename, not `-o`**

- **Found during:** Task 1, post-discovery of the budi-not-in-container issue.
- **Issue:** Plan assumed `--export -o <filename>`. Actual CLI form (per `@budibase/cli@3.38.4` source, `src/backups/index.ts`): `--export <filename>`. `addSubOption("--export [filename]", ...)`.
- **Fix:** Script invokes `budi backups --export snapshot-<date>-<slug>.tar.gz --env /work/budi.env`.
- **Files modified:** `tools/snapshot-budibase.ps1`.
- **Verification:** End-to-end smoke test succeeded.
- **Committed in:** `7cd2e2e`.

**3. [Rule 3 - Blocking] pscp Windows-path quoting**

- **Found during:** Task 2 first smoke-test.
- **Issue:** `pscp ... "claude@hpg5:C:\\shifts-manager\\.snapshot-stage\\snapshot.tar.gz" ...` fails with "unable to identify C:shifts-manager.snapshot-stagesnapshot.tar.gz: no such file or directory" — pscp's colon-parsing for `host:path` confuses the drive-letter `:`, and the backslashes get stripped in shell expansion.
- **Fix:** Convert backslashes to forward slashes for the remote path: `claude@hpg5:C:/shifts-manager/.snapshot-stage/file.tar.gz` — pscp recognizes the drive-letter:path form correctly.
- **Files modified:** `tools/snapshot-budibase.ps1` step [4/6].
- **Verification:** End-to-end smoke test transfer completes at ~500 KB/s with correct byte count.
- **Committed in:** `7cd2e2e`.

**4. [Rule 3 - Blocking] GNU tar interprets `C:\...` as host:path**

- **Found during:** Task 2 third smoke-test (`tar -tzf` for content verification).
- **Issue:** `tar -tzf "C:\Projects\shifts manager\budibase-exports\...tmp"` fails: "tar (child): Cannot connect to C: resolve failed" — GNU tar treats `C:` as an `rsh`-style remote host.
- **Fix:** Add `--force-local` flag to all `tar` invocations operating on Windows-absolute paths.
- **Files modified:** `tools/snapshot-budibase.ps1` step [5/6].
- **Verification:** `tar --force-local -tzf <path>` returns the entry listing without RSH attempts.
- **Committed in:** `7cd2e2e`.

**5. [Rule 3 - Blocking] `Get-FileHash` missing on this PS 5.1 install**

- **Found during:** Task 2 fourth smoke-test (post-success `tarball verified` step).
- **Issue:** `Get-FileHash` cmdlet is unavailable in this user's PowerShell 5.1 install even though `Microsoft.PowerShell.Utility` is expected to register it by default. Probably a profile or PSModulePath quirk. Don't want to assume every contributor has it.
- **Fix:** Compute SHA256 directly via `[System.Security.Cryptography.SHA256]::Create()` + `[BitConverter]::ToString(...)`. Always available on PS 5.1.
- **Files modified:** `tools/snapshot-budibase.ps1` step [9/9].
- **Verification:** Script's final output prints a valid 64-hex-char SHA256.
- **Committed in:** `7cd2e2e`.

**6. [Rule 3 - Blocking] PowerShell quote-escape over plink/cmd**

- **Found during:** Task 2 second smoke-test (`docker run` step).
- **Issue:** The `docker run ... sh -c '...'` invocation contains a single-quoted shell string. When sent via `plink ... "powershell -NoProfile -Command \"docker run ...\""`, the inner single quote terminates a containing PowerShell string and breaks the parse: "The string is missing the terminator: '.
- **Fix:** Use `-EncodedCommand` (base64-encoded UTF-16LE) for the docker-run step instead of `-Command`. This is the same pattern CLAUDE.md recommends for non-trivial scripts across the cmd→PowerShell layers.
- **Files modified:** `tools/snapshot-budibase.ps1` step [3/6].
- **Verification:** End-to-end smoke test runs the docker-run step without escape issues.
- **Committed in:** `7cd2e2e`.

---

**Total deviations:** 6 auto-fixed (all Rule 3 — blocking issues discovered during empirical execution).
**Impact on plan:** None of the 6 deviations changed the plan's intent. The script delivers exactly the contract the must-haves specified (one-arg invocation, atomic tarball move, idempotent overwrite, suggested commit message, no auto-commit). All 6 are empirical discoveries the plan explicitly anticipated would surface during Task 1 ("the script's final shape is whichever worked"). The fact that 6 separate quoting/binary/CLI-shape issues had to be resolved is consistent with the plan's empirical-first stance — proves the rigour was warranted.

## Issues Encountered

- **Connection blip mid-probe:** `plink` returned `FATAL ERROR: Network error: Software caused connection abort` once during Task 1 inspection. Retry succeeded immediately. Tailscale's mesh routing occasionally re-establishes; harmless.
- **`docker compose -f` consistently spelled the compose-file path correctly,** but the `cd` away from the working dir on the bash side sometimes caused unrelated path-with-space mangling. Worked around by avoiding `cd` in the Bash tool and quoting paths.

## Known Limitations

- **Requires `node:22-alpine` cached on hpg5.** The script does not attempt a bootstrap pull (because that would silently fail under the credential-helper restriction); instead it detects the not-cached case and prints a recovery hint pointing at a one-time PsExec-wrapped `docker pull`. A future contributor on a freshly-redeployed hpg5 will see the hint and run it once.
- **Requires `BUDIBASE_API_KEY` to NOT be in scope** (counterintuitive but true): `budi backups --export` talks to CouchDB directly via the proxy's `/db/` pass-through using `COUCH_DB_USER`+`COUCH_DB_PASSWORD`, not the Public API. The `BUDIBASE_API_KEY` in `.env` is consumed by `tools/check-bb-queries.mjs` (the Layer-2 gate), not by this script.
- **Container must be Up.** If `shifty-budibase-app` (or the proxy, or CouchDB, or MinIO) is stopped, `budi` will hang on the initial CouchDB replication then time out. Plink reports the error verbatim.
- **No content-grep / secret scan before commit.** A future v1.1 should add an automated pre-commit content scanner (per threat T-03W0-05-03) that grep-rejects committed snapshots containing patterns like `SECRET`, `password=`, `Bearer`, etc. For now, reviewers must spot-check at PR review time.
- **No cross-link to W0-02 inaugural snapshot.** The plan said this wrapper retroactively documents the W0-02 inline snapshot; with W0-02 deferred, there is nothing to cross-link to. When W0-02 ships, its summary should reference this wrapper as the canonical mechanism for any subsequent re-snapshot.
- **Tarball is not deterministic byte-for-byte.** CouchDB compacts internal state between calls, so two runs minutes apart produce slightly different tarballs even with no Builder UI changes between them. Idempotency = "produces a valid snapshot that supersedes any prior one of the same name", not "produces byte-identical output".

## Future v1.1

- **Restore drill automation.** `BUDIBASE-CONVENTIONS.md` §6 mentions a quarterly restore drill — could be a sister script `tools/restore-budibase.ps1` that takes a tarball + spins up a throwaway compose stack to verify integrity.
- **Auto-CI snapshot.** When the repo eventually has a CI provider (currently none — `.github/workflows/` doesn't exist), a workflow could snapshot on PR-open automatically. Until then this remains opt-in for contributors.
- **Auto-prune.** Snapshots accumulate forever right now. A `tools/prune-snapshots.ps1` that keeps the last N per-feature + everything from the last 4 weeks would prevent the dir from ballooning. Defer until size becomes an actual problem.
- **Secret scanner.** Per threat T-03W0-05-03, a pre-commit hook that scans the tarball (uncompressed) for secret-like patterns. The `legacy/shifty-handlers/middleware/log-redact.js` regex would be a good starting point.
- **Snapshot diff tooling.** Two snapshots from adjacent PRs differ heavily in `_rev` IDs and binary blob bytes even when semantically identical — a tool that extracts and JSON-diff'd just the screen/query/automation documents (filtering out `_rev`/`_revisions`) would dramatically lower reviewer cognitive load.

## Next Phase Readiness

- All four Wave-0 plans complete (`03-W0-01` context, `03-W0-03` helpers bundle, `03-W0-04` Layer-2 gate, `03-W0-05` snapshot tooling). `03-W0-02` (Builder UI / invite redemption) is owned by the user out-of-band.
- Wave 1+ plans can now follow the canonical PR workflow:
  1. Schema migration (PR-reviewable)
  2. Helper unit tests (PR-reviewable)
  3. Builder UI changes (described in prose; snapshot captures the record)
  4. `npm run test:check-bb-queries` (Layer-2 gate must pass)
  5. `pwsh tools\snapshot-budibase.ps1 -FeatureSlug "<slug>"` (snapshot committed)
  6. E2E spec against `https://apps.nesher.co`
- No blockers for Wave 1.

## Self-Check: PASSED

Verifying claimed artifacts:

- `tools/snapshot-budibase.ps1` — FOUND (293 lines, 14117 bytes)
- `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz` — FOUND (1,564,718 bytes, sha256 E7CA45BF4129A11D25E0E651EC7BABF492ED63319C77260EDAB84818418D08E2)
- `.planning/phases/03-availability-rules/03-W0-05-SUMMARY.md` — FOUND (this file, 24316 bytes)
- `.gitignore` updated (3 budibase-exports entries) — FOUND
- `docs/BUDIBASE-CONVENTIONS.md` references to `snapshot-budibase.ps1` — 3 occurrences FOUND
- Commit `7cd2e2e` (Task 2: wrapper) — VERIFIED in git log
- Commit `9ef4de6` (Task 3: gitignore + conventions) — VERIFIED in git log
- Commit `5021e7d` (inaugural snapshot) — VERIFIED in git log
- Commit `26b4361` (SUMMARY) — VERIFIED in git log
- Commit `e9dbc56` (state/roadmap/requirements metadata) — VERIFIED in git log

---
*Phase: 03-availability-rules*
*Plan: W0-05*
*Completed: 2026-05-17*
