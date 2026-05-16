# shifty

A shifts management app: employees, shifts, weekly calendar view, auto-scheduling with constraints, and time-clock / hours tracking.

## Status

> **Stack pivot completed (2026-05-16):** Lowdefy was killed; **Budibase 3.38.4 self-hosted** is the new app tier. Phase 3 (Availability & Rules) is paused mid-execution while business logic from `legacy/shifty-handlers/` is rebuilt on Budibase. Postgres + migrations continue to run on hpg5 untouched. See `CLAUDE.md` for full pivot notes and Budibase deployment topology.

## Stack

- **App tier** — Budibase 3.38.4 Community Edition (Apache-2.0). 6 services: proxy, app, worker, couchdb, redis, minio. UI is authored in the Builder at `https://apps.nesher.co/builder` (CouchDB-backed metadata). Public URL via Cloudflare Tunnel.
- **PostgreSQL 16** — single source of truth for tenancy, roster, shifts, assignments, availability, audit. Schema lives in `db/migrations/` (14 numbered SQL migrations, including Layer-5 RLS). Budibase reaches it as a data source over the internal docker network.
- **Solver service** (FastAPI + OR-Tools CP-SAT, Python 3.12) — Phase 4; not yet built.

All services run together as Docker containers on **hpg5** (Windows 11 + Docker Desktop). Public reachability is provided by Cloudflare Tunnel at `https://apps.nesher.co`.

## Layout

```
db/migrations/          numbered SQL migrations (0001..0014; FK chain + Layer-5 RLS)
legacy/shifty-handlers/ preserved business logic from the killed Lowdefy stack
                        (17 mutation handlers, helpers, Auth.js wiring, RLS hooks,
                        secret-redaction middleware, RTL email template + 32 unit tests)
tests/                  Playwright e2e + integration + node:test unit specs
tools/                  framework-independent CI gates + Postgres backup scripts
docs/                   PRD, OPERATIONS, architectural decisions
docker-compose.yml      Budibase (6 services) + Postgres + one-shot migrate runner
.env.example            template; copy to .env on the deploy host
archive/                preserved artifacts from earlier experiments (Appsmith export)
CLAUDE.md               operational context for Claude Code
```

See `CLAUDE.md` for the deployment topology (hpg5 connection, PsExec wrapper for registry pulls, Cloudflare Tunnel) and working conventions.
