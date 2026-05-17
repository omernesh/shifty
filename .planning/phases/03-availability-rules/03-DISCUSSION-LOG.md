# Phase 3: Availability & Rules - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 03-availability-rules
**Areas discussed:** JS helper bundling, Layer-2 CI gate whitelist, snapshot tooling cadence, tenantId fallback scoping
**Scope of this session:** Wave 0 only (W0-01..W0-05). Wave 1+ gray areas deferred to a future session.

---

## Scope decision (pre-discussion)

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 3 W0 only (--to 3) | Run just W0; stop before W1 Builder UI work | ✓ |
| Phase 3 full (--only 3) | W0 + W1–W4 — hits Builder UI walls | |
| Full autonomous (--from 3) | Run all phases 3–7 + audit/complete/cleanup | |
| Stop — fix STATE.md first | Defer until STATE.md reconciled with SDK reality | |

**User's choice:** Phase 3 W0 only, --interactive mode.

---

## Pre-existing plans handling

| Option | Description | Selected |
|--------|-------------|----------|
| Leave in place — new plans use W0/W1 naming | Lowdefy-era 03-01..03-04 PLAN+SUMMARYs stay on disk; no name conflict with W0/W1 naming scheme | ✓ |
| Move them to _archive-lowdefy-era/ | Move into the existing archive dir | |
| Show me their contents first | Display headers before deciding | |

**User's choice:** Leave in place.
**Notes:** Lowdefy-era plans are historical record; the W0/W1 naming on the new plans guarantees no collision.

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| JS helper bundling approach (W0-03) | ROADMAP marks this TBD | ✓ |
| Layer-2 CI gate whitelist mechanism (W0-04) | Exemption shape (inline/JSON/prefix) | ✓ |
| Snapshot tooling cadence + execution location (W0-05) | Local vs hpg5; PR-time vs nightly | ✓ |
| tenantId fallback strategy (W0-02) | Trust conventions doc vs pre-scope fallback | ✓ |

**User's choice:** All four selected.

---

## W0-03: JS helper bundling

| Option | Description | Selected |
|--------|-------------|----------|
| Single-file IIFE bundle, pasted (Recommended) | esbuild --bundle --format=iife --global-name=Shifty into one git-tracked file | ✓ |
| Inline-copy per code block | Each code block pastes the helpers it needs | |
| npm package committed inside snapshot tarball | Private package + node_modules inside tarball — Budibase CE JS sandbox likely doesn't support require | |

**User's choice:** Single-file IIFE bundle.
**Notes:** All 26 unit tests must pass against the bundled file (Shifty.canonicalizeRoleTag etc.) — the bundle is the contract surface.

---

## W0-04: CI gate whitelist mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Inline allowlist in check-bb-queries.mjs (Recommended) | `const EXEMPT_QUERIES = [...]` at the top — 1-line PR diff per exemption | ✓ |
| Separate JSON file (tools/bb-query-exemptions.json) | Decouples data from code | |
| Query-name prefix convention (`_public_*`) | Self-documenting in Builder UI but easy to abuse via rename | |

**User's choice:** Inline allowlist.

---

## W0-05: snapshot tooling cadence + location

| Option | Description | Selected |
|--------|-------------|----------|
| PR-time only, run on hpg5 against live Builder (Recommended) | SSH/plink to hpg5; `budi backups --export` against shifty-budibase-app; commit to budibase-exports/ | ✓ |
| Locally + on hpg5, developer chooses (--local / --hpg5) | More flexibility but invites snapshot divergence | |
| PR-time AND nightly automated snapshot to NAS | Plus a cron-style nightly to `\\192.168.1.121\backups\shifty\budibase\` | |

**User's choice:** PR-time only, hpg5 only.

---

## W0-02: tenantId fallback scoping

| Option | Description | Selected |
|--------|-------------|----------|
| Light — trust the conventions doc; deep-dive only on failure (Recommended) | Assume Builder UI custom-field works; pre-build no fallback | ✓ |
| Fully scope the JOIN fallback up front | Write JOIN-to-app_user query pattern + gate adjustment proactively | |

**User's choice:** Light scoping.

---

## Claude's Discretion

- Exact esbuild flags for the IIFE bundle (minification, sourcemap presence)
- Whether the snapshot tarball naming includes the git SHA or just date+feature slug
- Whitelist entries beyond the seed list — added per-PR-need during Wave 1+

## Deferred Ideas

- Wave 1+ planning — shift_slot CRUD, planning_window, availability UI, 8-rule catalog UI. Separate discuss session when Wave 0 lands.
- Phase 3 UI-SPEC — only generated when Wave 1+ ships user-facing screens.
- Helper bundling watch task / build automation — only if W1+ surfaces friction.
- Snapshot diffing tooling that extracts meaningful JSON deltas — Phase 7 polish candidate.
