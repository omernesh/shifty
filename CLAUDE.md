# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Active build as of 2026-05-12. Stack pivoted from Appsmith to Lowdefy (see below for why).

**Product spec: `docs/PRD.md`.** Read it before making product-level decisions. Locked decisions live there as decisions, not options; open questions live in §15.

**Lowdefy reference: `.claude/skills/lowdefy/`.** Use this skill when authoring `app/*.yaml` or debugging the Lowdefy runtime — `SKILL.md` is the router; each `reference/0N-*.md` is a focused domain.

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

- **Lowdefy runtime resolution (active).** `docker compose build lowdefy` succeeds and the container starts, but the Next.js SSR fails with `ERR_MODULE_NOT_FOUND` on hash-suffixed `@lowdefy/helpers-<hash>` packages. Cause: Lowdefy + pnpm symlink layout doesn't fully survive the COPY between Docker build stages. Three potential fixes to try: (a) enable Next.js `output: 'standalone'` correctly (it currently emits at workspace root because Lowdefy creates an inner pnpm-lock, breaking the path expectation), (b) start node with `--preserve-symlinks --preserve-symlinks-main`, (c) follow Lowdefy's exact published Dockerfile and adjust paths for the `.lowdefy/server/` nesting.
- Auth model: Lowdefy supports Auth.js (75+ providers). For v1 we'll use a simple email/password setup or magic-link; revisit if SSO becomes useful.
- Calendar widget: try a Lowdefy npm-plugin first (e.g., a fullcalendar-react block), fall back to an embedded Google Calendar if no good option.
- Single-tenant for v1 is decided. Revisit `tenant_id` columns if multi-tenant becomes a real need.
- Whether to ship Lowdefy app builds via docker registry (push from CI) or always build on hpg5 (current default). Current works; switch when CI exists.

## When working in this repo

