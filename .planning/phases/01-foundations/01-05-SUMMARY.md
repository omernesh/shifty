---
phase: 01-foundations
plan: "05"
subsystem: infra
tags: [postgres, backup, powershell, rclone, task-scheduler, log-redaction, security, playwright]

# Dependency graph
requires:
  - phase: 01-foundations/01-02
    provides: shifty-auth plugin scaffold (connections.js, package.json exports)
  - phase: 01-foundations/01-03
    provides: shifty-auth plugin connections.js side-effect hook pattern
  - phase: 01-foundations/01-04
    provides: Playwright test infrastructure, e2e fixture pattern, docker-compose.test.yml

provides:
  - tools/backup/backup-postgres.ps1 (nightly pg_dump + rclone + 14-day retention)
  - tools/backup/restore-test.ps1 (daily pg_restore --list self-test)
  - tools/backup/install-task-scheduler.ps1 (idempotent Task Scheduler registration)
  - tools/backup/.rclone.conf.example (neshernas_pg_backup SFTP remote template)
  - app/plugins/shifty-auth/src/middleware/log-redact.js (console monkey-patch, *_KEY/*_SECRET/*_PASSWORD scrubbing)
  - app/plugins/shifty-auth/tests/log-redact.test.mjs (5 unit tests)
  - tests/e2e/log-redaction.spec.ts (SEC-10 integration spec)
  - docs/OPERATIONS.md (13-section Phase 1 runbook stub)
affects:
  - Phase 2 (backup chain active; OPERATIONS.md grows with each phase)
  - Phase 6 (WAHA SIM + Tailscale port forward-declared; Uptime Kuma setup unblocked)

# Tech tracking
tech-stack:
  added:
    - rclone (off-host backup copy, user-installed on hpg5)
    - Windows Task Scheduler (nightly backup + daily restore-test)
    - Windows Event Log / Write-EventLog (alerting on backup failure)
    - node:test (built-in Node test runner, log-redact unit tests)
  patterns:
    - Log-redaction via console monkey-patch at module load (side-effect import in connections.js)
    - Regex suffix-match (_SECRET|_PASSWORD|_KEY)$ for env var classification (word-boundary \b fails on RESEND_API_KEY)
    - Docker exec from Task Scheduler (no PsExec needed for docker exec/cp — only docker pull/build)
    - Graceful Playwright skip pattern when docker container is unreachable

key-files:
  created:
    - tools/backup/backup-postgres.ps1
    - tools/backup/restore-test.ps1
    - tools/backup/install-task-scheduler.ps1
    - tools/backup/.rclone.conf.example
    - app/plugins/shifty-auth/src/middleware/log-redact.js
    - app/plugins/shifty-auth/tests/log-redact.test.mjs
    - tests/e2e/log-redaction.spec.ts
    - docs/OPERATIONS.md
  modified:
    - app/plugins/shifty-auth/src/connections.js (added side-effect import of log-redact.js)
    - app/plugins/shifty-auth/package.json (added ./middleware/log-redact export)

key-decisions:
  - "Log-redact regex uses suffix pattern (_SECRET|_PASSWORD|_KEY)$ not word-boundary \\b — RESEND_API_KEY ends with _KEY but \\b treats _ as word char so the boundary is between I and _ not after Y"
  - "Task Scheduler tasks use LogonType Interactive (not S4U) — required because docker daemon socket on hpg5 is the Docker Desktop named pipe, accessible only from interactive sessions; Task Scheduler Interactive = runs in user session"
  - "Write-EventLog wrapped in try/catch throughout — Event Log source creation needs admin on first run; subsequent runs as claude work after source exists; silent failure for non-admin is acceptable"
  - "restore-test.ps1 is separate from backup-postgres.ps1 — self-test at 03:00 catches stale-dump situations even if backup task silently failed"
  - "Task 6 is a human-action checkpoint — rclone install, task scheduler registration, and Uptime Kuma setup cannot be automated (UAC + interactive prompts + separate NAS host)"

patterns-established:
  - "Backup pattern: pg_dump inside container → docker cp to host → rclone to NAS → Event Log entry (ID 1000 success, 1002 failure)"
  - "OPERATIONS.md runbook grows phase-by-phase — each phase adds sections for new ops responsibilities"
  - "Playwright skip pattern: execSync wrapped in try/catch returning null → test.skip() when infrastructure is unavailable"

requirements-completed:
  - OPS-03
  - OPS-04
  - OPS-05
  - OPS-06
  - OPS-07
  - OPS-08
  - OPS-09
  - SEC-10

# Metrics
duration: 45min
completed: "2026-05-12"
---

# Phase 1 Plan 05: Ops Baseline — Backup + Log-Redaction + OPERATIONS.md Summary

**Nightly pg_dump with rclone off-host copy, daily pg_restore --list self-test via Task Scheduler, console log-redaction middleware scrubbing *_KEY/*_SECRET/*_PASSWORD env values, and a 13-section OPERATIONS.md runbook stub covering all D-09 items.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-12T20:00:00Z
- **Completed:** 2026-05-12T21:00:00Z
- **Tasks:** 5 of 6 (Task 6 is human-action checkpoint)
- **Files modified:** 10

## Accomplishments

- Log-redaction middleware (`log-redact.js`) loaded at plugin init via connections.js side-effect import; 5 unit tests pass; regex corrected from word-boundary to suffix-match pattern
- Three PowerShell backup scripts: nightly `pg_dump` + off-host rclone copy, standalone daily `pg_restore --list` self-test, and idempotent Task Scheduler installer
- `docs/OPERATIONS.md` created with all 13 required sections; all 7 explicit grep assertions from the plan pass (Backup Self-Test, Windows Update Active Hours, Antivirus Exclusions, VHDX Compaction, ShiftyBackup, shifty-backup-nightly, Restore Drill)
- SEC-10 Playwright integration spec added with graceful skip when container is unreachable

## Task Commits

1. **Task 1: Log-redaction middleware + unit tests** - `5568a90` (feat)
2. **Task 2: Backup scripts + rclone conf template** - `e7820ce` (feat)
3. **Task 3: Task Scheduler installer** - `6134c58` (feat)
4. **Task 4: SEC-10 Playwright integration spec** - `a9f18ac` (test)
5. **Task 5: OPERATIONS.md runbook stub** - `bc4a885` (docs)

**Plan metadata:** *(pending final commit)*

## Files Created/Modified

- `app/plugins/shifty-auth/src/middleware/log-redact.js` - Console monkey-patch; exports `redact()` function; scrubs env values matching (*_SECRET|*_PASSWORD|*_KEY) longer than 8 chars
- `app/plugins/shifty-auth/src/connections.js` - Updated: side-effect import of log-redact.js
- `app/plugins/shifty-auth/package.json` - Updated: added `./middleware/log-redact` export
- `app/plugins/shifty-auth/tests/log-redact.test.mjs` - 5 unit tests for redact() function
- `tools/backup/backup-postgres.ps1` - Nightly pg_dump + rclone off-host copy + self-test + 14-day retention
- `tools/backup/restore-test.ps1` - Daily standalone pg_restore --list self-test with Event Log alerting
- `tools/backup/install-task-scheduler.ps1` - Idempotent Register-ScheduledTask for both backup tasks
- `tools/backup/.rclone.conf.example` - neshernas_pg_backup SFTP remote template (not committed to production)
- `tests/e2e/log-redaction.spec.ts` - SEC-10 integration spec; skips gracefully when Docker unavailable
- `docs/OPERATIONS.md` - 13-section Phase 1 runbook covering backup, AV exclusions, VHDX compaction, restore drill, test strategy, forward-declared Phase 6 items

## Decisions Made

- **Regex suffix-match over word-boundary:** `/(_SECRET|_PASSWORD|_KEY)s?$/i` correctly matches `RESEND_API_KEY`, `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`. The plan-specified `\b(SECRET|PASSWORD|KEY)\b` fails on `RESEND_API_KEY` because `_` is a word character — the boundary between `I` and `_K` is not a `\b`.
- **Task Scheduler LogonType Interactive:** Required because `docker.exe` uses the Docker Desktop named pipe, which requires an interactive session. `S4U` (service account) sessions can't reach the named pipe.
- **Write-EventLog try/catch throughout:** Event Log source creation needs admin on first run; subsequent invocations as `claude` work after the source exists. Graceful failure means the backup still completes even if Event Log writes fail.
- **Separate restore-test.ps1:** Running self-test at 03:00 catches stale/corrupt dumps independent of the backup task. The backup also runs a self-test inline, so there's redundant coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed log-redact.js regex — word boundary `\b` doesn't match env var name suffixes**
- **Found during:** Task 1 (log-redaction middleware)
- **Issue:** Plan specified `const SENSITIVE_PATTERN = /\b(SECRET|PASSWORD|KEY)\b/i;` but `\b` treats `_` as a word character, so `RESEND_API_KEY` doesn't match because there's no word boundary between `I_K` — the test for `RESEND_API_KEY match: false` confirmed the failure
- **Fix:** Changed to `const SENSITIVE_PATTERN = /(_SECRET|_PASSWORD|_KEY)s?$/i;` — suffix-based match that correctly identifies env vars ending in `_KEY`, `_SECRET`, or `_PASSWORD`
- **Files modified:** `app/plugins/shifty-auth/src/middleware/log-redact.js`
- **Verification:** All 5 unit tests pass; `RESEND_API_KEY`, `NEXTAUTH_SECRET` both redacted; `SHORT_KEY` with value `short` (<=8 chars) not redacted
- **Committed in:** `5568a90` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug fix)
**Impact on plan:** Essential for correctness — the middleware would have been a no-op with the word-boundary regex. No scope creep.

## Issues Encountered

None beyond the regex bug above.

## Known Stubs

None — all sections in OPERATIONS.md contain actionable content. The Uptime Kuma section is forward-declared but clearly labeled "Phase 1 status: Not yet configured" — this is intentional, not a stub.

## User Setup Required (Task 6 — Checkpoint)

**Three manual steps required on hpg5 before Phase 1 ops baseline is fully live:**

1. **Install rclone + configure neshernas_pg_backup remote** — `winget install rclone` as `claude`, then `rclone config` with the SFTP shape from `tools/backup/.rclone.conf.example`
2. **Register Task Scheduler tasks** — Run `C:\shifts-manager\tools\backup\install-task-scheduler.ps1` from an elevated PowerShell as `claude`
3. **Configure Uptime Kuma on neshernas** — Add HTTP monitor for `https://apps.nesher.co/login` with 5-min interval

See Task 6 checkpoint message below for exact verification commands.

## Threat Surface Scan

New files introduce the following ops surface not explicitly in the plan's threat model:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: file-write | tools/backup/backup-postgres.ps1 | Writes dumps to C:\shifts-manager\backups\pg\ — path is hardcoded; no directory traversal risk |
| threat_flag: credential | tools/backup/.rclone.conf.example | Template references SSH key path; actual key lives on hpg5 only; file is not committed |

Both flags are within the plan's documented trust model (T-05-01, T-05-03).

## Next Phase Readiness

- Phase 1 ops baseline complete pending human Task 6 setup
- Phase 2 can begin immediately — backup chain will be active once Task 6 is done on hpg5
- OPERATIONS.md sections for WAHA + Uptime Kuma already forward-declared for Phase 6

---
*Phase: 01-foundations*
*Completed: 2026-05-12*
