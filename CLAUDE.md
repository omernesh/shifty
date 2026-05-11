# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Active build as of 2026-05-12. Stack pivoted from Appsmith to Lowdefy (see below for why).

- **Public URL: `https://apps.nesher.co`** (Cloudflare Tunnel; `cloudflared` runs on hpg5 under a separate Windows user account, out-of-scope for SSH operations). Also reachable internally as `http://hpg5:8080` over Tailscale.
- **Postgres 16** runs in the compose stack alongside Lowdefy. The v1 schema is applied (`employees`, `shifts`, `assignments`, `availability`, `time_clock_entries`). All empty.
- **Lowdefy** is being scaffolded; the minimal app in `app/` boots a home page + an employees list (PostgreSQL query). Build pipeline (Dockerfile multi-stage → Next.js standalone) is in place.
- **Solver service** is not deployed; that's a later phase.

The repo is git-tracked at `https://github.com/omernesh/shifty.git`. Local checkout is `C:\Projects\shifts manager\`.

## Why Lowdefy

We started with Appsmith CE, deployed it on hpg5, applied the schema, made it reachable over Cloudflare Tunnel, then discovered the "Powered by Appsmith" branding is locked behind their paid Business plan. Same paywall on **Budibase** and **ToolJet**. The only no-branding self-host options are:
- A different paradigm (NocoDB, more table/Airtable-shaped, not a free-form builder)
- A custom React build (high effort)
- **Lowdefy** (Apache-2.0, config-as-code, no paywall) — chosen.

The Appsmith export from the experimental session is preserved at `archive/appsmith-export/` for reference if we ever want to consult what was tried.

## Architecture

Two services right now via Docker Compose on hpg5; the solver service joins later.

1. **Lowdefy** — UI + thin business logic. Defined as YAML in `app/`. Each build compiles the YAML into a Next.js standalone server inside a custom Docker image (`app/Dockerfile`, multi-stage: `node:20-bookworm` builder → `node:20-alpine` runtime). Container listens on 3000 internally; compose publishes it as `8080:3000` on the host. Auth via Auth.js (built into Lowdefy). Connects to Postgres over the internal docker network at host `postgres`, port `5432`.
2. **Postgres 16** — single source of truth. Schema is plain SQL in `db/migrations/`. No host port exposed; only reachable inside the docker network.

Future:
3. **Solver service** (FastAPI, Python) — exposes `/solve` over REST. Reads availability + constraints from Postgres, returns a proposed weekly assignment. Likely OR-Tools (CP-SAT) once constraints stabilize; greedy heuristic acceptable for v1.

Direction of calls: **Lowdefy -> Solver**, never the reverse. The solver does not know Lowdefy exists.

## Deployment target — hpg5

**hpg5 is a Windows 11 Pro desktop, not Linux.** This is a common stumbling block — hpg5 ≠ hpg6 (which is the Linux box at 100.114.126.43 documented in the user's global CLAUDE.md). hpg5 is `DESKTOP-09VPJKQ` at Tailscale IP `100.92.65.46`, MagicDNS hostname `hpg5`.

### SSH access
```
plink -ssh -l claude -pw "Onclaude2103" -batch \
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" \
  hpg5 "<cmd>"
```
Remote default shell is **cmd**. For non-trivial scripts use `powershell -NoProfile -EncodedCommand <b64>` to dodge quote-escape hell across the cmd→PowerShell layers.

File upload uses `pscp` (same auth/hostkey shape).

### Why Docker Desktop (and not native WSL2 dockerd)
We initially tried native `dockerd` in an Ubuntu-24.04 WSL2 distro with `networkingMode=mirrored`. The credential helper / pull worked, but **mirrored networking doesn't forward inbound LAN traffic to WSL bindings** — peers on the same physical LAN (e.g., the Synology NAS at `192.168.1.121`) couldn't reach `192.168.1.133:8080` even though TCP probes for ports 22/445 worked (those are native Windows listeners). We moved to **Docker Desktop**, which publishes ports as real Windows-host listeners, and LAN inbound works the standard way. Trade-off: Docker Desktop needs an interactive user session, which we solved with auto-login (see below). The Ubuntu-24.04 WSL distro has been deleted.

### Auto-login + autostart
- **Sysinternals Autologon** stores the `claude` user's password in an LSA secret. After a reboot, Windows auto-logs `claude` in at the console. Reconfigure with `autologon claude DESKTOP-09VPJKQ <password>`.
- **Docker Desktop autostart** is enabled via the `HKCU:\...\Run\Docker Desktop` registry entry pointing at `C:\Program Files\Docker\Docker\Docker Desktop.exe`. Boots when claude logs in.
- End result: after any reboot, `claude` is automatically logged in within ~30s, Docker Desktop starts within another ~30-60s, the compose stack comes up via `restart: unless-stopped`.

### Why PsExec for SSH-side docker commands
**Docker Desktop on Windows requires an interactive user session for its credential helper** (`docker-credential-desktop.exe` needs to access Windows Credential Manager). SSH sessions are Windows logon type 3 (network), which doesn't qualify — every `docker pull` / `docker compose build` from SSH fails with `error getting credentials - A specified logon session does not exist`.

**Workaround:** wrap docker commands with PsExec so they run inside claude's interactive session 1:
```
psexec -accepteula -nobanner -i 1 -u claude -p <pw> cmd /c "<docker cmd> > C:\shifts-manager\out.txt 2>&1"
```
Then read `out.txt` for output (PsExec's `-i` sends stdout to the interactive session, not back to the SSH caller).

Operations that DON'T need PsExec (no credential helper): `docker ps`, `docker logs`, `docker compose exec`, `docker inspect`, `docker compose up -d` (when images are already cached locally), `docker compose stop`, etc.

Operations that DO need PsExec: anything pulling images from a registry, `docker compose build`, `docker compose pull`, `docker pull`.

### Networking
- Windows Defender Firewall rule `Appsmith 8080 (shifts-manager)` allows inbound TCP/8080 on any profile (name predates the Lowdefy pivot; left for continuity).
- The Cloudflare Tunnel agent runs on hpg5 in a separate Windows user account; its config points at `http://192.168.1.133:8080` (hpg5's LAN IP). The tunnel doesn't depend on anything in this repo or claude's session.

