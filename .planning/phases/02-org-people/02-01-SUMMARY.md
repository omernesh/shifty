---
phase: 02-org-people
plan: 01
subsystem: db-schema
tags: [migration, rls, schema-delta, role-tag, palette, blocking-checkpoint]
status: awaiting-checkpoint-approval
requires:
  - db/migrations/0002_tenancy_and_org.up.sql (tenant, org_unit tables)
  - db/migrations/0009_rls_policies.up.sql (sealed RLS policy literal — reference only, not modified)
provides:
  - db/migrations/0011_role_tag.up.sql (per-tenant role_tag catalog + inline RLS)
  - db/migrations/0012_org_unit_last_color_index.up.sql (palette round-robin anchor column)
affects:
  - plan 02-02 (canonicalizeRoleTag contract — byte-equal CHECK regex)
  - plan 02-04 (manage_soldiers reads role_tag for autocomplete)
  - plan 02-06 (CreateSoldier writes org_unit.last_color_index)
  - plan 02-07 (membership/team flow)
  - plan 02-08 (CSV preview validRoleTagKeys pre-flight)
tech-stack:
  added: []
  patterns:
    - "Inline-RLS for post-0009 tenant-scoped tables (0009 sealed at schema_migrations.version=10)"
    - "Single-statement column-add migration with table-level CHECK constraint"
key-files:
  created:
    - db/migrations/0011_role_tag.up.sql
    - db/migrations/0012_org_unit_last_color_index.up.sql
  modified: []
decisions:
  - "Inline RLS policy in 0011 rather than reopening 0009 (Phase 1 P01 sequencing rule — 0009 is immutable)"
  - "`role_tag.key` CHECK regex `^[a-z][a-z0-9-]*$` is byte-equal to canonicalizeRoleTag output (single-contract enforcement)"
  - "`org_unit.last_color_index` defaults to -1 sentinel (not 0) so pickNextColor branches correctly for the first soldier in a fresh team"
  - "No CREATE INDEX on org_unit.last_color_index: idx_org_unit_tenant (0002) already covers the access pattern"
  - "No GRANT/REVOKE on role_tag: not append-only (admins will eventually edit/delete in v1.1)"
  - "Migration 0008_legacy_drop NOT in this plan — ships in plan 02-09 after UI surfaces stop referencing /employees"
metrics:
  duration: ~2min (authoring); apply duration TBD after checkpoint approval
  tasks-completed: 2 of 3
  files-created: 2
  completed-date: 2026-05-13 (authoring); apply-date TBD
---

# Phase 02 Plan 01: Schema Deltas (role_tag + org_unit.last_color_index) Summary

Two new Postgres migrations authored and committed locally to unblock the rest of Phase 02-org-people: a per-tenant `role_tag` catalog with inline RLS (D-13, ROST-07) and a `last_color_index` anchor column on `org_unit` for the 24-color palette round-robin (D-15, ROST-06). The hpg5 apply step is a BLOCKING human-action checkpoint and is **NOT executed in this agent's run** — see "Checkpoint State" below.

## What Was Built

### `db/migrations/0011_role_tag.up.sql` (commit `167285d`)

Per-tenant role-tag catalog. Schema:

| Column | Type | Constraint |
|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() |
| `tenant_id` | UUID | NOT NULL REFERENCES tenant(id) ON DELETE CASCADE |
| `key` | TEXT | NOT NULL CHECK (`key ~ '^[a-z][a-z0-9-]*$'`) |
| `label` | TEXT | COLLATE "he-x-icu" (nullable; optional Hebrew display) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| | | UNIQUE (tenant_id, key) |

Plus:
- `CREATE INDEX idx_role_tag_tenant ON role_tag(tenant_id)` (PERF-04 composite-index discipline)
- `ALTER TABLE role_tag ENABLE ROW LEVEL SECURITY`
- `DROP POLICY IF EXISTS tenant_isolation ON role_tag` (idempotent re-run guard, 0009 style)
- `CREATE POLICY tenant_isolation ON role_tag USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (...)` — byte-equal to 0009's canonical literal

**Verbatim CHECK regex on `role_tag.key`:** `^[a-z][a-z0-9-]*$`