- The user works in **orchestrator mode** (see global CLAUDE.md) — delegate multi-file work to sub-agents; do not silently scaffold.
- Commands like `npm test` / `dotnet build` do not apply — no JS test suite, no .NET. The build sequence is `docker compose build && docker compose up -d` (with PsExec wrapping when on SSH).
- For UI iteration: edit `app/*.yaml` locally, commit, push, `pscp` the changed files to `C:\shifts-manager\app\` on hpg5, then rebuild + restart the `lowdefy` service. (We can wire git pull on hpg5 later if it becomes painful.)

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Shifty — Miluim Shift Planning SaaS**

Shifty is a multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. It wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first, RTL web app — soldiers self-declare availability, the manager runs the solver to produce a draft schedule, publishes it, and from there it's a living document (swap workflow with audit, manager overrides, multi-channel notifications, calendar exports). The product replaces the spreadsheet workflows that miluim units improvise during call-ups.

**Authoritative contract: `docs/PRD.md`** (1687 lines, locked decisions in §1–§14, open questions confined to §15). PROJECT.md is the GSD-facing summary; PRD is the source of truth for product-level decisions.

**Core Value:** **Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks.** The schedule must be correct by construction (rules engine), fair by default (solver objective), and adapt to reality (swap workflow with audit) — all in Hebrew RTL, on the manager's commodity hardware.

### Constraints

- **Tech stack (locked, PRD §1)**: Lowdefy 5.3 on Postgres 16, FastAPI+OR-Tools CP-SAT solver, Docker Compose on hpg5, Auth.js (NextAuth EmailProvider via Resend magic links), WAHA for WhatsApp, Web Push for browser push, Cloudflare Tunnel for public reachability. Not under review.
- **Language**: Hebrew RTL default, English LTR alternative. ICU MessageFormat. Asia/Jerusalem timezone everywhere. DD/MM/YYYY in he, YYYY-MM-DD in en, 24h time in both.
- **Tenant isolation**: every domain table has `tenant_id`; every query filters by session-derived tenant_id (never request input); four-layer defense (session → query filter → page auth → server-side request role check). Missing any layer is a release-blocking bug. Goal G5: zero cross-tenant data leaks, integration test suite + manual penetration.
- **Solver SLO**: <10s p95 for 30 soldiers × 30 days × 4 active rules. Stateless. Same seed = same output.
- **Notification SLOs**: Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant.
- **Hardware**: single hpg5 desktop (Windows 11 Pro + Docker Desktop + WSL2). PsExec required for any docker command that needs the credential helper (pull, build).
- **Budget**: self-hosted; no commercial WhatsApp Business API in v1, no paid email provider beyond Resend's free tier early on.
- **Authoritative document precedence**: when PRD §15 lists an option as "Open", planning may choose; when PRD lists a decision (any section other than §15), the decision is locked and re-opening it requires explicit user discussion.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack — version pins (HIGH confidence)
### App layer
| Technology | Version | Purpose | Why this pin |
|------------|---------|---------|--------------|
| Lowdefy | `5.3.0` | UI + thin business logic, Auth.js wrapper, Next.js SSR runtime | Latest stable as of 2026-05-11; introduces AgentChat + MCP but those are opt-in; backward-compatible with the repo's current `app/package.json` ([Lowdefy release v5.3.0](https://github.com/lowdefy/lowdefy/releases)). PRD §1 locks `5.3`. |
| `@lowdefy/connection-knex` | `5.3.0` | PostgreSQL driver (uses Knex + `pg`) | Already pinned in `app/package.json`; matches engine pin. |
| `@lowdefy/blocks-aggrid` | `5.3.0` | Data tables (team calendar, leaderboard, audit log) | Already pinned. v5.3.0 upgrades to ag-grid 32.3.9 with button cell renderers and array-aware tag cells — useful for the roster screen and audit log. |
| `@lowdefy/blocks-echarts` | `5.3.0` | Charts (PRD §7.13 "Graphs and statistics views") | Latest matching engine. Wraps Apache ECharts 6.0.0 + echarts-for-react 3.0.5. **WARNING: ECharts has no native RTL support — see §8 RTL strategy below.** |
| `@lowdefy/blocks-tiptap` | `5.3.0` (only if rich-text needed) | Rich-text in notes/free-text fields | Optional; not required by v1 PRD. Skip unless a use case shows up. |
| Node.js (Lowdefy container) | `node:22-bookworm` | Runtime base image | Pinned in `app/Dockerfile`. Do **NOT** switch to `node:22-alpine` (musl breaks sharp; documented in the project's Lowdefy skill `reference/10-deployment.md`). |
| pnpm (build tooling) | `9.15.5` (NOT 11.x) | Package manager during build | Pinned via `corepack prepare pnpm@9.15.5 --activate`. pnpm 11 refuses to run build scripts for `@sentry/cli` and `sharp` which Lowdefy's `@lowdefy/server` pulls; the install exits non-zero and Lowdefy treats the whole install as failed. Documented in skill `reference/10-deployment.md`. |
| Auth.js / NextAuth | bundled with Lowdefy 5.3 | Auth provider runtime | Comes with the Lowdefy engine; not a separate pin. Confirmed via `reference/08-auth.md`. |
| Knex + `pg` driver | bundled with `@lowdefy/connection-knex` | DB layer | Not separately installed; comes with the connection plugin. |
### Database
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Postgres | `16` (image `postgres:16`) | Source of truth | Already pinned in `docker-compose.yml`; PRD §1 locks 16. The migrations in `db/migrations/` use Postgres-16-specific features (e.g., `gen_random_uuid()` directly available without extension). |
| Postgres extensions | `citext` (used in `app_user.email`), `uuid-ossp` not needed (use builtin `gen_random_uuid()`) | Case-insensitive email + UUID PKs | PRD §10 migration `0002` uses `CITEXT`; ensure `CREATE EXTENSION IF NOT EXISTS citext;` is in `0002_tenancy_and_org.sql`. UUID generation is built-in in PG 13+. |
### Solver service
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Python | `3.12` (image `python:3.12-slim-bookworm`) | Solver runtime | PRD §7.8 locks 3.12. Stay on slim-bookworm — OR-Tools wheels are glibc-based, not musl. **Do not use Alpine.** |
| `ortools` | `9.15.6755` | Constraint solver (CP-SAT) | Latest stable on PyPI as of 2026-01-14 ([ortools on PyPI](https://pypi.org/project/ortools/)); supports CPython 3.9–3.14. Pin precisely — OR-Tools breaks API across versions occasionally. |
| `fastapi` | `^0.115` | HTTP framework | Latest stable line. Use `~=0.115.0` (compatible release). |
| `uvicorn[standard]` | `^0.32` | ASGI server | Pair with FastAPI. |
| `pydantic` | `^2.9` | Request/response validation (matches PRD §7.8 JSON schemas) | v2 line; FastAPI 0.115 expects pydantic-v2 only. |
| `httpx` | `^0.27` | Test client / outbound HTTP (none expected in v1) | For pytest async tests. |
| `pytest` | `^8.3` | Unit + integration tests | PRD §8.4. |
| `pytest-asyncio` | `^0.24` | Async test support | For FastAPI testing. |
| `testcontainers` | `^4.8` | Real-Postgres integration tests | PRD §8.4 lists `testcontainers`. |
| Solver container base | `python:3.12-slim-bookworm` | Docker image | Match the Lowdefy side's debian family; avoid Alpine. |
### Integrations (HTTP clients + protocol libs)
| Library | Version | Where it runs | Purpose |
|---------|---------|---------------|---------|
| `resend` (npm) | `6.12.3` | Lowdefy container (or a tiny notification helper service if extracted later) | Email API client; includes `webhooks.verify()` SDK method which wraps Svix HMAC verification ([Resend webhook verify docs](https://resend.com/docs/webhooks/verify-webhooks-requests)). Requires Node >=20 — fine since we're on Node 22. |
| `web-push` (npm) | `3.6.7` | Lowdefy container | VAPID-signed Web Push delivery. Node engine `>=16`; works on Node 22. Default content encoding for new subscriptions is `aes128gcm` ([web-push README](https://github.com/web-push-libs/web-push)). |
| `node-cron` (npm) | `4.2.1` | **Separate** cron container (PRD §11 architecture) | Cron scheduler. **v4 introduces `noOverlap`, `maxRandomDelay`, and the consolidated `Options` type** — use the v4 API ([node-cron migrating from v3](https://nodecron.com/migrating-from-v3)), do not follow stale v3 tutorials. Supports IANA timezone string (`Asia/Jerusalem`). |
| `axios` or built-in `fetch` | use Node 22 `fetch` (no dependency) | Cron container outbound calls into Lowdefy `/api/internal/cron/<job_name>` | Native fetch in Node 22 is stable; avoid an axios dep purely for this. |
| `puppeteer` | `^23.x` (latest stable line; verify at install) | Lowdefy container OR a separate `pdf-renderer` sidecar (decision flagged below in §7) | Server-side PDF rendering for Hebrew. PRD §7.14 leans Puppeteer; confirmed below. |
| WAHA Docker image | `devlikeapro/waha:2026.4.3` (or pin to `2026.4`-series tag for floating patch) | `waha` service in compose | Latest release as of 2026-05-07 ([WAHA releases](https://github.com/devlikeapro/waha/releases)). Apache-2.0. **Choose `NOWEB` engine** (see §6). |
### Reverse proxy / public ingress
| Technology | Version | Notes |
|------------|---------|-------|
| Cloudflare Tunnel (`cloudflared`) | latest from Cloudflare (auto-updates on hpg5) | Already running in a separate Windows user account. Out of scope for this stack — documented in `CLAUDE.md`. |
## Alternatives Considered — already locked, captured for completeness
| Category | Locked choice | Considered alternative | Why not |
|----------|---------------|------------------------|---------|
| Low-code framework | Lowdefy 5.3 | Appsmith CE, Budibase, ToolJet | "Powered by X" branding paywall on the free tier of all three (CLAUDE.md "Why Lowdefy"). |
| Chart library (Lowdefy block) | `@lowdefy/blocks-echarts` | `@lowdefy/blocks-amcharts` (AmCharts 4) | AmCharts is commercial-licensed for SaaS use ("Free" tier requires attribution; we're a SaaS so paid tier kicks in). ECharts is Apache-2.0. `@lowdefy/blocks-amcharts` was also last touched in March 2021, signalling abandoned status. Cost > RTL hassle. |
| Solver | OR-Tools CP-SAT | Pyomo, Cbc, custom greedy | OR-Tools has best-in-class CP-SAT performance, Apache-2.0, well-supported Python bindings, canonical employee-scheduling example in `examples/notebook/examples/shift_scheduling_sat.ipynb`. |
| WhatsApp gateway | WAHA self-hosted | Twilio WhatsApp, Meta Cloud API | Cost (Twilio: $0.005/msg + Meta conversation fees) + Meta business verification overhead; WAHA is self-hosted, Apache-2.0, zero per-message cost. R2 in PRD §15 accepts the session-drop operational risk. |
| Email | Resend | SendGrid, Postmark, SES | Resend is developer-first, free tier 3k emails/month + 100/day, modern webhooks (Svix), Hebrew RTL works via standard HTML — see §5. |
| Cron | Separate `node-cron` container | In-Lowdefy interval task, system crontab on hpg5 | Decoupled from Lowdefy restarts (key decision in PROJECT.md). Stateless. Restart-safe. |
| PDF renderer | Puppeteer | wkhtmltopdf, weasyprint, Playwright | Puppeteer's CSS support is closest to web-truth; wkhtmltopdf is unmaintained (last release 2022); WeasyPrint's CSS3 coverage is incomplete (e.g., flexbox); Playwright works too but is heavier (multi-browser bundle). |
## Installation manifest
### `app/package.json` (Lowdefy container — already in place)
### `solver/pyproject.toml`
### `cron/package.json` (new service in `cron/`)
## 1. Lowdefy 5.3 best practices for multi-tenant apps
### 1a. Four-layer tenant defense (matches PRD §8.3 "Enforcement")
- id: list_team_soldiers
# DO NOT — tenant_id from client payload is forgeable
- id: hard_delete_team
### 1b. YAML repo organization at scale (20+ pages)
### 1c. Plugin declaration discipline (cross-cutting gotcha #6 from skill)
## 2. Auth.js + Lowdefy integration
### 2a. EmailProvider + KnexAdapter for magic links
### 2b. Invite-code redemption flow
# pages/auth/signup_with_invite.yaml
### 2c. Role + tenant propagation onto session
### 2d. Locale on session
## 3. OR-Tools CP-SAT — recipes for PRD §7.6 rules
### Setup
# Indices
# Core decision variable: did soldier `s` work slot `k` on day `d`?
# Headcount: each (day, slot) must be filled by exactly headcount[k] soldiers
# Availability: where availability says NOT available, force the var to 0
# Role-tag filtering: where required_role_tags is non-empty, only matching soldiers can be assigned
### Rule 1: `no_same_day_double` (REQUIRED in PRD §7.6 example)
### Rule 2: `no_consecutive_shift2_then_shift1` (REQUIRED)
### Rule 3: `max_consecutive_nights` (this is one of the 2 the quality gate asks for)
### Rule 4: `weekend_separation` (REQUIRED)
# Pre-compute: for each soldier and each ISO-week, the boolean "worked weekend"
# Enforce: no two consecutive weeks of worked-weekend
### Rule 5: `max_weekly_hours` (this is the 2nd one the quality gate asks for)
### Rule 6: `min_rest_hours_between_shifts`
# For each soldier and each pair of (day, slot) → (day', slot') with start_time(d', k') < end_time(d, k) + R_min,
# the two cannot both be 1.
### Rule 7: `max_shifts_per_period`
### Rule 8: `fairness_objective` (THE OBJECTIVE)
# rules.fairness_objective == "off"   → don't add a minimize() call; solver does feasibility-only
### Performance tuning for the <10s SLO (30 soldiers × 30 days × 4 slots = 3,600 booleans)
## 4. WAHA — current version, session management, webhooks, retries
### Version & engine pin
- **Image:** `devlikeapro/waha:2026.4.3` (or float on `2026.4` for patch updates). Latest release 2026-05-07 ([WAHA releases](https://github.com/devlikeapro/waha/releases)).
- **License:** Apache-2.0.
- **Engine choice:** `NOWEB` (set `WHATSAPP_DEFAULT_ENGINE=NOWEB`). Rationale:
### Compose snippet to add
### Webhook signature verification (HMAC, configured per-session)
# Create the session with HMAC + retry policy
### Session-down handling
## 5. Resend — Hebrew/RTL templates, webhooks, bounce monitoring
### SDK version: `resend@6.12.3` (Node >=20, fine on Node 22).
### Hebrew RTL email template — the canonical pattern
- `<html dir="rtl" lang="he">` is the canonical pair (one attribute is not enough; some email clients honor `dir` and ignore `lang`, others the reverse).
- Set `direction: rtl; text-align: right` on the main container too — some Outlook variants drop `dir` on `<html>` and only respect inline CSS.
- For embedded LTR content (English app names, phone numbers, date ranges like `12/05/2026 - 18/05/2026`), wrap in `<span style="unicode-bidi: embed; direction: ltr">` to prevent the bidi algorithm from reshuffling them.
- Don't rely on Hebrew-specific webfonts — most clients block `<link rel=stylesheet>` and many block `@font-face`. Use a system-font stack and accept that Outlook desktop will render in its default Hebrew font.
### Resend SDK send pattern
### Webhook verification (Svix-signed)
### Bounce-rate monitoring
## 6. Web Push / VAPID — service worker, Hebrew payloads, 410 Gone
### Library: `web-push@3.6.7`. Node engine `>=16`. Default encoding `aes128gcm` (the modern Web Push standard; legacy `aesgcm` only needed for ancient Chrome).
### VAPID key generation (run once, store in `.env`)
### Sending a push (Hebrew payload, mind the 4 KB limit)
### Service worker (`app/public/sw.js`)
### 410 Gone handling
## 7. Puppeteer — Hebrew PDF rendering, font setup
### Puppeteer version: `puppeteer@^23.x` (latest stable line as of 2026-05). It bundles a known-good Chromium build.
### Critical: Hebrew font installation
# In the Lowdefy runtime stage (or a separate pdf-renderer service)
# Install Chromium dependencies + Hebrew + Arabic fonts + fontconfig
# Use the system Chromium, not Puppeteer's downloaded one
- Smaller image size.
- Apt manages the Chromium version (auto-security-patched).
- Same chromium-sandbox executable as Puppeteer expects.
### RTL rendering correctness
### Render call
### Performance
### Where Puppeteer runs — sidecar vs. in-Lowdefy
- Chromium adds ~280 MB to the Lowdefy image; doubles its size.
- A PDF render is a long-ish operation (~2s); keeping Lowdefy's request handlers free for hot UI traffic is healthier.
- Restarting Lowdefy because of a Chromium crash is a worse blast radius than restarting a tiny sidecar.
## 8. ECharts via `@lowdefy/blocks-echarts` — Hebrew RTL strategy (CRITICAL gotcha)
### The reality: ECharts has NO native RTL support
- Bar chart X-axis: categories laid out left-to-right.
- Pie chart label connectors: positioned LTR.
- Legend: items laid out LTR.
- Tooltip: positioned to the right of the cursor.
### Workaround strategy (MEDIUM confidence)
### Recommendation
- **Keep `@lowdefy/blocks-echarts@5.3.0`** for v1. The cost-benefit of switching to AmCharts (commercial license for SaaS) or Highcharts (commercial license $$$) is not worth the small RTL polish gain.
- **Flag in PRD §15 Open Q2 closure:** ECharts is chosen; the limitation is documented. v1.1 reviews whether RTL pain warrants a chart-library swap or building a thin RTL-aware wrapper around ECharts.
- **Add to PITFALLS.md** — see that file's "Pitfall: ECharts RTL surprise".
### Lowdefy block syntax
- id: shift_distribution_chart
## 9. node-cron in a separate container
### Version: `node-cron@4.2.1`. **v4 is a major rewrite from v3** — the API consolidated `scheduled`/`runOnInit` away. Read [migrating from v3](https://nodecron.com/migrating-from-v3) before reading any stale tutorial.
### Pattern: cron triggers HTTP into Lowdefy with shared-secret auth
### Dockerfile (cron/)
### Compose entry
### Lowdefy-side endpoint authentication
## 10. Lowdefy + Docker Compose runtime — the symlink blocker (RANKED FIXES)
### The blocker (already partially solved!)
### Root cause (HIGH confidence)
### Ranked fixes
# Builder stage
# Runtime stage
### Other runtime gotchas (from `reference/10-deployment.md` "Troubleshooting")
| Symptom | Cause | Fix |
|---------|-------|-----|
| `No version specified` at build | `version:` instead of `lowdefy:` in `lowdefy.yaml` | First line must be `lowdefy: 5.3.0` |
| `Block type "X" not defined` | Block belongs to a plugin not declared/installed | Add to `plugins:` AND `package.json` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 default policy | Pin `pnpm@9.15.5` via `corepack prepare` |
| `[next-auth][error][NO_SECRET]` | `NEXTAUTH_SECRET` not set | Add to `.env` |
| 401 on every request after login | `NEXTAUTH_URL` mismatch | Set to canonical public URL (`https://apps.nesher.co`) |
| Container starts, healthcheck fails | App taking >60s to boot | Bump `healthcheck.start_period` in `docker-compose.yml` |
| Inbound LAN traffic doesn't reach Lowdefy on hpg5 | WSL2 mirrored networking doesn't forward inbound LAN to WSL bindings | Use Docker Desktop (already in place — see CLAUDE.md "Why Docker Desktop") |
| `docker compose build` fails with `error getting credentials - A specified logon session does not exist` | SSH session is Windows logon type 3 (network); Docker Desktop credential helper requires interactive session | Wrap with PsExec to run inside session 1 — see CLAUDE.md "Why PsExec for SSH-side docker commands" |
### Pre-flight checklist before merging the Foundations phase
- [ ] `docker compose build lowdefy` succeeds via PsExec on hpg5.
- [ ] `docker compose up -d lowdefy` succeeds.
- [ ] `docker logs shifty-lowdefy --tail 50` shows "ready - started server" and no `ERR_MODULE_NOT_FOUND`.
- [ ] `curl -I http://hpg5:8080/` returns 200 (or 302 → /api/auth/signin if the home is protected).
- [ ] `curl -I https://apps.nesher.co/` from outside the LAN works (Cloudflare Tunnel passthrough).
- [ ] Healthcheck transitions to "healthy" within `start_period` (60s).
## Source priority and confidence summary
| Area | Source priority | Confidence |
|------|-----------------|------------|
| Lowdefy 5.3.0 current | npm registry (verified 2026-05-12), Lowdefy GitHub release notes 5.3.0 (2026-05-11) | HIGH |
| Lowdefy Docker symlink fix | Already implemented in `app/Dockerfile` + skill `reference/10-deployment.md` + commit `b8afba1` | HIGH |
| Multi-tenant patterns | Lowdefy docs (Context7 `/websites/lowdefy`) + project skill | HIGH on Layers 1–3, MEDIUM on Layer 4 plugin authoring |
| Auth.js KnexAdapter + EmailProvider | Lowdefy `reference/08-auth.md` + NextAuth EmailProvider docs | HIGH for shape, MEDIUM for Resend-SMTP detail |
| OR-Tools CP-SAT (9.15.6755) | PyPI release Jan 2026 + canonical examples in `examples/notebook/examples/shift_scheduling_sat.ipynb` and `nurses_sat.ipynb` | HIGH (versions + recipe patterns) |
| OR-Tools fairness variance | Standard literature, OR-Tools community recommendations | HIGH on range-minimization as substitute |
| WAHA 2026.4.x + NOWEB engine | GitHub releases page + WAHA 2026.3 blog | HIGH |
| WAHA HMAC + retries | Context7 `/devlikeapro/waha` docs | HIGH |
| Resend SDK 6.12.3 + webhooks | npm registry + Resend docs (Context7) | HIGH |
| Hebrew RTL email pattern | W3C i18n guidance + multiple email-marketing guides | HIGH |
| web-push 3.6.7 + 410 Gone | npm registry + web-push-libs/web-push docs | HIGH |
| node-cron 4.2.1 (v4 API) | npm registry + nodecron.com docs | HIGH |
| Puppeteer Hebrew fonts | Puppeteer Alpine troubleshooting + multiple PDF-non-Latin guides | HIGH |
| ECharts NO native RTL | Open ECharts GitHub issue #19609 (unresolved as of mid-2026) | HIGH (negative finding) |
| ECharts workaround strategy | Inferred from RTL design patterns; no canonical Hebrew + ECharts case study | MEDIUM |
## Open / followup spikes
## Sources
- [Lowdefy v5.3.0 release notes (GitHub)](https://github.com/lowdefy/lowdefy/releases) — Lowdefy 5.3.0 (2026-05-11)
- [Lowdefy docs (Context7 mirror)](https://docs.lowdefy.com/) — `_user`, `roles`, auth, deployment
- Lowdefy project skill — `C:\Projects\shifts manager\.claude\skills\lowdefy\reference\*.md` (in-repo, distilled from Context7 `/websites/lowdefy`)
- [PyPI: ortools](https://pypi.org/project/ortools/) — `9.15.6755` (2026-01-14), Python 3.9–3.14
- [OR-Tools nurse scheduling example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/nurses_sat.ipynb)
- [OR-Tools shift_scheduling_sat example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/shift_scheduling_sat.ipynb)
- [WAHA releases (GitHub)](https://github.com/devlikeapro/waha/releases) — `2026.4.3` (2026-05-07)
- [WAHA 2026.3 release blog](https://waha.devlike.pro/blog/waha-2026-3/) — NOWEB upgrades
- [Resend webhook verification docs](https://resend.com/docs/webhooks/verify-webhooks-requests) — Svix integration via `resend.webhooks.verify()`
- [Resend email.bounced webhook docs](https://resend.com/docs/webhooks/emails/bounced)
- [W3C i18n: structural markup and RTL text](https://www.w3.org/International/questions/qa-html-dir)
- [CodeTwo: RTL languages in HTML email](https://www.codetwo.com/kb/right-to-left-languages/)
- [web-push-libs/web-push GitHub README](https://github.com/web-push-libs/web-push) — v3.6.7
- [node-cron v3→v4 migration](https://nodecron.com/migrating-from-v3) — `4.2.1`
- [Puppeteer troubleshooting (Docker / Alpine)](https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md)
- [PDF non-Latin fonts with Puppeteer](https://medium.com/@surasith_aof/generate-pdf-support-non-latin-fonts-with-puppeteer-d6ca6c982f1c)
- [ECharts RTL feature request (issue #19609)](https://github.com/apache/echarts/issues/19609) — unresolved
- [@lowdefy/blocks-echarts (npm registry)](https://registry.npmjs.org/@lowdefy/blocks-echarts/latest) — 5.3.0 wraps echarts 6.0.0
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| lowdefy | Reference index for the Lowdefy low-code framework (v5.3.x). Use when authoring or debugging this project's lowdefy.yaml, connections, requests, blocks, operators, events, auth, plugins, or Docker deployment. Load only the relevant reference/*.md file — do not read the whole skill at once. | `.claude/skills/lowdefy/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
