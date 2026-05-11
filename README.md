# shifty

A shifts management app: employees, shifts, weekly calendar view, auto-scheduling with constraints, and time-clock / hours tracking.

## Stack

- **Lowdefy** — config-as-code app builder (Apache-2.0, self-hosted).
- **PostgreSQL 16** — single source of truth for `employees`, `shifts`, `assignments`, `availability`, `time_clock_entries`.
- **Solver service** (FastAPI, Python) — added in a later phase for auto-scheduling.

All three run together as Docker containers on **hpg5** (Windows 11 + Docker Desktop), exposed publicly via Cloudflare Tunnel at `https://apps.nesher.co`.

The Lowdefy app definition lives in this repo as YAML — version-controlled and reviewable, no separate "export the app" step.

## Layout

```
db/migrations/          numbered SQL migrations (0001_init.sql, ...)
docker-compose.yml      Lowdefy + Postgres (solver added later)
.env.example            template; copy to .env on the deploy host
archive/                preserved artifacts from earlier experiments (Appsmith export)
CLAUDE.md               operational context for Claude Code
```

See `CLAUDE.md` for the deployment topology (hpg5 connection, PsExec wrapper, Cloudflare Tunnel) and working conventions.

## Status

Brand-new. Database schema is deployed. The Lowdefy app is being scaffolded.
