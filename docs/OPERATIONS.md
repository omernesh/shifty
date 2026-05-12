# Operations Runbook — shifty (hpg5)

> Phase 1 runbook stub. Grows phase-by-phase. Last updated 2026-05-12.

## Overview

Shifty runs on hpg5 (Windows 11 Pro, Docker Desktop, autologon as `claude`). The compose stack
is at `C:\shifts-manager\`. Public URL is `https://apps.nesher.co` via Cloudflare Tunnel.
See `CLAUDE.md` for the full deployment topology.

---

## Backup Schedule

**Nightly pg_dump** of the `shifts` database at **02:00 Israel time** via Windows Task Scheduler.

- Produces: `C:\shifts-manager\backups\pg\YYYY-MM-DD.dump`
- Off-host copy: `Z:\backups\pg\YYYY-MM-DD.dump` (Z: is mapped to `\\192.168.1.121\homes\shifty` on the Synology NAS; mapped at user `claude` login on hpg5). If Z: is unmapped, the local dump still succeeds and Event ID 2001 logs the warning — there is no crash; manual remediation is to remap the drive.
- Retention: 14 most-recent daily dumps (older files pruned automatically); Z: copies are NOT pruned by the script (the NAS handles its own retention).
- Logs: `C:\shifts-manager\backups\logs\backup-YYYY-MM-DD.log`
- Event Log: Application log, source `ShiftyBackup` — Event ID 1000 (success), 1001/1002 (failure), 2001 (Z: off-host warning, local dump OK)

**Task name:** `shifty-backup-nightly`

**Verify health:**
```powershell
# Most recent backup
Get-ChildItem C:\shifts-manager\backups\pg\*.dump | Sort-Object LastWriteTime -Desc | Select-Object -First 1
# Off-host copy reachable
Test-Path Z:\backups\pg\
# Recent Event Log entries
Get-EventLog -LogName Application -Source ShiftyBackup -Newest 10
# Both scheduled tasks present
Get-ScheduledTask -TaskName 'shifty-*'
```

**Failure response:**
- Event ID 1001 or 1002 → inspect `backup-YYYY-MM-DD.log` (hard failure of local dump)
- Event ID 2001 → Z: drive unreachable; local dump succeeded, off-host copy did not. Remap the drive via `net use Z: \\192.168.1.121\homes\shifty /persistent:yes` (substitute Synology creds if prompted).
- Common causes: postgres container stopped; pg_restore version mismatch; disk full
- Immediate manual run: `Start-ScheduledTask -TaskName 'shifty-backup-nightly'`

