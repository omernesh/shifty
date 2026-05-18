# CLAUDE.md

Guidance for Claude Code working in this repo.

## Stack pivot — 2026-05-18

**Budibase was killed** (CLI-first authoring proved unworkable: screen fixtures applied via API but inert at runtime; per-app permission API undocumented; bindings only resolve in browser; Builder UI affordances not driveable by chrome-devtools MCP). **New stack: Next.js 15 (App Router) + shadcn/ui + Auth.js (NextAuth EmailProvider via Resend magic links) + Drizzle ORM on Postgres 16, all in Docker on hpg5.** Two prior pivot eras preserved at `legacy/shifty-handlers/` and the Budibase work removed in this commit.

**What survives:** Postgres schema + all 14 migrations, FastAPI solver scope (Phase 04, not built), Auth.js handlers ported from `legacy/shifty-handlers/auth/`, GSD planning artifacts (`.planning/`), hpg5 deployment infrastructure.

## Next.js deployment on hpg5

**Stack:** Next.js app container (UI + API routes + Auth.js + Drizzle) + Postgres 16 (Shifty business data) + one-shot `migrate` runner. FastAPI solver joins in Phase 04. All in `docker-compose.yml` at repo root.

**Conventions doc:** `docs/NEXTJS-CONVENTIONS.md` (replaces the dead `BUDIBASE-CONVENTIONS.md`) — source-of-truth boundaries, tenant-isolation layer map, tenant_id plumbing, GSD plan shape, backup/DR. **Load-bearing for Phase 03+ planning.**

### Service topology

| Service | Image | Role |
|---------|-------|------|
| `nextjs-app` | built from `./Dockerfile` (node:20-alpine base) | Next.js 15 App Router; **host port: `8080:3000`** |
| `postgres` | `postgres:16` | **Shifty business data**; `tenant_id` on every domain table |
| `migrate` | `migrate/migrate:v4.18.3` | one-shot DB migration runner |
| `solver` | (Phase 04) `python:3.12-slim-bookworm` + OR-Tools | constraint-solving microservice; not yet built |

### Public access

- **LAN:** `http://hpg5:8080`
- **Public:** `https://apps.nesher.co` (existing Cloudflare Tunnel → `http://192.168.1.133:8080`, tunnel runs in separate Windows user account, out of scope for SSH ops)
- First-run admin signup via `/auth/signin` (Resend magic link).

### Secrets

In `.env` on hpg5 only (never committed). `.env.example` lists names. Next.js secrets: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `RESEND_API_KEY`, `DATABASE_URL`. Plus `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` for the postgres service. Compose uses `${VAR:?missing}` for fail-fast.

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

**Docker Desktop's credential helper needs an interactive session.** SSH = Windows logon type 3 (network) = no helper access. Operations that hit a registry (`docker pull`, `docker compose pull`, `docker compose build` of the Next.js image base) must run through PsExec inside `claude`'s session 1:

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

`reset --hard` is safe — `.gitignore` excludes `postgres-data/`, `.env`, `*.log`, `node_modules/`, `.next/`. Workflow: edit + commit locally → `git push origin main` → SSH + git fetch/reset on hpg5 → rebuild if needed.

## Common ops on hpg5

```
# Stack status
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose ps\""

# Tail a service
plink ... hpg5 "powershell -c \"docker logs -f shifty-nextjs-app\""

# Pull images / rebuild app (REQUIRES PsExec)
plink ... hpg5 "powershell -c \"\$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User'); psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c 'cd C:\shifts-manager && docker compose pull && docker compose build > C:\shifts-manager\pull.txt 2>&1'; Get-Content C:\shifts-manager\pull.txt -Tail 40\""

# Start the stack
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose up -d; docker compose ps\""

# Ad-hoc Postgres query
plink ... hpg5 "powershell -c \"docker compose -f C:\shifts-manager\docker-compose.yml exec -T postgres psql -U shifts -d shifts -c 'SELECT count(*) FROM employees;'\""

# Apply a migration (one-shot)
plink ... hpg5 "powershell -c \"cd C:\shifts-manager; docker compose run --rm migrate\""
```

## Repo layout

```
docker-compose.yml        Next.js app + postgres + migrate
Dockerfile                Next.js production build (node:20-alpine, multi-stage)
db/migrations/            numbered SQL migrations (0001..0014_*.sql) — source of truth
src/db/                   Drizzle schema + client (Phase 03 W1)
src/lib/auth/             Auth.js config (Phase 03 W1)
src/lib/tenant/           tenant-scoped query helper (Phase 03 W1)
src/components/ui/        shadcn components (vendored, Phase 03 W1)
app/                      Next.js App Router (Phase 03 W1)
legacy/shifty-handlers/   preserved business logic from Lowdefy era; Auth.js handlers port from here
docs/                     PRD.md (product spec), NEXTJS-CONVENTIONS.md (load-bearing, being authored)
.planning/                GSD planning artifacts
.env.example              template; copy to .env on hpg5 (NEVER committed)
solver/                   FastAPI + OR-Tools — Phase 04, not yet created
```

## Working conventions

