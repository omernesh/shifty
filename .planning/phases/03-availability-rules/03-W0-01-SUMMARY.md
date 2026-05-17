---
phase: 03-availability-rules
plan: W0-01
subsystem: tenant-isolation-framework-constraint-doc
tags:
  - prd-amendment
  - tenant-isolation
  - layer-2
  - rls-inactive-for-budibase
  - post-pivot
  - doc-only
  - phase3-wave-0
dependency_graph:
  requires:
    - docs/PRD.md (pre-existing §8.3 amendment paragraph from commit 06170d8, 2026-05-17 post-pivot revision)
    - docs/BUDIBASE-CONVENTIONS.md §2 (empirical evidence — RLS-incompatibility spike findings)
    - .planning/ROADMAP.md (W0-01 plan-line entry, pre-existing from commit 06170d8)
  provides:
    - "PRD §8.3 amendment paragraph verified to encode all six required checkpoints (a)..(f) — load-bearing reference for all Phase 03+ planning"
    - "ROADMAP.md W0-01 plan-line verified to cross-link PRD §8.3 amendment + BUDIBASE-CONVENTIONS.md §2"
  affects:
    - "W0-04 (Layer-2 CI gate) — gate's existence is documented in PRD §8.3 as the post-pivot enforcement mechanism; the doc commitment is now formally locked"
    - "Phase 04 FastAPI solver — PRD §8.3 explicitly preserves Layer 5 for direct-DB consumers; solver plan can rely on RLS being live for its (non-superuser) connection"
    - "All Phase 03 Wave 1+ Builder UI work — readers of PRD §8.3 will not be misled into believing RLS is active for Budibase queries"
tech_stack:
  added: []
  patterns:
    - "No-op verification pattern: when prior planning already produced the artifact in final shape, the executor's job is to verify the six checkpoints are present and NOT rewrite the paragraph (per plan instruction)"
key_files:
  created:
    - .planning/phases/03-availability-rules/03-W0-01-SUMMARY.md
  modified: []
decisions:
  - "PRD §8.3 amendment paragraph (lines 780–795) is the canonical post-pivot tenant-isolation framework-constraint statement; the original §8.3 'Enforcement' paragraph at line 778 is historically locked and superseded — do NOT edit it"
  - "Layer 2 (`WHERE tenant_id = '{{ Current User.tenantId }}'::uuid`) is the top defense for every Budibase-mediated domain-table Query; CI gate at tools/check-bb-queries.mjs (built in W0-04) is the enforcement mechanism"
  - "Layer 5 (Postgres RLS) policies stay in schema; inactive for Budibase clients (superuser bypass), active for the FastAPI solver in Phase 04 (will connect as a non-superuser role)"
metrics:
  duration_minutes: 5
  completed: 2026-05-17
  tasks_completed: 2
  files_modified: 0
  files_created: 1
---

# Phase 03 Plan W0-01: PRD §8.3 Amendment + ROADMAP Cross-Link Summary

Verified the §8.3 amendment paragraph + ROADMAP W0-01 cross-link landed in commit `06170d8` already encode every post-pivot tenant-isolation framework constraint required by the plan; no edits to either file were needed.

## Outcome

Both tasks resolved as **no-op verifications**. The 2026-05-17 post-pivot planning baseline commit (`06170d8 docs(pivot): post-Budibase planning baseline`) had already authored the final-shape amendment to PRD §8.3 and the cross-linked plan-line in ROADMAP.md Phase 3. This plan's job — per its own instructions ("verify the amendment is complete, consistent, and properly cross-linked — NOT to rewrite it from scratch") — is the verification pass.

## Final state of PRD §8.3 amendment paragraph (paraphrased)

The amendment paragraph (PRD lines 780–795) opens with the heading `**AMENDMENT — 2026-05-17 (post-Budibase pivot):**` and reads as follows in summary form (verbatim text in `docs/PRD.md`):

- **Opening sentence** establishes that the original four-layer defense remains the design target and that a fifth layer — Postgres Row-Level Security — was added in Phase 02 (migration 0014) as the originally-flagged §17 R4 "second layer."
- **Bridge sentence** states that empirical spike testing against Budibase 3.38.4 on 2026-05-17 (documented in `docs/BUDIBASE-CONVENTIONS.md` §2) established Layer 5 cannot be actively enforced for Budibase-mediated queries without custom code the team has chosen not to maintain.
- **Numbered list of four concrete blockers**:
  1. Budibase's Postgres integration cannot wrap user Queries in transactions → `SET LOCAL app.current_tenant` is silently discarded (auto-commit, no `BEGIN`/`COMMIT`).
  2. Multi-statement query bodies crash the integration's JS layer (`Cannot convert undefined or null to object`).
  3. `{{ Current User.tenantId }}` template bindings are parameterized (extended-protocol bound params), not textual substitution; `SET LOCAL` does not accept bound parameters.
  4. The Budibase Postgres connection runs as the `shifts` superuser, which bypasses RLS unconditionally per `pg_authid.rolsuper` semantics — RLS has been silently bypassed since Budibase first connected on 2026-05-16. Stated as the de facto state, not a regression introduced by the amendment.
- **Effective layer map for Budibase-mediated queries**:
  - Layers 1, 3, 4 unchanged.
  - **Layer 2 newly load-bearing as the top defense** — canonical filter `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid` on every domain-table Query, enforced by the CI gate at `tools/check-bb-queries.mjs` (Phase 03 Wave 0 deliverable).
  - Layer 5 policies remain in schema for future direct-DB consumers — names the FastAPI solver service (Phase 04, non-superuser connection) explicitly. Inactive for Budibase clients.
- **Closing sentence** restates that "Missing any layer is release-blocking" applies to the effective layer map, and Layer 5 inactivity is the explicit framework constraint, not a missing layer.

