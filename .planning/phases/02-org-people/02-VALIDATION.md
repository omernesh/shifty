---
phase: 02
slug: org-people
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (E2E) + Vitest (unit; tests/unit/) + psql for migration smoke |
| **Config file** | `tests/playwright.config.ts` (Wave 0 installs if absent), `tests/unit/vitest.config.ts` |
| **Quick run command** | `npm run test:unit -- --run` |
| **Full suite command** | `npm run test:e2e && npm run test:unit -- --run` |
| **Estimated runtime** | ~90 seconds (unit ~10s + e2e ~80s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run`
- **After every plan wave:** Run `npm run test:e2e && npm run test:unit -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Filled in by planner during plan creation. Every task referenced in `*-PLAN.md` files must have a row here with a concrete automated command OR be flagged as Manual-Only below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _to-fill_ | _to-fill_ | _to-fill_ | ROST-XX | T-02-XX | _to-fill_ | unit/e2e | `_to-fill_` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/playwright.config.ts` — install + configure if missing (RESEARCH §Validation Architecture)
- [ ] `tests/unit/vitest.config.ts` — install + configure if missing
- [ ] `tests/fixtures/csv/` — fixture CSVs: clean.csv, smart-quote.csv, dup-email.csv, bidi-mark.csv
- [ ] `tests/fixtures/db/seed-phase2.sql` — minimum tenant + admin user for e2e
- [ ] `tests/unit/canonicalize.spec.ts` — stubs for ROST-04, ROST-06 (smart-quote stripping)
- [ ] `tests/unit/color-palette.spec.ts` — stubs for ROST-09, ROST-10 (round-robin + adjacent-collision)
- [ ] `tests/unit/role-tag-canonical.spec.ts` — stubs for ROST-11 (lowercase kebab-case)
- [ ] `tests/e2e/roster-csv-import.spec.ts` — happy-path 50-row import, < 10s wall clock excluding email dispatch
- [ ] `tests/e2e/soldier-crud.spec.ts` — single-row create/edit/archive
- [ ] `tests/e2e/tenant-isolation.spec.ts` — forge test (manager A cannot read tenant B soldier)

*If existing infrastructure covers any of the above, omit the install step but keep the fixture/test row.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Magic-link email arrives in real inbox + RTL renders correctly | ROST-08 | Resend free-tier dispatch is async; visual RTL check needs human eyes on Gmail/Outlook web | After CSV import, check the seeded admin's Resend dev inbox; confirm Hebrew name renders right-to-left, link click lands on `/api/auth/callback/email` and signs the soldier in. |
| Calendar color picker visual contrast in profile page | ROST-09 | Color-blind / contrast judgment | Open `/my_profile`, verify each of the 24 swatches is distinguishable on light theme. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
