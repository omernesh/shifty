# CLAUDE.md

Guidance for Claude Code working in this repo.

## Stack pivot — 2026-05-16

**Lowdefy was killed** (silent plugin-registration drops, `_state:` testing trap, missing antd block exports, build-time FATAL on stub links, no ECharts RTL). **New stack: Budibase 3.38.4 self-hosted CE** (Apache-2.0, no branding paywall on CE).

**Status:** Phase 02 closed (`v0.2.0-phase2`), Phase 03 paused mid-execution (Plans 03-01..03-04 done, 03-05..03-08 dropped). Business logic preserved at `legacy/shifty-handlers/` for porting to Budibase.

**What survives:** Postgres schema + all 14 migrations (Layer-5 RLS intact), FastAPI solver (Phase 04, not built), Playwright test patterns + helpers, GSD planning artifacts (`.planning/`).

## Budibase deployment on hpg5

**Stack:** Budibase 3.38.4 (UI + thin logic) + Postgres 16 (Shifty business data) + one-shot `migrate` runner. FastAPI solver joins in Phase 04. All in `docker-compose.yml` at repo root.

**Conventions doc:** `docs/BUDIBASE-CONVENTIONS.md` — source-of-truth boundaries, post-pivot tenant-isolation layer map (Layer 5 RLS inactive for Budibase clients — Layer 2 is top defense with CI gate), tenant_id plumbing, GSD plan shape, backup/DR, what's preserved vs dead. **Load-bearing for Phase 03+ planning.**

### Service topology (8 containers)

| Service | Image | Role |
|---------|-------|------|
| `budibase-proxy` | `budibase/proxy:3.38.4` | nginx; **only host port: `8080:10000`** |
| `budibase-app` | `budibase/apps:3.38.4` | builder + app server |
| `budibase-worker` | `budibase/worker:3.38.4` | background tasks, auth, tenants |
| `budibase-couchdb` | `budibase/couchdb:v3.3.3` | Budibase metadata (apps/screens/users) — NOT Shifty data |
| `budibase-redis` | `redis:7.4.9-alpine` | session cache + queue |
| `budibase-minio` | `minio/minio:RELEASE.2024-12-18T13-15-44Z` | S3-compatible object store |
| `postgres` | `postgres:16` | **Shifty business data**; Layer-5 RLS active |
| `migrate` | `migrate/migrate:v4.18.3` | one-shot DB migration runner |

LiteLLM pair from upstream compose is intentionally omitted; `LITELLM_MASTER_KEY` unset short-circuits the readiness check.

Budibase apps live in CouchDB. The Builder UI is the canonical *authoring* surface, but it is not the *only* surface — the Internal API (`/api/screens`, `/api/automations`, `/api/queries`, `/api/datasources`, `/api/global/configs/*`) exposes the same JSON shape the Builder UI reads/writes. Headless authoring is proven (spike `55f657b`, scaffold at `tools/budibase-cli/`, full report at `tools/budibase-cli/SPIKE-FINDINGS.md`). Use cookie auth: `POST http://budibase-worker:4003/api/global/auth/default/login` with `{username, password}` (NOT `email`) → capture `budibase:auth` + `budibase:auth.sig` cookies → send with every downstream call alongside `x-budibase-app-id`. `db/migrations/` remains source of truth for Postgres schema. Back up `budibase-couchdb-data` volume (or use `tools/snapshot-budibase.ps1` for PR-time snapshots) to preserve Builder UI state.

### Public access

- **LAN:** `http://hpg5:8080/builder`
- **Public:** `https://apps.nesher.co/builder` (Cloudflare Tunnel → `http://192.168.1.133:8080`, tunnel runs in separate Windows user account, out of scope for SSH ops)
- First-run admin signup via UI (`BB_ADMIN_USER_EMAIL`/`BB_ADMIN_USER_PASSWORD` left unset).
- Add Postgres as data source post-signup: host `postgres`, port `5432`, db `shifts`, user `shifts`, password from `.env`.

### Secrets

In `.env` on hpg5 only (never committed). `.env.example` lists names. Budibase secrets: `JWT_SECRET`, `API_ENCRYPTION_KEY`, `INTERNAL_API_KEY`, `COUCH_DB_USER`, `COUCH_DB_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`. Compose uses `${VAR:?missing}` for fail-fast.