### Checkpoint coverage (all six present)

| Checkpoint | What it requires | Location in PRD |
|------------|------------------|-----------------|
| (a) | Layer 5 inactive for Budibase + superuser bypass + four concrete blockers | Lines 782–787 — opening sentence + numbered list |
| (b) | Layer 5 preserved for FastAPI solver (Phase 04), named explicitly | Line 793 — "the FastAPI solver service, when introduced in Phase 04, will connect as a non-superuser" |
| (c) | Layer 2 promoted to top defense with the canonical filter pattern | Line 792 — `WHERE tenant_id = '{{ Current User.tenantId }}'::uuid` verbatim |
| (d) | `tools/check-bb-queries.mjs` named as enforcement (built in W0-04) | Line 792 — names the tool + "Phase 03 Wave 0 deliverable" |
| (e) | "Missing any layer is release-blocking" restated against the effective map | Line 795 — final paragraph of the amendment |
| (f) | Explicit cross-reference to `docs/BUDIBASE-CONVENTIONS.md` §2 | Line 782 — "results documented in `docs/BUDIBASE-CONVENTIONS.md` §2" |

The paragraph reads cleanly without requiring the reader to also have BUDIBASE-CONVENTIONS.md open — the cross-link is a "see also for the empirical evidence," not a "see for the full story."

## Drift found in ROADMAP.md

**None.** The W0-01 plan-line entry at `.planning/ROADMAP.md` line 97 names both targets accurately:

> `03-W0-01-PLAN.md — PRD §8.3 amendment + ROADMAP cross-link: doc-only plan formalizing the L5→L2 framework constraint (Budibase superuser bypass of RLS; Layer 2 becomes top defense; Layer 5 preserved in schema for future direct-DB clients like the FastAPI solver). Updates PRD §8.3 "Enforcement" paragraph + cross-links BUDIBASE-CONVENTIONS.md §2.`

Both the PRD §8.3 amendment reference and the BUDIBASE-CONVENTIONS.md §2 cross-link are present and current. No edit required.

## Verification results

| Check | Command | Expected | Actual |
|-------|---------|----------|--------|
| Cross-reference to BUDIBASE-CONVENTIONS in PRD | `grep -c BUDIBASE-CONVENTIONS docs/PRD.md` | ≥1 | 2 |
| CI gate path named in PRD | `grep -c "tools/check-bb-queries.mjs" docs/PRD.md` | ≥1 | 1 |
| FastAPI solver named in PRD §8.3 area | `grep -n "FastAPI solver" docs/PRD.md` | match in §8.3 | line 793 (in §8.3 amendment) |
| ROADMAP W0-01 line names the PRD amendment | `grep -n "03-W0-01-PLAN.md" ROADMAP.md` then grep for PRD\|amendment | match | line 97 — names "PRD §8.3 amendment" + "BUDIBASE-CONVENTIONS.md §2" |

All checks pass.

## Code / schema / test footprint

**Zero non-doc changes.** `git diff --stat` for this plan shows only `.planning/phases/03-availability-rules/03-W0-01-SUMMARY.md` (new). No edits to:

- `docs/PRD.md` — already in final shape from commit `06170d8`.
- `.planning/ROADMAP.md` — already in final shape from commit `06170d8`.
- `db/migrations/` — out of scope (doc-only plan).
- `app/` — Budibase apps live in CouchDB (Builder UI source of truth); not touched.
- `tests/` — no test changes (doc-only plan).
- `tools/` — `tools/check-bb-queries.mjs` is W0-04 scope, not this plan.

## Deviations from Plan

**None.** The plan explicitly anticipates this outcome:

> "The amendment may already be in its final shape; verify the final pass for editorial polish only."
> "If accurate, no change is needed — only edit if the cross-references are stale or missing."

Both tasks resolved as clean verifications with no edits needed. The plan's instructions for the "no edit needed" branch were followed exactly.

## Decisions Made

1. **No-op verification was the correct execution path.** The 2026-05-17 post-pivot planning-baseline commit (`06170d8`) authored the amendment ahead of the W0-01 plan landing. Re-writing or stylistically polishing already-correct prose would be churn; the executor honored the plan's "only edit if missing/stale" gate.
2. **Reaffirmed: the original §8.3 paragraph at line 778 is historically locked.** The amendment supersedes the "four-layer defense / release-blocking bug" claim for Budibase-mediated queries; readers MUST read both paragraphs and apply the amendment's effective layer map. The original is preserved for traceability, not removed.
3. **The cross-link `PRD §8.3 → BUDIBASE-CONVENTIONS.md §2` is now a stable contract.** Any future planning that touches tenant isolation must respect this cross-reference; rewriting either side requires a coordinated update.

## Known Stubs

None. The amendment paragraph references the W0-04 CI gate (`tools/check-bb-queries.mjs`) as a "Phase 03 Wave 0 deliverable" — this is a forward-reference to a plan that will execute later in Wave 0, not a stub. The forward-reference is correct: the doc describes the framework constraint and its enforcement mechanism; W0-04 builds the enforcement mechanism. PRD §8.3 is not load-bearing on whether `check-bb-queries.mjs` exists today, only on its committed role in the layer map.

## Self-Check: PASSED

- `.planning/phases/03-availability-rules/03-W0-01-SUMMARY.md` exists (this file).
- No commits to `docs/PRD.md` or `.planning/ROADMAP.md` were attempted (verified clean — no edit needed).
- All four verification commands from the plan's `<verification>` block return the expected values.
- All six checkpoints (a)..(f) confirmed present in PRD §8.3 amendment paragraph (lines 780–795).
- ROADMAP.md line 97 confirmed to cross-link both targets.
