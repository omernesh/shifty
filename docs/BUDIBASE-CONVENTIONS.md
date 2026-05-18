# Budibase Conventions

> **Status:** active as of 2026-05-18 (post-Lowdefy pivot, updated post-Internal-API spike `55f657b`).
> **Scope:** how we work with Budibase 3.38.4 on hpg5. Load-bearing for all Phase 03+ planning.
> **Related:** [CLAUDE.md](../CLAUDE.md) (deployment + ops), [PRD.md](PRD.md) (product spec — §8.3 has an amendment, see below), [tools/budibase-cli/SPIKE-FINDINGS.md](../tools/budibase-cli/SPIKE-FINDINGS.md) (headless authoring reverse-engineering).

## 1. Source-of-truth boundaries

| Lives in | What | Why |
|---|---|---|
| **Git** | `db/migrations/*.sql`, `docker-compose.yml`, `.env.example`, `legacy/`, `tests/`, `docs/`, `tools/check-bb-queries.mjs` (Layer-2 gate), `tools/budibase-cli/` (Internal API client for headless work) | Reviewable, diffable, version-controlled |
| **CouchDB** (Builder UI runtime store) | All Budibase apps at runtime: screens, queries, automations, role/permission config, user-table extensions | Framework-mandated; CouchDB is where Budibase runs queries against |
| **PR-time snapshots** | `budibase-exports/YYYY-MM-DD-<feature>.tar.gz` from `tools/snapshot-budibase.ps1` (wraps `budi backups --export`) | PR audit trail; not source of truth, just the record. |
| **Nightly backups** to NAS | Whole-instance `budi backups --export` to `\\192.168.1.121\backups\shifty\budibase\` | Disaster recovery; CouchDB volume + MinIO volume + datasource config in one tarball |

**Implications:**
- **Builder UI is the canonical authoring surface for interactive work** — drag-drop screen design, automation graph editing, etc. CouchDB stores the result.
- **The Internal API at `/api/screens`, `/api/automations`, `/api/queries`, `/api/datasources`, `/api/global/configs/*` exposes the same JSON shape the Builder UI reads/writes** — proven by the 2026-05-17 spike (see [tools/budibase-cli/SPIKE-FINDINGS.md](../tools/budibase-cli/SPIKE-FINDINGS.md)). Headless authoring works via cookie auth. So:
  - For high-touch design work, use the Builder UI.
  - For repeatable / scripted work (CI seed data, mass mutation, config-as-code workflows), use `tools/budibase-cli/`. The cookie-auth path supports CRUD on every resource type.
- "Where does the UI change live?" — at runtime, CouchDB. At PR time, *either* a prose description + snapshot tarball, *or* (preferred when feasible) git-tracked JSON applied via the CLI. The choice depends on the phase plan.
- "Where does the schema change live?" — `db/migrations/0015+_*.sql`. PRs CAN show full diffs. This is where review + lint apply.
- "Where does business logic live?" — see §4.

## 2. Tenant isolation — the layer map after the pivot

PRD §8.3 originally specified five layers ("missing any layer is release-blocking"). After spike testing on 2026-05-17 against Budibase 3.38.4, **Layer 5 (Postgres RLS) is no longer actively enforced for Budibase-mediated queries** — Budibase's Postgres integration cannot set per-request session parameters (multi-statement queries crash the JS integration; `{{ ... }}` bindings are parameterized not textual; no plugin hook for pre-query injection without writing custom code we've chosen not to maintain).

| Layer | What | Status post-pivot |
|---|---|---|
| **1 — Session** | `tenant_id` derived from authenticated user, never from request input | ACTIVE — sourced from Budibase user-table extension (custom `tenantId` field) |
| **2 — Query** | Every domain-table SQL filter includes `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid` | **ACTIVE — newly load-bearing as the top defense.** Enforced by CI gate (`tools/check-bb-queries.mjs`) |
| **3 — Page auth** | Screens check Builder role-based permissions before rendering | ACTIVE — Builder UI role config |
| **4 — Request role** | Automations / mutations re-verify role before write | ACTIVE — Automation conditionals |
| **5 — Postgres RLS** | `FORCE ROW LEVEL SECURITY` + tenant-scoped policies | **POLICIES REMAIN IN SCHEMA, but inactive for Budibase clients.** Active for any direct-DB consumer (e.g., the future FastAPI solver service connecting as a non-superuser). |

**Why Layer 5 is silently inactive for Budibase:**
- Budibase connects as the `shifts` Postgres user, which is a SUPERUSER. Postgres docs: "Superusers and roles with the BYPASSRLS attribute always bypass the row security system." So RLS policies are never evaluated for Budibase-originated queries. Nothing to rip out — they're already not running.
- This has been true since the moment Budibase connected to Postgres on 2026-05-16. It was not a regression introduced by the pivot decision — the pivot decision made it visible.

**PRD §8.3 amendment (TODO during ROADMAP revision):** Layer 5 is preserved in the schema for future non-Budibase clients but is NOT actively enforced for Budibase Queries. Top defense for Budibase-mediated reads + writes is Layer 2, enforced by CI gate.

**The CI gate (`tools/check-bb-queries.mjs`, TBD in Phase 03 Wave 0):** pulls all queries via Public API (`POST /api/public/v1/queries/search`), parses `fields.sql`, and fails the build if any domain-table query lacks the canonical filter pattern. Domain tables enumerated from `db/migrations/`. Whitelist for queries that legitimately don't filter on tenant (e.g., `app_user` provisioning automations).

## 3. Tenant_id plumbing into Budibase

Budibase has no built-in multi-tenant SaaS model — its "tenants" concept is for separating WORKSPACES across customers, not for in-app row-level isolation. We extend Budibase's own user table with a `tenantId` field:

1. Builder UI → Settings → Users → schema → add custom field `tenantId` (type: text or string).
2. Populated at signup/invite redemption by a Budibase Automation (invite redemption inserts into `app_user` table with the right `tenant_id`; same Automation patches the Budibase user row with the matching `tenantId`).
3. Reference in every Query body as `{{ Current User.tenantId }}` — wrap in single quotes + cast `::uuid` (e.g. `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid`).
4. The Layer-2 CI gate verifies this pattern is present on every domain-table query.

**Caveats:**
- Budibase's Public API does not expose user-schema mutation on CE — adding the `tenantId` custom field is a one-time Builder UI action, captured in the snapshot tarball.
- `{{ Current User.tenantId }}` is parameterized (not textual substitution), so SQL injection risk is bounded.

## 4. Where to write what — the architecture-decision map

| Concern | Lives where | Notes |
|---|---|---|
| Postgres schema | `db/migrations/00NN_<name>.up.sql` (golang-migrate, numbered, idempotent) | Applied via `docker compose run --rm migrate` |
| Pure-function helpers (canonicalize, palette, role-tag, availability-source) | `legacy/shifty-handlers/helpers/` — PORT VERBATIM to a new git-tracked location once we wire them into a Budibase JS code block (TBD pattern in Phase 03 Wave 0) | 26 unit tests stay; framework-agnostic |
| Mutation logic | Budibase Automations (declarative steps) or JS code blocks (sandboxed) | NOT custom Postgres functions; NOT custom Budibase plugins (per "minimum custom code" principle) |
| Read queries | Authored in Builder UI → Queries (PostgreSQL data source) OR via `tools/budibase-cli/` for scripted/repeatable creation. MUST include `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid` on domain tables — CI gate enforces, regardless of which surface authored the query. |
| Screens | Authored in Builder UI for interactive design; mass mutation / CI seed via `tools/budibase-cli/` (`POST /api/screens`). PR shape is prose + snapshot tarball today; future config-as-code option via git-tracked JSON applied through the CLI. |
| Automations | Same as screens — Builder UI for interactive authoring, `tools/budibase-cli/` (`POST /api/automations`) for scripted creation. |
| User-schema customizations (e.g., `tenantId` field) | `tools/budibase-cli/` against `/api/global/configs/*`. Builder UI also works but the API path is reproducible / git-trackable. |
| Auth | Budibase built-in (email/password or SSO). Email magic-link via Auth.js EmailProvider is REPLACED by Budibase's own auth flow. RTL email template from `legacy/dispatch/resend.js` may still be useful for application-level email (invite emails, schedule notifications) but not for auth. |
| Notifications dispatcher | Budibase Automations with HTTP step → Resend / WAHA / Web Push (these stay as external services; only the orchestration changes) |
| Tests — unit | Existing Vitest setup against pure-function helpers, unchanged |
| Tests — integration | Knex-based tests against the migrated Postgres DB, unchanged |
| Tests — E2E | Playwright against the live Budibase Builder/runtime URL (`https://apps.nesher.co`) |

## 5. GSD plans for Budibase work — the new plan shape

Each `.planning/phases/<phase>/PLAN-<N>.md` describes:

1. **Schema changes** — numbered SQL files, idempotent, applied via `migrate` runner. Reviewable in PR.
2. **Pure-function helpers** — TS/JS files with unit tests. Reviewable in PR.
3. **Builder-UI artifacts** — described in PROSE with explicit specs:
   - Screen list: page name, role permissions, components, data bindings (in `{{ ... }}` syntax)
   - Query list: name, SQL body (with the canonical tenant filter), bindings, expected schema
   - Automation list: trigger, steps, error paths
   - Wireframe / screenshot references for non-trivial screens
4. **Layer-2 gate update** — `tools/check-bb-queries.mjs` (resolved by W0-04) enforces the canonical tenant filter on every domain-table Query.
   - **New domain table introduced in a migration?** No gate edit needed. `getDomainTables()` parses `db/migrations/*.up.sql` at run-time and picks up the new `CREATE TABLE` automatically.
   - **New legitimate exemption needed** (e.g., a future bulk-import Automation that creates tenant-bound rows from an admin context)? Add a 1-line entry to `EXEMPT_QUERIES` in `tools/check-bb-queries.mjs` with a comment naming the reason. The PR diff is the audit trail (per D-03, no separate JSON file or marker comment in the SQL body).
   - **Run before opening a PR** that adds a Budibase Query: `npm run test:check-bb-queries` (live API mode against hpg5; requires `BUDIBASE_API_KEY` in env) AND `npm run test:check-bb-queries-selftest` (offline; runs unconditionally).
   - **No CI provider yet.** Until `.github/workflows/` or husky is added, the gate is opt-in for contributors. Any Wave 1+ plan that introduces a new domain-table Query MUST run the gate locally before opening the PR — that's the contract that holds until CI exists.
5. **Snapshot tarball** — at PR open, run `pwsh tools\snapshot-budibase.ps1 -FeatureSlug "<slug>"` from the local workstation; the wrapper SSHes to hpg5, runs `@budibase/cli`'s `budi backups --export` against the live stack (in an ephemeral `node:22-alpine` container on the `shifts-manager_default` docker network), copies the tarball back, atomically places it at `budibase-exports/YYYY-MM-DD-<slug>.tar.gz`, and prints the suggested commit message. Reviewer can extract + grep to spot-check what changed. See `tools/snapshot-budibase.ps1` for the empirical-PsExec-gating notes; resolved in `.planning/phases/03-availability-rules/03-W0-05-SUMMARY.md`.

**Done criteria** for a Budibase plan:
- Schema migration applies clean against test DB
- Helper unit tests pass
- All described screens/queries/automations exist in the Builder UI on hpg5 (manual verification — author confirms; reviewer spot-checks)
- Layer-2 CI gate passes
- Snapshot tarball committed
- E2E spec for the user-visible flow passes against `https://apps.nesher.co`

## 6. Backup + disaster recovery

| Artifact | Backup method | Destination | Frequency | Retention |
|---|---|---|---|---|
| Postgres `shifts` DB | `docker compose exec postgres pg_dump shifts | gzip` | `\\192.168.1.121\backups\shifty\postgres\` | Daily 02:00 via Task Scheduler | 7 daily + 4 weekly |
| Budibase (CouchDB + MinIO + datasource config) | `budi backups --export` against running stack | `\\192.168.1.121\backups\shifty\budibase\` | Daily 02:15 via Task Scheduler | 7 daily + 4 weekly |
| `budibase-couchdb-data` volume snapshot | `docker run --rm -v shifty_budibase-couchdb-data:/data -v $(pwd):/backup alpine tar czf /backup/couch-$(date +%F).tgz /data` (requires stack stop — only as a quarterly belt-and-braces) | NAS same path | Quarterly | Last 4 |

**Restore drill (quarterly, MANDATORY):** stand up a throwaway compose stack from the latest tarball + pg dump on hpg5 in `C:\shifts-manager-restore-test\`, verify Budibase boots + can read the Postgres data. Without this drill, the backup is theatre.

**Recovery SLO** (if hpg5 dies, NAS intact): 1 hour to a working stack on replacement hardware from latest nightly snapshots. Sole acceptable loss = <24h of Builder UI changes.

## 7. What's gone (Lowdefy era)

- `app/*.yaml` source-of-truth — gone. Builder UI replaces it.
- Custom request plugins (`shifty-roster`, `shifty-auth`, `shifty-audit-writer`) — gone. Functionality moves to Builder UI Queries + Automations.
- `lowdefy build` step — gone. Builder UI's Publish replaces it.
- `withTenantTx` primitive — DEAD per Layer-5 inactive-for-Budibase decision. Audit-table writes (`schedule_audit`) remain but via Automations.
- Phase 1 + 2 Lowdefy outputs (YAML pages, blocks, plugins) — preserved at `legacy/` for reference; not used at runtime.

## 8. What's preserved (porting roadmap)

- **All 14 SQL migrations** — schema posture identical. No changes.
- **4 pure-function helpers + 26 unit tests** (`legacy/shifty-handlers/helpers/`) — port verbatim once we wire them into a Budibase JS code block (pattern TBD in Phase 03 Wave 0).
- **RTL email template** (`legacy/dispatch/resend.js`) — port to a Budibase Automation HTTP step for application emails (invite redemption, schedule notifications). Not for auth (Budibase has its own).
- **Auth.js KnexAdapter / callbacks / providers** — REPLACED by Budibase auth; do not port. The `app_user` table extension (`tenant_id`, `role`, `soldier_id` columns) stays in the schema; populated by Automations on Budibase user creation.
- **Log-redact middleware** — port to a JS Automation that runs on dispatch.
- **Playwright test patterns + helpers** — keep; retarget against Budibase URLs.

## 9. Operations cheatsheet (Budibase-specific)

```powershell
# PR-time snapshot (preferred — uniform across PRs, atomic, idempotent)
pwsh tools\snapshot-budibase.ps1 -FeatureSlug "<slug>"

# One-off snapshot (no script) — used when you need a checkpoint mid-iteration
# without staging it for commit. Runs @budibase/cli inside an ephemeral
# container on the shifty network. Note: `budi` is NOT inside the apps image
# (W0-05 empirical finding); it must be installed per-invocation as below.
plink -ssh -l claude -pw "<pw>" -batch -hostkey "<key>" hpg5 `
  "powershell -c \"docker run --rm --network shifts-manager_default -v C:/shifts-manager/.snapshot-stage:/work node:22-alpine sh -c 'npm install -g --silent @budibase/cli@3.38.4 && cd /work && budi backups --export quick.tar.gz --env /work/budi.env'\""

# Fetch a query body via Public API (for the Layer-2 gate)
curl -H "x-budibase-api-key: $env:BUDIBASE_API_KEY" `
     -H "x-budibase-app-id: app_dev_169e766804934fd18f2e20200d8fd22d" `
     -H "Content-Type: application/json" `
     -X POST "https://apps.nesher.co/api/public/v1/queries/search" `
     -d '{"name":""}'

# Re-introspect Postgres schema after a migration
# Builder UI -> Data -> PostgreSQL -> Fetch tables (NO API equivalent on CE)
```

## 10. Open items (resolve during Phase 03 Wave 0)

1. ~~**JS code block + helper integration pattern.** How does a Budibase JS automation/code block consume `legacy/shifty-handlers/helpers/canonicalize.js`? Bundle into a single file? Inline copy? Custom NPM package committed to the snapshot tarball? Spike during Phase 03 Wave 0.~~ **RESOLVED (2026-05-17, plan `03-W0-03`).** The 4 pure-function helpers are now bundled into a single IIFE at `tools/budibase-helpers/helpers.bundle.js` (~1.3 KB minified) exposing global `Shifty`. Builder UI JS code blocks consume the bundle via the **paste-as-fixture** pattern — see `tools/budibase-helpers/README.md` and `.planning/phases/03-availability-rules/03-W0-03-SUMMARY.md` for the full surface contract, consumption pattern, and update workflow.
2. ~~**Layer-2 CI gate implementation.** Write `tools/check-bb-queries.mjs` — pulls queries via Public API, parses SQL, asserts the canonical filter pattern on every domain-table query. Whitelist mechanism for legitimate exceptions (e.g., `app_user` provisioning).~~ **RESOLVED (2026-05-17, plan `03-W0-04`).** `tools/check-bb-queries.mjs` (503 lines) fetches queries via `POST /api/public/v1/queries/search`, validates each SQL body against the canonical filter pattern `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid`, and exempts query names listed in the inline `EXEMPT_QUERIES` allowlist (seeded with the two W0-02 invite-redemption queries per D-03). Domain tables are enumerated dynamically from `db/migrations/*.up.sql`. A `--self-test` mode runs offline and proves the validator is alive; `--list-domain-tables` is a debug helper. Wired into npm scripts: `test:check-bb-queries`, `test:check-bb-queries-selftest`, `test:check-bb-queries-unit`. **Run-it-manually procedure** documented in `.planning/phases/03-availability-rules/03-W0-04-SUMMARY.md` (no `.github/workflows/` or husky in this repo yet — gate is opt-in until a future CI provider is wired).
3. ~~**Budibase user-schema custom field flow.** Verify the Builder UI exposes adding a `tenantId` custom user field. If not, alternative: store tenant_id on the `app_user` table and JOIN per query (heavier but framework-aligned).~~ **SOLVABLE via Internal API as of spike `55f657b`** — see `tools/budibase-cli/SPIKE-FINDINGS.md`. The user-schema customization mechanism lives at `/api/global/configs/*`; mutating it via cookie auth is the canonical path. Will be exercised + closed by plan `03-W0-02` (rewritten 2026-05-18 as `autonomous: true`).
4. ~~**PR snapshot tooling.** Helper script (`tools/snapshot-budibase.ps1`) that calls `budi backups --export` and commits the tarball — used at PR open time.~~ **RESOLVED (2026-05-17, plan `03-W0-05`).** `tools/snapshot-budibase.ps1` (293 lines) is a PowerShell wrapper that SSHes to hpg5, runs `@budibase/cli@3.38.4` inside an ephemeral `node:22-alpine` container attached to `shifts-manager_default` (the apps image does NOT ship `budi` — empirical finding documented in the script header), copies the tarball back via `pscp`, atomically places it at `budibase-exports/YYYY-MM-DD-<slug>.tar.gz`, and prints the suggested commit message. Idempotent (re-running overwrites cleanly). `.gitignore` excludes `budibase-exports/*.tmp` + `*.partial` but tracks the finalized `.tar.gz`. PsExec is NOT required for snapshot runs (only for one-time `docker pull node:22-alpine` bootstrap — script detects and prints a recovery hint). First inaugural snapshot: `budibase-exports/2026-05-17-w0-05-inaugural.tar.gz` (1,564,718 bytes; SHA256 `E7CA45BF4129A11D25E0E651EC7BABF492ED63319C77260EDAB84818418D08E2`). Full empirical findings + run-it procedure in `.planning/phases/03-availability-rules/03-W0-05-SUMMARY.md`.
5. ~~**PRD §8.3 amendment.** During ROADMAP revision, write the explicit amendment recording the framework constraint + Layer-2 promotion.~~ **RESOLVED (2026-05-17, plan `03-W0-01`).** §8.3 amendment was already complete at the post-pivot baseline (`06170d8`); `03-W0-01` confirmed presence of checkpoints (a)–(f) — Layer 5 inactive for Budibase clients + 4 concrete blockers, Layer 5 preserved for FastAPI solver, Layer 2 promoted to top defense, CI gate named as enforcement, "release-blocking" rule restated against effective layer map, and explicit cross-link to §2 above. See `.planning/phases/03-availability-rules/03-W0-01-SUMMARY.md`.

---

**Wave 0 status (2026-05-18):** All 5 items above are resolved or solvable. Phase 3 W1+ planning can begin.

---
*Conventions doc written 2026-05-17 after stack pivot. Update as Phase 03 Wave 0 resolves open items.*
