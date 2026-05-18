# Phase 3: Availability & Rules - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Scope of this discuss session:** Wave 0 only (5 plans: 03-W0-01..03-W0-05). Wave 1–4 plans (03-W1-01..03-W4-01) are deferred to a separate future discuss session — see "Deferred Ideas" below.

<domain>
## Phase Boundary

Phase 3 delivers everything the solver (Phase 4) needs as input: configured `shift_slot` rows, opened `planning_window` rows with auto-generated `shift_instance` rows, soldier-declared availability via the hybrid range-blockout + per-slot UI, and the 8-rule catalog configured with per-soldier tightenings. This is also the first phase executing on Budibase 3.38.4 post-Lowdefy-pivot.

**Wave 0 scope (this session):** the 5 plans that unlock everything downstream — PRD §8.3 amendment, Budibase user-schema tenantId field, JS helper bundling pattern, Layer-2 CI gate, and PR snapshot tooling. Pure tooling/infra/doc work; no user-facing screens.

**Wave 1–4 scope (deferred):** shift_slot CRUD, planning_window + shift_instance generation, hybrid availability UI, 8-rule catalog UI. Discussed in a separate session when Wave 0 lands.

</domain>

<decisions>
## Implementation Decisions

### Wave 0 plan-shape decisions

- **D-01 (W0-03 helper bundling):** Single-file IIFE bundle. Build `helpers.bundle.js` via `esbuild --bundle --format=iife --global-name=Shifty` from the 4 source files under `legacy/shifty-handlers/helpers/`. Git-tracked at a new location to be chosen during planning (likely `tools/budibase-helpers/`). Builder UI JS code blocks paste either the bundle content or reference it via a fixture. Inline-copy and npm-package approaches were rejected (duplication explosion / Budibase CE JS sandbox doesn't support require).
- **D-02 (W0-03 unit tests):** All 26 existing unit tests must keep passing post-bundle. Test target is the bundled file (`Shifty.canonicalizeRoleTag(...)` etc.), not the per-source modules — so the bundle itself is the contract surface.
- **D-03 (W0-04 CI gate whitelist):** Inline `const EXEMPT_QUERIES = [...]` array at the top of `tools/check-bb-queries.mjs`. Each exemption is a 1-line PR diff, reviewer sees it explicitly. JSON-file and name-prefix conventions were rejected (decoupling overhead / silent rename bypass risk).
- **D-04 (W0-05 snapshot tooling location + cadence):** PR-time only, executed against the live Builder UI on hpg5. The script (`tools/snapshot-budibase.ps1`) SSHes to hpg5 (plink/PsExec), runs `budi backups --export` against the `shifty-budibase-app` container, copies the tarball back, commits to `budibase-exports/YYYY-MM-DD-<feature>.tar.gz`. No local mode, no nightly cron. Single live-Builder source of truth.
- **D-05 (W0-02 tenantId fallback):** Light scoping — trust the procedure in BUDIBASE-CONVENTIONS.md §3 (Builder UI custom-field mechanism on the Users schema). Fallback (JOIN-to-`app_user` per query) is documented but NOT pre-built; only triggered if W0-02 execution hits a hard Builder UI block. Keeps W0-02 scope tight.

### Wave 0 sequencing decisions

- **D-06 (W0 ordering):** W0-01 (PRD §8.3 doc amendment) is doc-only and can ship immediately, independent of all other W0 work. W0-03 (helper bundling) can run in parallel with W0-01. W0-02 (tenantId field) blocks W0-04 (CI gate needs `{{ Current User.shiftyTenantId }}` to verify against) and likely W0-05 (snapshot must capture the field). W0-04 blocks any Wave-1+ work (no Builder UI queries can ship without the gate). Suggested order: W0-01 ‖ W0-03 → W0-02 → W0-04 → W0-05.
- **D-07 (W0 stop point):** The autonomous run stops cleanly after W0-05 is verified. Wave 1+ work requires a fresh discuss session and likely the Builder UI installed locally + a manager seat on hpg5's instance.

### Claude's Discretion

- Choice of exact build command for the IIFE bundle (esbuild flags, output minification). Reviewed during W0-03 plan.
- Whether the snapshot tarball naming convention includes the git SHA or just date+feature slug. Reviewed during W0-05 plan.
- Whitelist entries beyond the initial seeding — added on a per-PR-need basis during downstream phases.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Post-pivot conventions (load-bearing)
- `docs/BUDIBASE-CONVENTIONS.md` — source-of-truth boundaries, post-pivot tenant-isolation layer map, tenantId plumbing procedure (§3), plan shape (§5), backup/DR. Every W0 plan must align with this doc.
- `docs/BUDIBASE-CONVENTIONS.md` §2 — explicit rationale for Layer 5 RLS being inactive for Budibase clients (superuser bypass); supports W0-01 amendment text.
- `docs/BUDIBASE-CONVENTIONS.md` §3 — step-by-step tenantId field procedure used by W0-02.
- `docs/BUDIBASE-CONVENTIONS.md` §4 — architecture-decision map: where pure-function helpers, mutations, queries, screens, auth, and tests live.

### Product spec
- `docs/PRD.md` §8.3 — the section being amended by W0-01. Current text describes 5-layer defense as if all 5 are active; amendment records the post-pivot reality.
- `.planning/ROADMAP.md` Phase 3 — full plan descriptions for W0-01..W0-05 and W1-01..W4-01. Each W0 plan-line is specific enough to act on with the decisions above.

### Reusable assets (from prior phases)
- `legacy/shifty-handlers/helpers/canonicalize.js` — smart-quote stripping + role-tag normalization. Port target for W0-03 bundle.
- `legacy/shifty-handlers/helpers/palette.js` — 24-color round-robin with last-index sentinel. Port target.
- `legacy/shifty-handlers/helpers/role-tag.js` — autocomplete + tenant-scoped uniqueness. Port target.
- `legacy/shifty-handlers/helpers/availability-source.js` — `manager_override > per_slot > range_blockout` precedence. Port target.
- `legacy/shifty-handlers/__tests__/` — 26 unit tests that gate the bundle.
- `db/migrations/` (0001..0014) — domain tables enumerated by W0-04 CI gate. Migration 0014 added `availability.planning_window_id` and `org_unit.template_picked_at` — those tables MUST be in the W0-04 enumeration.

### Tooling references
- `tools/check-queries.mjs` (Lowdefy-era, dead) — DO NOT PORT. W0-04 builds a fresh `tools/check-bb-queries.mjs` against the Budibase Public API, not against Lowdefy YAML. The old script is reference-only for what TYPES of patterns to match.

### Budibase Public API
- `POST /api/public/v1/queries/search` — endpoint W0-04 calls to enumerate all queries. Body includes per-query `fields.sql` text used for filter-pattern matching.
- `budi` CLI `backups --export` — wrapped by W0-05 PowerShell script. Requires container-context execution on hpg5.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **4 pure-function helpers + 26 unit tests** at `legacy/shifty-handlers/helpers/` — framework-agnostic. Port verbatim into the W0-03 bundle. Tests run with existing Vitest setup; bundle target adds an additional test invocation pattern (`Shifty.canonicalizeRoleTag` etc.).
- **RTL email template** at `legacy/dispatch/resend.js` (12 unit tests) — not in W0 scope but available for downstream phases.
- **Layer-2 enforcement habit** from Phase 1 (`tools/check-queries.mjs`, Lowdefy-era) — the *concept* of a CI gate is proven; W0-04 rewrites the implementation for Budibase queries.

### Established Patterns

- **Numbered SQL migrations, idempotent, applied via `migrate/migrate` golang-migrate compose service** — Phase 1 baseline. W0 introduces no schema changes, but every Wave-1+ plan will add migrations using this pattern.
- **PsExec wrapping for any docker command on hpg5 that pulls from a registry** (CLAUDE.md) — W0-05's snapshot script SSHes to hpg5; if `budi backups --export` invokes any registry-pulling step internally, the script must wrap with PsExec. Test during W0-05 execution.
- **Cloudflare Tunnel passthrough to `http://192.168.1.133:8080`** (CLAUDE.md) — Builder UI for snapshot work is reachable as `https://apps.nesher.co/builder`. PR-time snapshot tooling can hit either the public URL or directly `http://hpg5:8080/builder` via Tailscale.

### Integration Points

- **Postgres at `postgres:5432`** inside the docker network — Budibase reaches as a data source. W0-04's CI gate doesn't connect to Postgres; it reads SQL strings from the Budibase Public API.
- **Budibase Public API at `http://hpg5:8080/api/public/v1/...`** — W0-04 calls this. Requires the API key already provisioned (per memory: written to `.env` on hpg5 as `BUDIBASE_API_KEY` on 2026-05-17).

</code_context>

<specifics>
## Specific Ideas

- **W0-01 amendment text scope:** Update PRD §8.3 "Enforcement" paragraph (not the whole §8.3). The amendment records: (a) Layer 5 inactive for Budibase clients due to superuser bypass; (b) Layer 5 policies preserved in schema for future direct-DB consumers (the FastAPI solver in Phase 4); (c) Layer 2 becomes the top defense; (d) the CI gate is the enforcement mechanism. Cross-link to BUDIBASE-CONVENTIONS.md §2.
- **W0-03 bundle output path:** `tools/budibase-helpers/helpers.bundle.js` (subject to plan refinement). Source tree: `tools/budibase-helpers/src/` (copies of the 4 helpers + tests). Build script: `tools/budibase-helpers/build.sh` (or `.ps1`). Keep the Lowdefy-era `legacy/shifty-handlers/helpers/` directory intact as historical record.
- **W0-04 gate seed exemptions:** at minimum the Budibase Automation that provisions a new `app_user` row on invite redemption is exempt (it CREATES the tenant-bound row, so no tenantId filter applies). All read queries against `app_user` for already-provisioned users DO require the filter.
- **W0-05 commit message convention:** `chore(budibase): snapshot YYYY-MM-DD-<feature>` so reviewers can spot the snapshot commits in git log.

</specifics>

<deferred>
## Deferred Ideas

- **Wave 1+ planning** — shift_slot CRUD (W1), planning_window + shift_instance generation (W2), hybrid availability UI (W3), 8-rule catalog UI (W4). Each warrants its own discuss session when Wave 0 lands. Builder UI work is gray-area-heavy and benefits from interactive design discussion.
- **Phase 3 UI-SPEC** — Wave 1+ phases ship user-facing screens; a UI-SPEC.md will be generated when those waves start (gsd-ui-phase). Skip UI-SPEC for the Wave-0-only run.
- **Helper bundling automation** — if the bundle build becomes a frequent friction point during W1+ JS code block authoring, add a `npm run helpers:build` watch task. Not needed for W0 (helpers are stable, won't change during W0-03).
- **Snapshot diffing tooling** — Wave 1+ snapshots will be hard to review (CouchDB `_rev` noise). A future tool that extracts the meaningful JSON deltas (screen tree, query SQL, automation steps) belongs in Phase 7 polish.

</deferred>

---

*Phase: 3-availability-rules*
*Context gathered: 2026-05-17*
