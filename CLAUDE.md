# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Infrastructure deployed as of 2026-05-12.

- **Public URL: `https://apps.nesher.co`** (Cloudflare Tunnel; `cloudflared` runs on hpg5 under a separate Windows account that is out-of-scope for SSH operations). Also reachable internally as `http://hpg5:8080` over Tailscale.
- **Postgres 16.13** runs alongside Appsmith in the same compose stack, reachable only over the internal docker network. v1 schema is applied: `employees`, `shifts`, `assignments`, `availability`, `time_clock_entries`. All empty.
- The Appsmith admin account is `omernesher@gmail.com` (created via signup at `https://apps.nesher.co` on 2026-05-12). Note: signup MUST be reached via `https://...` explicitly — visiting `http://apps.nesher.co` triggers Cloudflare's HTTP→HTTPS 301 redirect, which drops POST bodies (signup, login, etc.) per HTTP spec. Tell users this if they hit unexplained 401s during signup or login.
- **Appsmith → Postgres datasource** has not been wired in the Appsmith UI yet. Connection details from inside the container: `host=postgres port=5432 db=shifts user=shifts`; password lives in `C:\shifts-manager\.env` on hpg5 (mode 600 conceptually; the file is excluded by `.gitignore`).
- The solver service is not deployed; we add it in a later phase.

The local repo at `C:\Projects\shifts manager\` contains: `CLAUDE.md`, `docker-compose.yml`, `db/migrations/0001_init.sql`, `.env.example`, `.gitignore`. These are the source of truth; the copies on hpg5 are deploy artifacts. The repo is not yet a git repo (no `.git`).

## What this project is

A **shifts management web app** for assigning employees to shifts, viewing the weekly schedule, auto-generating schedules subject to constraints, and tracking clocked hours.

This is **not** a from-scratch React/Node build. The UI and most CRUD logic live inside an **Appsmith** application; only the parts Appsmith cannot do are hand-written.

## Architecture (planned)

Three services, brought up together via Docker Compose:

1. **Appsmith** — self-hosted via the official Docker image. Holds all pages, forms, tables, and the bulk of business logic. Persists nothing the app cares about; all domain data lives in Postgres.
2. **Postgres** — single source of truth for `employees`, `shifts`, `assignments`, `time_clock_entries`, and constraint rules. Schema is plain SQL in `db/migrations/`.
3. **Solver service** (FastAPI, Python) — exposes `/solve` over REST. Reads availability + constraints from Postgres, returns a proposed weekly assignment. Likely OR-Tools (CP-SAT) once constraints stabilize; a greedy heuristic is acceptable for v1.

Direction of calls: **Appsmith -> Solver**, never the reverse. The solver does not know Appsmith exists.

## Deployment

**Target host: `hpg5` — a Windows 11 Pro desktop, NOT Linux.** This was the surprise: hpg5 ≠ hpg6 (which is Linux at 100.114.126.43, documented in the user's global CLAUDE.md). hpg5 is `DESKTOP-09VPJKQ` at Tailscale IP `100.92.65.46`, MagicDNS hostname `hpg5`.

SSH access:
```
plink -ssh -l claude -pw "Onclaude2103" -batch \
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" \
  hpg5 "<cmd>"
```
Remote default shell is **cmd**. Use `powershell -NoProfile -EncodedCommand <b64>` for non-trivial scripts to dodge quote-escape hell.

Because Docker Desktop on Windows can't run headless (needs an interactive user session), we **don't use Docker Desktop for the daemon**. Instead:
- Ubuntu 24.04 lives in WSL2 with systemd enabled (`/etc/wsl.conf`)
- Docker Engine + Compose are installed natively inside Ubuntu (`docker-ce` from Docker's apt repo)
- `docker.service` is systemd-enabled — starts when the WSL distro boots
- `C:\Users\claude\.wslconfig` sets `vmIdleTimeout=-1` and `networkingMode=mirrored` (the latter makes WSL bindings appear on all Windows network interfaces, including the Tailscale one)
- A scheduled task `wsl-docker-autostart` (trigger: AtStartup, runs as `claude` with stored password, action: `wsl.exe -d Ubuntu-24.04 -u root -- /usr/bin/sleep infinity`) launches the WSL distro at system boot — survives logout/reboot without manual intervention
- Windows Firewall has an inbound TCP/8080 rule named `Appsmith 8080 (shifts-manager)`

All project files live **inside the WSL distro** at `/opt/shifts-manager/`. From Windows you can reach them at `\\wsl$\Ubuntu-24.04\opt\shifts-manager\`.

Compose stack currently runs only `appsmith`. `postgres` + `solver` will be added in later phases. No reverse proxy / TLS yet — Tailscale-only on port 8080.

## Planned repo layout

```
db/migrations/          numbered SQL migrations (0001_init.sql, ...)
appsmith/export/        periodic JSON exports of the Appsmith app
solver/app/             FastAPI source
solver/Dockerfile
solver/requirements.txt
docker-compose.yml      brings up the full stack
docs/                   runbooks: deploy, import-appsmith-app, add-constraint
.env.example
```

## V1 feature scope (locked)

- Employee + shift CRUD
- Weekly calendar view
- Auto-scheduling with constraints (delivered by the FastAPI solver)
- Time-clock / hours tracking

## Working conventions

- **The Appsmith app is not source-code-editable by hand.** Make changes in the Appsmith UI; version-control progress by exporting the application JSON to `appsmith/export/`. Do not hand-edit those JSON files — they will be overwritten on the next export and merge conflicts are unworkable.
- **Schema changes go through `db/migrations/` first, never via the Appsmith UI.** After a migration runs, regenerate / re-point any Appsmith queries that reference the changed shape.
- **Scheduling logic lives in `solver/`, not in Appsmith JS.** Appsmith JS should stay thin (formatting, light validation) because it is painful to test in isolation.
- Local dev is `docker compose up` (once scaffolded). There is no separate `npm run dev` workflow — Appsmith is the dev environment.

## Open questions

- Reverse-proxy + TLS strategy on hpg5 (Caddy in a container? Tailscale Funnel? do without for now since tailnet-only?).
- Auth model: Appsmith built-in users vs SSO.
- Single-tenant for v1 (decided). Revisit `tenant_id` columns if multi-tenant becomes a real need.
- Initial Appsmith admin account creation (happens on first visit to `http://hpg5:8080`).
- Wire up Appsmith → Postgres datasource (after the admin account exists).

## When working in this repo

- Commands like `npm test`, `dotnet build`, etc., do **not** apply — there is no JS/.NET source tree. The only things to run are `docker compose up` (inside the WSL distro on hpg5) and (eventually) `pytest` inside `solver/`.
- The user works in **orchestrator mode** (see global CLAUDE.md) — delegate multi-file work to sub-agents; do not silently scaffold.
- Common ops over SSH (all need the `plink` invocation above):
  - Check Appsmith health: `wsl -d Ubuntu-24.04 -u root -- docker ps`
  - Tail logs: `wsl -d Ubuntu-24.04 -u root -- docker logs -f shifts-appsmith`
  - Stop/start: `wsl -d Ubuntu-24.04 -u root -- bash -c 'cd /opt/shifts-manager && docker compose <stop|up -d>'`
  - Pull latest Appsmith: `... docker compose pull && docker compose up -d`
