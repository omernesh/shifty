---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: Completed 02-01-PLAN.md (schema deltas applied on hpg5)
last_updated: "2026-05-13T19:19:15.174Z"
last_activity: 2026-05-13
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 15
  completed_plans: 10
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** Manager spends 30 minutes per planning window instead of 4 hours, with zero cross-tenant data leaks, in a Hebrew-first RTL UI.
**Current focus:** Phase 02 — org-people

## Current Position

Phase: 02 (org-people) — EXECUTING
Plan: 6 of 10
Status: Ready to execute
Last activity: 2026-05-13

Progress: [███████░░░] 67%

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: ~2h
- Total execution time: ~2h

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundations | 1/5 | ~2h | ~2h |

**Recent Trend:**

- Last 5 plans: Plan 01 (2h)
- Trend: baseline

*Updated after each plan completion*
| Phase 01-foundations P02 | 210 | 3 tasks | 16 files |
| Phase 01-foundations P03 | 480 | 7 tasks | 20 files |
| Phase 01-foundations P04 | 180 | 4 tasks | 14 files |
| Phase 01-foundations P05 | 45 | 5 tasks | 10 files |
| Phase 02-org-people P02 | 35 | 4 tasks | 18 files |
| Phase 02-org-people P01 | 7 | 3 tasks | 2 files |
| Phase 02-org-people P03 | 18 | 2 tasks | 1 files |
| Phase 02-org-people P04 | 8 | 1 tasks | 1 files |
| Phase 02-org-people PP05 | 7 | - tasks | - files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Plan 02: Legacy `availability` table renamed to `availability_legacy` in 0004 to preserve D-06 smoke-test surface through Phase 1; drop in migration 0008 at Phase 2 boundary
- Plan 04: Self-test uses programmatic scan (not subprocess) to avoid Windows shell quoting issues; global tenant_id removal in mutation because scanner checks 80-line block including parameters sections
- Plan 04: signInAs() uses set_config(false) for session scope so all queries in the fixture connection see the tenant context; teardown TRUNCATE bypasses RLS (DDL semantics)
- Plan 04: Playwright specs skip gracefully when Postgres/stack unreachable — CI must set PG_TEST_URL for green runs
- Plan 05: Log-redact regex uses suffix pattern (_SECRET|_PASSWORD|_KEY)$ not word-boundary \b — RESEND_API_KEY ends with _KEY but \b treats _ as word char so the boundary fails
- Plan 05: Task Scheduler tasks use LogonType Interactive — docker daemon socket on hpg5 is the Docker Desktop named pipe, accessible only from interactive sessions
- Plan 05: restore-test.ps1 runs separately at 03:00 (not just inline with backup) — catches stale/corrupt dumps independent of backup task
- Plan 02: pnpm-workspace.yaml excluded from Docker image (added to .dockerignore); plugin referenced via `file:` protocol in package.json + lowdefy.yaml to prevent Lowdefy inner pnpm workspace-mode hang (2.5h hang diagnosed + fixed)
- Plan 02: lowdefy.yaml plugin version `file:../../plugins/<name>` is relative from `.lowdefy/server/` — Lowdefy's addCustomPluginsAsDeps.js writes this verbatim into server package.json; path must resolve from server dir
- Plan 02: Dynamic `import('knex')` in AuditWrite.js (not top-level) enables unit tests without live DB or installed knex
- Plan 01: golang-migrate requires `.up.sql` suffix — renamed `0001_init.sql` to `0001_init.up.sql`; future migrations use this convention
- Plan 01: `docker compose run --rm migrate` (no trailing `up`) — YAML command already includes `up`; appending it overrides flags
- Phase 1: Postgres RLS as 5th defense layer (`0009_rls_policies.sql`) — research-resolved beyond PRD §15 R4 deferral
- Phase 1: Custom Lowdefy request plugin scaffold (`shifty-audit-writer`) is a Foundations prerequisite — unlocks layer-4 RBAC + dispatcher + webhooks + signed-URL endpoints
- Phase 1: `migrate/migrate` (golang-migrate) compose service replaces manual `psql` for migration runs
- Phase 4: CP-SAT `num_search_workers=1` pinned for v1 determinism; switch to `interleave_search` is v1.1
- Phase 4: `infeasibility_report` extended to soldier-level + date-level attribution via `solver.SufficientAssumptionsForInfeasibility()`
- Phase 6: WAHA needs dedicated SIM separate from user's personal number — OPS prerequisite, not v1.1 nice-to-have
- Phase 7: ECharts Gantt timeline deferred to v1.1 (no native RTL support); ASCII-bar leaderboard + LTR accessible bar chart pair is acceptable
- [Phase ?]: Plan 02-02: shifty-roster plugin scaffold + 5 helpers + 7 handler stubs + dual-declaration in package.json/lowdefy.yaml; PALETTE byte-equal to UI-SPEC §Color B locked by deepStrictEqual; 42 unit tests green
- [Phase ?]: Plan 02-02: Assumption A1 (sha256(rawToken+NEXTAUTH_SECRET) for verification_tokens) documented in dispatch/resend.js — plan 02-08 owns 2h spike to verify against live next-auth source before bulk-invite ships
- Plan 02-01: role_tag and org_unit.last_color_index migrations applied on hpg5; schema_migrations advanced 10→12 via PsExec-wrapped golang-migrate (PsExec required because docker compose run pulls/builds may invoke credential helper); idempotent re-run confirmed "no change"
- Plan 02-01: role_tag.key CHECK regex `^[a-z][a-z0-9-]*$` is byte-equal to canonicalizeRoleTag output in plugin (single-contract enforcement — plan 02-08 CSV preview validation will use the same regex for the validRoleTagKeys pre-flight)
- Plan 02-01: org_unit.last_color_index defaults to -1 sentinel (not 0) so pickNextColor(lastIndex<0) returns palette[0] for the first soldier in a fresh team; CHECK `BETWEEN -1 AND 23` enforces palette range at the DB layer
- Plan 02-01: Inline RLS pattern (ENABLE ROW LEVEL SECURITY + CREATE POLICY tenant_isolation in the same .up.sql as CREATE TABLE) is the canonical shape for post-0009 tenant-scoped tables — 0009 is sealed at version=10 per Phase 1 P01 sequencing rule
- [Phase ?]: Plan 02-03: is_admin sourced via _array.includes on _user.roles (shifty-auth session exposes roles[] not is_admin)
- [Phase ?]: Plan 02-03: Layer-4 admin-gate CTE shape (WITH guard AS SELECT 1 WHERE :is_admin) + EXISTS(SELECT 1 FROM guard) on downstream CTEs — reusable for any role-restricted multi-table mutation
- [Phase ?]: Plan 02-03: AgGrid Pattern A (RESEARCH P9 canonical answer) — three separate single-affordance action columns dispatched on _event.column.field; zero data-action HTML attribute bridge in codebase
- [Phase ?]: Plan 02-03: Recursive CTE tree shape with path TEXT[] (anchor parent_id IS NULL + UNION ALL appending tree.path || ou.name) — both arms filter by tenant_id; reusable for team_detail subtree in Plan 06+
- [Phase ?]: Plan 02-04: manage_soldiers page wires CreateSoldier plugin request alongside three KnexRaw reads on the same page — first instance of mixed plugin-typed + KnexRaw requests in the repo; pattern reusable for plan 02-06 soldier_detail UpdateSoldier/ArchiveSoldier wiring
- [Phase ?]: Plan 02-04: AgGrid color-dot cellRenderer YAML fragment (UI-SPEC Reusable Components section 9, copied byte-equal) is the canonical reuse target — plan 02-07 team_detail members grid + plan 04 calendar weekly view should copy verbatim rather than promote to app/blocks/color_dot_cell.yaml (deferred to plan 02-06 alongside color_swatches.yaml)
- [Phase ?]: Plan 02-04: TextInput search binding uses state.search_input (input value via state lookup) not _event.value — the Lowdefy 5.3 TextInput.onChange does not emit value on _event; verified against manage_org_units.yaml name_input shape
- [Phase ?]: Plan 02-05: manage_role_tags page is READ-ONLY in Phase 2 — zero mutation blocks; tags born only via plan 02-06 add-soldier or plan 02-08 CSV import; edit/rename/delete cascade deferred to v1.1
- [Phase ?]: Plan 02-05: AgGrid enableRtl: true is mandatory across Phase 2 (UI-SPEC Reusable Component 8) — copying pattern from plan 02-04 manage_soldiers.yaml; carries forward to plans 02-06 soldier_detail + 02-07 team_detail member grids

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 1**: Lowdefy runtime smoke test must pass first — `ERR_MODULE_NOT_FOUND` on hash-suffixed `@lowdefy/helpers-*` packages may already be resolved at commit `b8afba1`; if smoke test fails, 5-day timebox with documented escape hatch (switch to npm, or escalate Lowdefy-lock re-open).
- **Phase 4**: Solver infeasibility-report unsat-core technique extends PRD §7.8 schema and needs deeper research during planning; budget extra time.
- **Phase 6**: WAHA webhook depth (`message-status` events, retries config) needs research during planning; dedicated SIM is an OPS prerequisite before WhatsApp channel goes live.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — pre-v1)* | | | |

## Session Continuity

Last session: 2026-05-13T19:19:15.159Z
Stopped at: Completed 02-01-PLAN.md (schema deltas applied on hpg5)
Resume file: None