## hpg5 — deployment target

**hpg5 is Windows 11 Pro, NOT Linux.** hpg5 ≠ hpg6 (the Linux box at `100.114.126.43`). hpg5 is `DESKTOP-09VPJKQ` at Tailscale `100.92.65.46`, MagicDNS `hpg5`, LAN `192.168.1.133`.

### SSH

```
plink -ssh -l claude -pw "Onclaude2103" -batch \
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" \
  hpg5 "<cmd>"
```
Remote shell is **cmd**. For complex scripts use `powershell -NoProfile -EncodedCommand <b64>` to dodge quote-escape hell. File upload via `pscp` (same auth shape).

### PsExec — when it's required

**Docker Desktop's credential helper needs an interactive session.** SSH = Windows logon type 3 (network) = no helper access. Operations that hit a registry (`docker pull`, `docker compose pull`, `docker compose build`) must run through PsExec inside `claude`'s session 1:

```
psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c "<docker cmd> > C:\shifts-manager\out.txt 2>&1"
```

Read `out.txt` for output (`-i` sends stdout to the interactive session, not back to SSH).

**No PsExec needed** for: `docker compose up -d` (locally cached), `docker compose ps`, `docker logs`, `docker compose exec`, `docker inspect`, `docker compose stop`.

### Auto-login + autostart

- Sysinternals Autologon stores `claude`'s password in LSA secret → auto-login at console after reboot.
- Docker Desktop autostart via `HKCU:\...\Run\Docker Desktop`.
- Stack comes up via `restart: unless-stopped` after reboot (~60-90s total).
- Windows Firewall rule `Appsmith 8080 (shifts-manager)` allows inbound TCP/8080 (name predates pivots; not worth renaming).

### Deploy sync — git pull

`C:\shifts-manager\` on hpg5 is a git working tree tracking `origin/main`. Sync:

```
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; git fetch origin main; git reset --hard origin/main; git log -1 --oneline\""
```

`reset --hard` is safe — `.gitignore` excludes `postgres-data/`, `.env`, `*.log`. Workflow: edit + commit locally → `git push origin main` → SSH + git fetch/reset on hpg5.

## Common ops on hpg5

```
# Stack status
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose ps\""

# Tail a service
plink ... hpg5 "powershell -c \"docker logs -f shifty-budibase-app\""

# Pull images (REQUIRES PsExec)
plink ... hpg5 "powershell -c \"\$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User'); psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c 'cd C:\shifts-manager && docker compose pull > C:\shifts-manager\pull.txt 2>&1'; Get-Content C:\shifts-manager\pull.txt -Tail 40\""

# Start the stack
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose up -d; docker compose ps\""

# Ad-hoc Postgres query
plink ... hpg5 "powershell -c \"docker compose -f C:\shifts-manager\docker-compose.yml exec -T postgres psql -U shifts -d shifts -c 'SELECT count(*) FROM employees;'\""

