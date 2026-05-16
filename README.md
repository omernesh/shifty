# shifty

A shifts management app: employees, shifts, weekly calendar view, auto-scheduling with constraints, and time-clock / hours tracking.

## Status

> **Stack pivot in progress (2026-05-16).** Phase 3 (Availability & Rules) is paused mid-execution while the app tier is migrated off Lowdefy. Postgres + migrations continue to run on hpg5. Business logic from the killed Lowdefy plugin is preserved at `legacy/shifty-handlers/` for porting to the next stack (TBD — likely Next.js 15 + shadcn/ui + direct Auth.js). See `CLAUDE.md` for full pivot notes.

## Stack

- **App tier** — TBD; previously Lowdefy 5.3 (Apache-2.0). Replacement to be chosen.
- **PostgreSQL 16** — single source of truth for tenancy, roster, shifts, assignments, availability, audit. Schema lives in `db/migrations/` (14 numbered SQL migrations, including Layer-5 RLS).
- **Solver service** (FastAPI + OR-Tools CP-SAT, Python 3.12) — Phase 4; not yet built.

All services run together as Docker containers on **hpg5** (Windows 11 + Docker Desktop). Public reachability is provided by Cloudflare Tunnel at `https://apps.nesher.co` (currently 502 — no app-tier container is running until the new stack ships its first deploy).

## Layout

```
db/migrations/          numbered SQL migrations (0001..0014; FK chain + Layer-5 RLS)
legacy/shifty-handlers/ preserved business logic from the killed Lowdefy stack
                        (17 mutation handlers, helpers, Auth.js wiring, RLS hooks,
                        secret-redaction middleware, RTL email template + 32 unit tests)
tests/                  Playwright e2e + integration + node:test unit specs
tools/                  framework-independent CI gates + Postgres backup scripts
docs/                   PRD, OPERATIONS, architectural decisions
docker-compose.yml      Postgres + one-shot migrate runner (app tier TBD)
.env.example            template; copy to .env on the deploy host
archive/                preserved artifacts from earlier experiments (Appsmith export)
CLAUDE.md               operational context for Claude Code
```

See `CLAUDE.md` for the deployment topology (hpg5 connection, PsExec wrapper, Cloudflare Tunnel) and working conventions.