### `db/migrations/0012_org_unit_last_color_index.up.sql` (commit `d94cdfa`)

Single-statement column-add:

```sql
ALTER TABLE org_unit ADD COLUMN last_color_index SMALLINT NOT NULL DEFAULT -1 CHECK (last_color_index BETWEEN -1 AND 23);
```

**Verbatim CHECK range on `org_unit.last_color_index`:** `BETWEEN -1 AND 23`

The `-1` sentinel encodes "no soldier color-assigned yet" so `pickNextColor(lastIndex)` in `app/plugins/shifty-roster/src/lib/palette.js` returns `palette[0]` for the first soldier in a fresh team. RLS is inherited from org_unit's existing `tenant_isolation` policy (set by 0009's DO-block loop) — no new policy needed.

## Checkpoint State

**Task 3 status:** BLOCKING — `## CHECKPOINT REACHED` returned to orchestrator; awaiting user approval for live-Postgres mutation on hpg5.

**Apply log lines from hpg5:** _Pending checkpoint approval. Will be filled in by continuation agent after `applied` resume signal._

**`schema_migrations.version` after apply:** _Pending. Expected `12` with `dirty=false` after successful apply (currently `10` per Phase 1 STATE)._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Verify-script false positive] Reworded comment in 0012 to avoid literal "CREATE INDEX" substring**

- **Found during:** Task 2 verification
- **Issue:** The plan's `node -e` automated verify check uses `/CREATE\s+INDEX/i` regex to assert no index-creation statement exists in 0012. A descriptive comment in the migration originally read `-- No CREATE INDEX: org_unit.idx_org_unit_tenant already covers...`, which tripped the regex even though it was prose, not a SQL statement.
- **Fix:** Reworded the comment to `-- No new index: org_unit.idx_org_unit_tenant already covers...`. Semantic meaning preserved; SQL behavior unchanged.
- **Files modified:** `db/migrations/0012_org_unit_last_color_index.up.sql` (comment only, no DDL change)
- **Commit:** `d94cdfa` (part of the Task 2 commit)

**2. [Verify-spec gap — observation only, no code change] Plan verify-spec uses single-space token matching against analog files with aligned-column spacing**

- **Found during:** Task 1 verification
- **Issue:** The plan's literal token list (`'tenant_id UUID NOT NULL REFERENCES tenant'`) presumes single-space whitespace, but PATTERNS.md mandates "byte-equal" match to analog 0002/0007 which use aligned-column spacing (e.g., `tenant_id       UUID        NOT NULL REFERENCES tenant(id)`). These two requirements conflict.
- **Resolution:** Kept aligned-column spacing (matches the "byte-equal analog" requirement, which is the stronger contract). Verified semantically with `t.replace(/[ \t]+/g,' ')` normalization — all 10 required tokens present.
- **Files modified:** None.
- **Note for plan-checker:** future plans referencing these migrations as analogs should use whitespace-normalized token-matching, not literal substring matching.

### None blocked execution; both are documentation-level

## Authentication Gates

None encountered. Task 3 is a `human-action` checkpoint (not auth-gate) — see Checkpoint State above.

## Known Stubs

None. Both migrations are complete, syntactically self-contained `.up.sql` files. Apply-on-hpg5 (Task 3) is a deployment step, not a stub.

## Threat Flags

None. The Phase 2 STRIDE register (plan §<threat_model>) covers all surface introduced — T-02-01 (spoofing via tenant_id forgery), T-02-02 (cross-tenant read), T-02-06 (RBAC confusion via role_tag.key) all dispositioned `mitigate` with mitigations applied in the migrations themselves (RLS policy + tight CHECK regex). No new untracked surface introduced.

## Self-Check: PASSED (authoring phase)

- FOUND: `db/migrations/0011_role_tag.up.sql`
- FOUND: `db/migrations/0012_org_unit_last_color_index.up.sql`
- FOUND: `.planning/phases/02-org-people/02-01-SUMMARY.md`
- FOUND: commit `167285d` (Task 1)
- FOUND: commit `d94cdfa` (Task 2)

A second self-check pass will run after the Task 3 checkpoint is approved and the migrations apply cleanly to hpg5 (the continuation agent will append schema_migrations rows + psql output here).