- **Postgres schema is source of truth for Shifty data.** Add a new numbered migration in `db/migrations/`; never edit a committed migration.
- **Next.js code is the UI source of truth.** Drizzle schema in `src/db/schema.ts` mirrors `db/migrations/` — run `drizzle-kit introspect` after applying a new SQL migration, then commit the regenerated schema.
- **Layer-2 tenant filter via `tenantScopedQuery()` helper** in `src/lib/tenant/` is the top defense; enforced via CI gate (to be re-created post-pivot). Never trust client-supplied `tenant_id`.
- **Solver logic stays in `solver/`** (Phase 04), not in Next.js API routes. API routes fine for CRUD + light shaping; they call out to the solver service for scheduling.
- **Secrets in `.env` on hpg5 only.** Compose injects via `${VAR:?missing}`.
- **GitHub:** `omernesh/shifty`. User identity `omernesher`. Commit on feature branches, push.

## When working in this repo

- User works in **orchestrator mode** (see global CLAUDE.md) — delegate multi-file work to sub-agents.
- Standard Node tooling: `npm install`, `npm run dev` (local), `npm run build` (CI), `npm test` (Vitest, when added). Docker pulls (Next.js base image) still need PsExec on hpg5.
- Hebrew RTL default, English LTR alternative. Asia/Jerusalem TZ. DD/MM/YYYY (he), YYYY-MM-DD (en).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Shifty — Miluim Shift Planning SaaS**

Multi-tenant SaaS for Israeli reserve soldiers (miluim) and their commanders to plan, publish, and adapt shift schedules. Wraps a constraint-aware OR-Tools CP-SAT solver in a Hebrew-first RTL web app — soldiers self-declare availability, manager runs solver to produce draft schedule, publishes it, swap workflow with audit, manager overrides, multi-channel notifications, calendar exports. Replaces the spreadsheet workflows units improvise during call-ups.

**Authoritative contract: `docs/PRD.md`** (1687 lines, locked decisions §1–§14, open questions in §15).

**Core Value:** **Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks.** Correct by construction (rules engine), fair by default (solver objective), adapts to reality (swap workflow with audit) — all Hebrew RTL on commodity hardware.

### Constraints

- **Tech stack (locked, PRD §1; updated post-pivot):** Next.js 15 (App Router) + shadcn/ui + Drizzle on Postgres 16, FastAPI+OR-Tools CP-SAT solver, Docker Compose on hpg5, Auth.js (NextAuth EmailProvider via Resend magic links), WAHA for WhatsApp, Web Push, Cloudflare Tunnel.
- **Tenant isolation:** every domain table has `tenant_id`; queries filter by session-derived tenant_id (never request input). **Layer 2 (server-side filter via `tenantScopedQuery()`) is top defense with CI gate.** Missing any layer is release-blocking.
- **Solver SLO:** <10s p95 for 30 soldiers × 30 days × 4 active rules. Stateless. Same seed = same output.
- **Notification SLOs:** Email <60s, WhatsApp <30s best-effort, Push <5s, in-app instant.
- **Hardware:** single hpg5 desktop (Windows 11 + Docker Desktop). PsExec for any registry-pull docker command.
- **Authoritative document precedence:** PRD §15 "Open" → planning may choose; other PRD sections → locked, re-opening requires explicit discussion.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

**Note:** This block auto-regenerates from `research/STACK.md` (still Lowdefy/Budibase-era). Trust the bullets below over the source until STACK.md is updated.

- **UI/app layer:** Next.js 15 (App Router, RSC), shadcn/ui, Tailwind CSS, TypeScript.
- **Database:** Postgres 16 (`postgres:16`). `citext` extension for case-insensitive email. `gen_random_uuid()` built-in.
- **ORM:** Drizzle 0.x (latest) + drizzle-kit (introspect + migrate codegen).
- **Auth:** Auth.js / NextAuth EmailProvider via Resend magic links (ported from `legacy/shifty-handlers/auth/`).
- **Solver (Phase 04, not built):** Python 3.12 (`python:3.12-slim-bookworm`, NOT Alpine — OR-Tools wheels are glibc), `ortools==9.15.6755`, FastAPI ~0.115, uvicorn[standard] ~0.32, pydantic ~2.9, pytest 8.3, testcontainers 4.8.
- **Integrations:** Resend `6.12.3` (email), `web-push` `3.6.7` (Web Push, VAPID), WAHA `devlikeapro/waha:2026.4.3` (WhatsApp, NOWEB engine), `node-cron` `4.2.1` (separate cron container).
- **PDF:** Puppeteer (~23.x) with `fonts-noto-hebrew` + `fonts-noto-arabic` apt packages.
- **Ingress:** Cloudflare Tunnel (cloudflared, separate Windows user account on hpg5).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Drizzle schema in `src/db/schema.ts`. Tenant scoping mandatory via `tenantScopedQuery(session, tableName)` — never trust client-supplied `tenant_id`. App Router segments under `app/(authed)/` enforce auth via middleware. shadcn components copied into `src/components/ui/` (vendored, not npm dep). RTL by default: `<html dir="rtl" lang="he">`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Will be filled in during Phase 03 W1.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| _TBD_ | Skills will be added as Next.js / Drizzle / Auth.js patterns stabilize. | — |
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
