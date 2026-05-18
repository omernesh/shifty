---
date: 2026-05-18
type: deliberation / ADR
status: decided
supersedes: 2026-05-16 Lowdefy → Budibase pivot
---

# ADR: Pivot from Budibase to Next.js + shadcn/ui + Drizzle + Auth.js

## Context
Shifty pivoted from Lowdefy to Budibase 3.38.4 on 2026-05-16 after Lowdefy proved unfit (silent plugin-registration drops, `_state:` testing trap, missing antd block exports, build-time FATAL on stub links, no ECharts RTL).

Phase 02 (Budibase deployment + initial conventions) closed at `v0.2.0-phase2`. Phase 03 W0 closed (W0-01..05 done — Builder helpers, Layer-2 gate, snapshot tooling, CLI scaffold). Phase 03 W1-01 paused at 4/6 tasks with a fundamental finding.

## What broke
Three rounds of investigation in W1-01 surfaced:
1. **Screen fixtures applied via Internal API are accepted (HTTP 200) but runtime-inert** — Builder UI auto-adds fields when components are composed via drag-drop that our hand-built JSON omits. SCREEN-SHAPE.md was incomplete despite 380 lines of reverse-engineering.
2. **Per-app permission grant has no known canonical API path** — three endpoints tried; none take effect on the published-app URL.
3. **`{{ Current User.* }}` bindings only resolve in the published-app browser runtime** — six API paths tested, all return `null`. Layer-2 tenant isolation verification requires actual browser interaction.
4. **Builder UI affordances (e.g., "+ Add Screen") are hover-revealed and invisible to chrome-devtools MCP a11y snapshots** — blocks orchestrated headless authoring.

W1-01.5 was opened as a recovery plan with one human Builder UI step + automated diff. Even if it worked, the same shape-mystery cycle would repeat per component type across 15+ MVP screens.

## Decision
**Drop Budibase entirely. Build the UI in Next.js 15 + shadcn/ui + Auth.js + Drizzle on Postgres 16.**

### Rationale
- **User explicitly cannot do hours of Builder UI clicking** (stated constraint).
- **Code-first authoring eliminates the entire class of "applied-but-inert" failures.** TypeScript + JSX has no hidden runtime contracts.
- **Tenant isolation moves into typed code** (`tenantScopedQuery()` helper + Postgres Layer-5 RLS re-activated) — strictly stronger than Budibase's "bindings resolve in the browser, trust me."
- **Postgres schema + 14 migrations + legacy handlers + solver design + GSD planning all survive intact.** The pivot cost is bounded to ~1 week of Budibase tooling work (Phase 02 + Phase 03 W0).
- **WordPress was considered and rejected** — CMS not app framework; Multisite isolates content not security boundaries; weaker tenant story than Next.js.
- **Stay-on-Budibase-but-Builder-UI was considered and rejected** — user has explicitly said they don't have time for manual UI work.

## Cost
- Phase 02 + Phase 03 W0 (~1 week) becomes archived in git history (no production value).
- Second pivot in 14 days carries some methodology cost (rebuilding muscle memory for a new toolchain).
- Open questions deferred until end of Phase 03 W1-redo: shadcn/ui RTL audit, Drizzle adapter for Auth.js, CI gate replacement for `check-bb-queries.mjs`.

## What survives
- All `db/migrations/` (14 files)
- `legacy/shifty-handlers/` (Auth.js EmailProvider patterns ported from here)
- `solver/` design (Phase 04, unchanged)
- PRD.md (unchanged for tenant-isolation requirements, Hebrew RTL, solver SLO; §1 tech stack updated)
- hpg5 deployment patterns (SSH/PsExec/Docker Compose/Cloudflare Tunnel)
- GSD planning workflow

## What dies
- All `tools/budibase-*`
- `docs/BUDIBASE-CONVENTIONS.md` → replaced by `docs/NEXTJS-CONVENTIONS.md`
- Budibase services in `docker-compose.yml`
- Budibase secrets in `.env.example` + on hpg5 `.env`
- Builder UI CouchDB state on hpg5 (volumes removed in post-pivot cleanup)
- Phase 03 W1-01 + W1-01.5 plans (archived; superseded by new Phase 03 W1 for Next.js)

## Next steps
1. Repo rip-out (in this commit set)
2. hpg5 cleanup (`docker compose down -v` for Budibase services, preserve `postgres-data`)
3. New Phase 03 W1 plan via `/gsd-plan-phase`: Next.js scaffold, Drizzle wiring, Auth.js setup, first authed route, Layer-2 CI gate recreation
4. Resume Phase 03 (now Next.js-flavored) through W2, W3, W4 — original goal (availability rules + shift CRUD) unchanged.