### Deploy layout on hpg5
All project files live at `C:\shifts-manager\` (Windows-native, no WSL involved). Mirror of this repo:
- `C:\shifts-manager\app\` — Lowdefy app
- `C:\shifts-manager\db\migrations\` — SQL migrations
- `C:\shifts-manager\docker-compose.yml`
- `C:\shifts-manager\.env` — secrets (NOT committed)

## Repo layout

```
app/                     Lowdefy app definition (YAML, Dockerfile)
  lowdefy.yaml           main config: connections, menus, pages
  pages/                 page-specific YAML (when factored out)
  connections/           connection-specific YAML (when factored out)
  Dockerfile             multi-stage build: builder + standalone runtime
  .dockerignore
  package.json           "lowdefy" dep + build/dev/start scripts
db/migrations/           numbered SQL migrations (0001_init.sql, ...)
archive/                 preserved artifacts from earlier experiments
  appsmith-export/       Appsmith app export from the abandoned attempt
docker-compose.yml       lowdefy + postgres
.env.example             template; copy to .env on the deploy host
.gitignore
README.md
CLAUDE.md
LICENSE
```

The `solver/` directory will be added in a later phase.

## V1 feature scope

- Employee + shift CRUD
- Weekly calendar view (likely a Lowdefy npm-plugin block or an embedded Google Calendar)
- Auto-scheduling with constraints (delivered by the FastAPI solver, in a later phase)
- Time-clock / hours tracking

## Working conventions

- **The Lowdefy app definition lives in `app/` as YAML and IS the source of truth.** Don't try to manage it through a UI — there isn't one. Edit the YAML, commit, rebuild the container. This is fundamentally different from Appsmith/Budibase/ToolJet.
- **Schema changes go through `db/migrations/` first.** Add a new numbered file (`0002_*.sql`); never edit a committed migration. After a migration runs, update any Lowdefy `request` blocks that reference changed columns.
- **Solver logic stays in `solver/`** (when we get there), not in Lowdefy operators. Operators are fine for formatting, light validation, and stitching requests together; non-trivial business logic belongs in a real service.
- **Secrets live only in `.env` on hpg5.** `.env.example` ships in the repo as a template. The Lowdefy `_secret: NAME` references resolve to environment variables; compose injects them into the container at run time.
- **Branch / commit hygiene:** commit on feature branches, push to GitHub. The user's GitHub identity is `omernesher`; the repo is `omernesh/shifty`.

## Common ops on hpg5

All examples use the plink invocation above. Commands run from claude's SSH session unless noted.

```
# Status of the stack
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose ps\""

# Tail Lowdefy logs (live)
plink ... hpg5 "powershell -c \"docker logs -f shifty-lowdefy\""

# Apply a new migration
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; Get-Content db\migrations\0002_xxx.sql -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U shifts -d shifts\""

# Rebuild Lowdefy after editing app/*.yaml — REQUIRES PsExec because `build` pulls base images
plink ... hpg5 "powershell -c \"\$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User'); psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c 'cd C:\shifts-manager && docker compose build lowdefy > C:\shifts-manager\build.txt 2>&1 && docker compose up -d lowdefy >> C:\shifts-manager\build.txt 2>&1'; Get-Content C:\shifts-manager\build.txt -Tail 30\""

# Reach into postgres for ad-hoc queries
plink ... hpg5 "powershell -c \"docker compose -f C:\shifts-manager\docker-compose.yml exec -T postgres psql -U shifts -d shifts -c 'SELECT count(*) FROM employees;'\""
```

## Open questions

- Auth model: Lowdefy supports Auth.js (75+ providers). For v1 we'll use a simple email/password setup or magic-link; revisit if SSO becomes useful.
- Calendar widget: try a Lowdefy npm-plugin first (e.g., a fullcalendar-react block), fall back to an embedded Google Calendar if no good option.
- Single-tenant for v1 is decided. Revisit `tenant_id` columns if multi-tenant becomes a real need.
- Whether to ship Lowdefy app builds via docker registry (push from CI) or always build on hpg5 (current default). Current works; switch when CI exists.

## When working in this repo

- The user works in **orchestrator mode** (see global CLAUDE.md) — delegate multi-file work to sub-agents; do not silently scaffold.
- Commands like `npm test` / `dotnet build` do not apply — no JS test suite, no .NET. The build sequence is `docker compose build && docker compose up -d` (with PsExec wrapping when on SSH).
- For UI iteration: edit `app/*.yaml` locally, commit, push, `pscp` the changed files to `C:\shifts-manager\app\` on hpg5, then rebuild + restart the `lowdefy` service. (We can wire git pull on hpg5 later if it becomes painful.)