# Apply a migration (one-shot)
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose run --rm migrate\""
```

## Repo layout

```
docker-compose.yml        Budibase (6) + postgres + migrate
db/migrations/            numbered SQL migrations (0001..0014_*.sql)
legacy/shifty-handlers/   preserved business logic from Lowdefy era (28 files; see legacy/README.md)
docs/                     PRD.md (product spec), BUDIBASE-CONVENTIONS.md (load-bearing)
.planning/                GSD planning artifacts
tools/budibase-helpers/   IIFE JS bundle for Builder UI code blocks (W0-03; 40/40 tests)
tools/check-bb-queries.mjs  Layer-2 CI gate (W0-04; 503 LOC, 23 tests)
tools/snapshot-budibase.ps1 PR-time Builder UI snapshot wrapper (W0-05; 293 LOC)
tools/budibase-cli/       Internal API client — headless Builder UI work (login + dump + smoke; see SPIKE-FINDINGS.md)
.env.example              template; copy to .env on hpg5 (NEVER committed)
solver/                   FastAPI + OR-Tools — Phase 04, not yet created
```

## Working conventions

- **Postgres schema is source of truth for Shifty data.** Add a new numbered migration in `db/migrations/`; never edit a committed migration.
- **Budibase apps live in CouchDB.** Author via Builder UI for interactive work; use `tools/budibase-cli/` for headless authoring (CRUD over Internal API). Back up `budibase-couchdb-data` volume to preserve them; PR-time snapshots via `tools/snapshot-budibase.ps1`.
- **Solver logic stays in `solver/`** (Phase 04), not in Budibase queries. Budibase queries fine for CRUD + light shaping.
- **Secrets in `.env` on hpg5 only.** Compose injects via `${VAR:?missing}`.
- **GitHub:** `omernesh/shifty`. User identity `omernesher`. Commit on feature branches, push.

## When working in this repo

- User works in **orchestrator mode** (see global CLAUDE.md) — delegate multi-file work to sub-agents.
- No `npm test` / `dotnet build`. Build sequence is `docker compose pull` (PsExec) + `docker compose up -d`.
- Hebrew RTL default, English LTR alternative. Asia/Jerusalem TZ. DD/MM/YYYY (he), YYYY-MM-DD (en).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Shifty — Miluim Shift Planning SaaS**

Multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. Wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first RTL web app — soldiers self-declare availability, manager runs solver to produce draft schedule, publishes it, swap workflow with audit, manager overrides, multi-channel notifications, calendar exports. Replaces the spreadsheet workflows units improvise during call-ups.

**Authoritative contract: `docs/PRD.md`** (1687 lines, locked decisions §1–§14, open questions in §15).

**Core Value:** **Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks.** Correct by construction (rules engine), fair by default (solver objective), adapts to reality (swap workflow with audit) — all Hebrew RTL on commodity hardware.

### Constraints

- **Tech stack (locked, PRD §1; updated post-pivot):** Budibase 3.38.4 on Postgres 16, FastAPI+OR-Tools CP-SAT solver, Docker Compose on hpg5, Auth.js (NextAuth EmailProvider via Resend magic links), WAHA for WhatsApp, Web Push, Cloudflare Tunnel.
- **Tenant isolation:** every domain table has `tenant_id`; queries filter by session-derived tenant_id (never request input). Post-pivot: Layer 5 RLS inactive for Budibase clients (single shared Postgres role) — **Layer 2 (server-side filter) is top defense with CI gate.** Missing any layer is release-blocking.
- **Solver SLO:** <10s p95 for 30 soldiers × 30 days × 4 active rules. Stateless. Same seed = same output.
- **Notification SLOs:** Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant.
- **Hardware:** single hpg5 desktop (Windows 11 + Docker Desktop). PsExec for any registry-pull docker command.
- **Authoritative document precedence:** PRD §15 "Open" → planning may choose; other PRD sections → locked, re-opening requires explicit discussion.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

**Note:** This block auto-regenerates from `research/STACK.md` (still Lowdefy-era). Trust the bullets below over the source until STACK.md is updated.

- **UI/app layer:** Budibase 3.38.4 (CE, Apache-2.0). Apps authored in Builder UI, stored in CouchDB.
- **Database:** Postgres 16 (`postgres:16`). `citext` extension for case-insensitive email. `gen_random_uuid()` built-in.
- **Solver (Phase 04, not built):** Python 3.12 (`python:3.12-slim-bookworm`, NOT Alpine — OR-Tools wheels are glibc), `ortools==9.15.6755`, FastAPI ~0.115, uvicorn[standard] ~0.32, pydantic ~2.9, pytest 8.3, testcontainers 4.8.
- **Auth:** Auth.js / NextAuth EmailProvider via Resend magic links (preserved from Lowdefy era in `legacy/shifty-handlers/auth/`).
- **Integrations:** Resend `6.12.3` (email), `web-push` `3.6.7` (Web Push, VAPID), WAHA `devlikeapro/waha:2026.4.3` (WhatsApp, NOWEB engine), `node-cron` `4.2.1` (separate cron container).
- **PDF:** Puppeteer (~23.x) with `fonts-noto-hebrew` + `fonts-noto-arabic` apt packages.
- **Ingress:** Cloudflare Tunnel (cloudflared, separate Windows user account on hpg5).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| lowdefy | Reference index for Lowdefy 5.3.x. **Dead post-pivot** — kept for legacy reference only. | `.claude/skills/lowdefy/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

- `/gsd-quick` — small fixes, doc updates, ad-hoc tasks
- `/gsd-debug` — investigation and bug fixing
- `/gsd-execute-phase` — planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