**Setup steps (one-time per hpg5 install):**
1. Store NAS credentials machine-wide so Task Scheduler / SSH sessions can authenticate to the share (Windows isolates credential-manager entries per logon session by default; `cmdkey` stores them in a way that Task Scheduler's "Run as `claude`" picks up):
   ```powershell
   cmdkey /add:192.168.1.121 /user:<NAS_USERNAME> /pass:<NAS_PASSWORD>
   ```
   The user can verify with `cmdkey /list`. The mapped Z: drive at interactive login does NOT cover Task Scheduler runs (per-session) — Step 1 is the actual prerequisite.
2. Register tasks: elevated PowerShell → `C:\shifts-manager\tools\backup\install-task-scheduler.ps1`
3. Verify: run health-check commands above; first nightly run should NOT log Event ID 2001 (off-host warning). If 2001 appears, re-run `cmdkey /add:` with corrected credentials.

**Historical note:** earlier iterations of this section used `rclone copy` to an SFTP remote, then a Z: drive mapping. Replaced with the UNC path (`\\192.168.1.121\homes\shifty\backups\pg\`) on 2026-05-12 — drive letters are per-session on Windows so neither Z: nor an SSH-mapped letter survives a Task Scheduler context. The UNC path works as long as `cmdkey` cached the credentials (Step 1).

---

## Backup Self-Test

**Daily pg_restore --list** check on the latest dump at **03:00 Israel time**.

- Copies the latest dump into the `shifts-postgres` container, runs `pg_restore --list`
- Alerts if latest dump is > 30 hours old (catches missed nightly backups)
- Event Log on success: ID 1015 (Info); on failure: ID 1014 (Error)

**Task name:** `shifty-restore-test-daily`

**Script:** `tools/backup/restore-test.ps1`

**Why separate from backup:** The nightly backup also runs a self-test inline, but the separate
daily task catches cases where the backup ran but the dump is corrupt, or where the backup task
itself silently failed to start after a Windows Update reboot.

---

## Windows Update Active Hours

**Configure Windows Update** to avoid auto-rebooting during the 06:50–08:30 Israel window
when the daily-report cron will eventually fire (Phase 6). Set now so Phase 6 inherits the
correct config on day one.

**Configure (hpg5):**
1. Settings → Update & Security → Advanced options → Active hours
2. Set: **06:00 – 09:00** (Israel local time) — broader than the 06:50–08:30 cron window
3. Save

Task Scheduler tasks use `StartWhenAvailable`, so a missed backup due to reboot will catch up
automatically — but the daily-report notification cannot backfill, hence the active-hours guard.

---

## Antivirus Exclusions

Windows Defender (or alternate AV) must not scan `C:\shifts-manager\` — frequent pg_dump writes
and Docker volume I/O cause high false-positive interrupt rates.

**Configure (hpg5):**
1. Settings → Update & Security → Windows Security → Virus & Threat Protection
2. Manage settings → Exclusions → Add an exclusion → Folder
3. Add: `C:\shifts-manager`
4. Also add Docker Desktop data dirs: `%APPDATA%\Docker` and `%LOCALAPPDATA%\Docker`

---

## VHDX Compaction

Docker Desktop on Windows uses VHDX virtual disks that grow but never shrink automatically.
Compact quarterly to reclaim disk space.

**Schedule:** Calendar Q3 2026 (first compaction); recurring quarterly thereafter.

**Procedure (run from an elevated PowerShell on hpg5):**
```powershell
# 1. Shut down Docker Desktop and WSL
wsl --shutdown
# Wait for Docker Desktop to fully stop (check tray icon)

# 2. Compact the VHDX
Optimize-VHD -Path "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx" -Mode Full
# If the path differs on your Docker Desktop version, check:
#   Get-ChildItem "$env:LOCALAPPDATA\Docker\wsl\" -Recurse -Filter "*.vhdx"

# 3. Restart Docker Desktop
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Expected benefit: recovers several GB after 3–6 months of active pg_dump writes.

---

## Cloudflared User Account

The Cloudflare Tunnel agent runs as a **separate Windows user account** (not `claude`), isolating
the tunnel lifecycle from the Docker stack.

**Verify:**
```powershell
Get-Service -Name 'Cloudflared'
# Status: Running; LogOnAs: should NOT be `claude`
sc qc cloudflared  # shows the "BINARY_PATH_NAME" and logon account
```

The tunnel config points at `http://192.168.1.133:8080` (hpg5 LAN IP). It does not require
the compose stack to be on any particular branch; it just proxies port 8080.

---

## Tailscale-Bound WAHA UI Port

**Forward-declared for Phase 6.** When the WAHA container is deployed, its dashboard UI port
(default 3000) must NOT be exposed to the Cloudflare Tunnel — bind only to the Tailscale
interface or `127.0.0.1`.

**Compose pattern:**
```yaml
waha:
  ports:
    - "127.0.0.1:3001:3000"   # localhost only — Tailscale users reach via 100.92.65.46:3001
```

---

## Dedicated WAHA SIM

**Forward-declared for Phase 6.** WAHA requires a WhatsApp account; do NOT use the user's
personal number. Procure a dedicated Israeli prepaid SIM before WAHA goes live.

**Why:** WAHA's NOWEB driver triggers WhatsApp bot-detection when the same account is active on
WhatsApp Web simultaneously. The session drops at daily frequency with a shared SIM.

---

## External Monitor (Uptime Kuma)

**Deferred to v1.1** (per 2026-05-12 user decision). Originally specified for OPS-07 to provide
external reachability monitoring of `https://apps.nesher.co/login` from outside hpg5, independent
of the hpg5 process. For v1 the Cloudflare Tunnel agent provides an implicit health gate (the
tunnel goes down if the upstream is unreachable, surfacing in Cloudflare's status page) and the
nightly backup self-test catches Postgres-side regressions, so the marginal value of a separate
external monitor is low pre-launch.

**Setup-when-resumed (one-time on whatever runs Uptime Kuma):**
1. Open Uptime Kuma web UI
2. Add HTTP monitor → URL: `https://apps.nesher.co/login` → expected HTTP 200
3. Check interval: 5 minutes
4. Alert: email to `omernesher@gmail.com` on failure
5. Also add a Push monitor named `shifty-backup-nightly` for backup heartbeat

**Status:** Deferred — revisit before any public-user launch.

---

## Container Image Builds (PsExec wrap required)

`docker compose build` on hpg5 requires PsExec wrapping because Docker Desktop's credential
helper (`docker-credential-desktop.exe`) needs an interactive Windows session — SSH sessions
are logon type 3 (network) which the credential helper rejects.

**Pattern (run from developer machine via plink):**
```powershell
plink -ssh -l claude -pw "Onclaude2103" -batch `
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" `
  hpg5 "powershell -c `"psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c 'cd C:\shifts-manager && docker compose build lowdefy > C:\shifts-manager\build.txt 2>&1 && docker compose up -d lowdefy >> C:\shifts-manager\build.txt 2>&1'`""
# Then read output:
plink ... hpg5 "powershell -c \"Get-Content C:\shifts-manager\build.txt -Tail 30\""
```

**Operations that do NOT need PsExec** (no credential helper involved):
- `docker ps`, `docker logs`, `docker inspect`
- `docker exec`, `docker cp`
- `docker compose up -d` (when images are already cached locally)
- `docker compose stop`, `docker compose run`
- `docker compose exec`

---

## Test Strategy

Per PRD §8.4 (OPS-09). All test categories and their tooling for Phase 1:

| Level | Tool | Location | Trigger |
|-------|------|----------|---------|
| Unit | `node:test` (built-in) | `app/plugins/*/tests/*.test.mjs`, `tools/test/*.test.mjs` | `node --test <file>` |
| Integration | Playwright | `tests/e2e/*.spec.ts` | `npx playwright test` |
| Schema/Migration | golang-migrate | `db/migrations/` | `docker compose run --rm migrate` |
| CI grep gate | Node script | `tools/check-queries.mjs` | `node tools/check-queries.mjs --auth-blocks` |
| RBAC | Playwright (RLS specs) | `tests/e2e/rls-cross-tenant.spec.ts` | included in playwright run |
| RTL / i18n | Playwright | `tests/e2e/hebrew-collation.spec.ts` | included in playwright run |
| Load | Locust | `tools/load/` (Phase 4+) | deferred |
| Notification delivery | Litmus + staging | Phase 6+ | deferred |

**Run all Phase-1 tests:**
```bash
node tools/check-queries.mjs --self-test
node tools/check-queries.mjs --auth-blocks
node --test app/plugins/shifty-audit-writer/tests/
node --test app/plugins/shifty-auth/tests/
node --test tools/test/
npx playwright test tests/e2e/
```

Expected runtime: ~90 seconds on a warm Postgres stack.

**Test stack prerequisites:**
- `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d` (opens port 5432 to localhost)
- `PG_TEST_URL=postgres://shifts:changeme@localhost:5432/shifts` env var for Playwright specs

---

## Restore Drill Protocol

**Quarterly restore drill (OPS-06)** proves the backup chain end-to-end. First drill: Q3 2026.

**Procedure:**
1. Copy latest dump to a scratch dir:
   ```powershell
   Copy-Item C:\shifts-manager\backups\pg\<latest>.dump C:\drill\
   ```
2. Start a parallel Postgres on port 5433:
   ```bash
   docker run -d --name drill-postgres -p 5433:5432 -e POSTGRES_PASSWORD=drillpass postgres:16
   docker cp C:\drill\<latest>.dump drill-postgres:/tmp/drill.dump
   docker exec drill-postgres createdb -U postgres drill
   docker exec drill-postgres pg_restore -U postgres -d drill /tmp/drill.dump
   ```
3. Edit a temp `docker-compose.drill.yml` pointing Lowdefy at `drill-postgres:5432`
4. Start staging Lowdefy on port 8081:
   ```bash
   docker compose -f docker-compose.drill.yml up -d
   ```
5. Sign in with the test admin account; verify the dashboard renders employee + shift data
6. Tear down:
   ```bash
   docker rm -f drill-postgres staging-lowdefy
   ```

**Sign-off:** Each drill produces a row in `docs/RESTORE_DRILL_LOG.md` (create on first drill).

| Date | Dump file | Drill result | Notes |
|------|-----------|--------------|-------|
| *(first drill Q3 2026)* | | | |

---

## Postgres role split

The Postgres cluster has three roles. Use the right one for the job:

| Role | Privileges | Used by | Connection |
|------|------------|---------|------------|
| `shifts` | LOGIN, **SUPERUSER** (forced by Postgres — bootstrap role cannot lose SUPERUSER) | Lowdefy app runtime | `postgresql://shifts:****@postgres:5432/shifts` (default in `.env`) |
| `migrator` | LOGIN, SUPERUSER | `migrate/migrate` compose service only | `postgres://migrator:${MIGRATOR_PASSWORD}@postgres:5432/shifts` (compose `migrate` service) |
| `postgres` | (does not exist in this cluster — `shifts` IS the bootstrap user) | — | — |

**Why `shifts` is SUPERUSER:** Postgres rejects `ALTER ROLE <bootstrap> NOSUPERUSER` with "The bootstrap user must have the SUPERUSER attribute." There is no way to drop SUPERUSER from the role named in `POSTGRES_USER` at container init without re-initializing the data volume — and at that point you're better off picking a different bootstrap username from the start.

**RLS bypass risk:** A SUPERUSER can bypass every Row-Level Security policy via `SET row_security = off`. The mitigation is a CI grep gate in `tools/check-queries.mjs --no-rls-bypass` that fails the build if any source file contains the literal `SET row_security = off|false|0`. The gate runs automatically in default mode (just `node tools/check-queries.mjs`). Allowlist marker for genuine exceptions: `// @gsd-allow-rls-bypass: <reason>` on the same line.

**Why `migrator` exists despite the constraint:** Credential isolation. The Lowdefy app and the migration runner have different lifecycles and different threat models — keeping their credentials separate means a compromise of one doesn't compromise the other. Storing the `migrator` password only in `.env` on hpg5 (never in repo) and only loaded by the `migrate` compose service (never by Lowdefy) shrinks the blast radius.

**Future hardening (v1.1):** Re-initialize the Postgres data volume with a distinct bootstrap user (e.g., `pg_root`) and create `shifts` as a regular NOSUPERUSER role at first start. This is a one-time destructive change; safe to do before any production data exists; gives the cleanest possible role split. Not in scope for v1.

---

*Last updated: 2026-05-12 by Phase 1 Plan 05 + post-execution role split.*
*Phase 1 owners: Omer (product) + Claude (build agent).*
