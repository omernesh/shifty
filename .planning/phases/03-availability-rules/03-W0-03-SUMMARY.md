---
phase: 03-availability-rules
plan: W0-03
subsystem: build-tooling
tags: [helpers, bundling, esbuild, iife, budibase-js, post-pivot]
dependency_graph:
  requires:
    - "legacy/shifty-handlers/helpers/*.js (frozen Lowdefy-era helper source)"
    - "tests/unit/*.spec.ts (existing helper specs, 25 cases)"
    - "tests/integration/availability-source-precedence.spec.ts (SOURCE_RANK import)"
  provides:
    - "tools/budibase-helpers/helpers.bundle.js — single IIFE bundle for Builder UI JS code blocks (1.3 KB minified, exposes global `Shifty`)"
    - "tools/budibase-helpers/src/* — verbatim ports of 4 pure helpers (canonical post-pivot location)"
    - "tools/budibase-helpers/README.md — paste-as-fixture consumption pattern (canonical reference for Phase 03 W1+ plans)"
    - "tests/unit/bundle-shifty-global.spec.ts — 7-case contract test on the bundle's exports"
  affects:
    - "docs/BUDIBASE-CONVENTIONS.md §10 item #1 (RESOLVED with cross-link)"
    - "Future Builder UI JS code blocks (paste-as-fixture is now the documented pattern)"
tech_stack:
  added:
    - "esbuild ^0.24 (dev-dep scoped under tools/budibase-helpers/, NOT repo root)"
  patterns:
    - "Paste-as-fixture: minified IIFE bundle pasted as the first ~50 lines of any Builder UI JS code block, with BEGIN/END sentinels"
    - "Bundle-test-as-contract: tests/unit/bundle-shifty-global.spec.ts asserts the public Shifty.* surface; CI catches regressions before paste"
key_files:
  created:
    - "tools/budibase-helpers/src/canonicalize.js (verbatim port)"
    - "tools/budibase-helpers/src/palette.js (verbatim port)"
    - "tools/budibase-helpers/src/role-tag.js (verbatim port)"
    - "tools/budibase-helpers/src/availability-source.js (verbatim port)"
    - "tools/budibase-helpers/build.mjs (esbuild driver)"
    - "tools/budibase-helpers/helpers.bundle.js (1343 bytes, minified IIFE)"
    - "tools/budibase-helpers/helpers.bundle.js.map (9.0 KB external sourcemap)"
    - "tools/budibase-helpers/package.json (esbuild devDep + build script)"
    - "tools/budibase-helpers/.gitignore (node_modules + .entry.mjs safety belt)"
    - "tools/budibase-helpers/README.md (170 lines: surface + paste-as-fixture pattern + update workflow)"
    - "tests/unit/bundle-shifty-global.spec.ts (7 new cases)"
  modified:
    - "tests/unit/canonicalize.spec.ts (re-pointed import to tools/budibase-helpers/src/)"
    - "tests/unit/color-palette.spec.ts (re-pointed import)"
    - "tests/unit/role-tag-canonical.spec.ts (re-pointed import)"
    - "tests/integration/availability-source-precedence.spec.ts (re-pointed SOURCE_RANK import; flagged dead app/pages/my_availability.yaml drift assertion as W2+ follow-up)"
    - "docs/BUDIBASE-CONVENTIONS.md (§10 item #1 marked RESOLVED with cross-link)"
decisions:
  - "esbuild flags: --bundle --format=iife --global-name=Shifty --platform=neutral --target=es2020 --minify --sourcemap=external (per plan D-01; final output 1.3 KB vs. 5 KB target — well under budget)"
  - "Consumption pattern: paste-as-fixture (inline bundle paste with BEGIN/END sentinels) — chosen over HTTP-fetch (no static asset endpoint in Budibase + sandbox network unreliability) and inline-copy-per-Automation (duplication explosion)"
  - "esbuild dev-dep scoped under tools/budibase-helpers/package.json, NOT repo root (keeps repo-root dependency footprint minimal; repo-root package.json remains test-runner shell only)"
  - "Bundle test uses `new Function(bundleCode + '; return Shifty;')()` rather than indirect eval, because TS strict-mode module scope under --experimental-strip-types prevents an `eval`'d top-level `var` binding from being captured otherwise. Functionally equivalent: load bundle, capture global."
metrics:
  duration: "~30 minutes"
  completed: "2026-05-17"
  tasks_completed: "4 / 4"
  bundle_bytes: 1343
  test_count_before: 33
  test_count_after: 40
  new_test_cases: 7
---

# Phase 03 Plan W0-03: Helpers → tools/budibase-helpers/ + IIFE Bundle Summary

Verbatim-ported 4 pure-function helpers from `legacy/shifty-handlers/helpers/` to a new
git-tracked location at `tools/budibase-helpers/src/`, wired an esbuild IIFE bundle
pipeline producing a 1.3 KB minified `helpers.bundle.js` exposing global `Shifty`, re-pointed 4 existing test specs and added 7 new bundle-contract test cases (40 total, all green), and wrote a 170-line README documenting the paste-as-fixture consumption pattern for downstream Phase 03 W1+ plans.

## What was built

### Source ports (Task 1 — `1db6521`)

4 byte-identical copies from `legacy/shifty-handlers/helpers/` to `tools/budibase-helpers/src/`:

```
canonicalize.js        47 lines  — NFC normalize + smart-quote/bidi-mark stripper (D-12, ROST-11)
palette.js             47 lines  — 24-color FROZEN Glasbey-style palette + step-by-2 picker (D-14/D-15)
role-tag.js            47 lines  — lowercase kebab-case canonicalizer + canonicalizeText chain (D-13)
availability-source.js 33 lines  — frozen SOURCE_RANK enum + SOURCE_VALUES list (R-03-3)
```

All four diffs (`diff -q legacy/.../X vs tools/.../X`) return exit 0 — byte-for-byte port confirmed. `legacy/shifty-handlers/helpers/` remains the frozen historical snapshot per BUDIBASE-CONVENTIONS.md §8; the new `tools/budibase-helpers/src/` is the post-pivot source-of-truth for the next stack.

### Build pipeline (Task 2 — `9b3fc28`)

```
tools/budibase-helpers/
├── package.json         { devDep: esbuild ^0.24, script: "build": "node build.mjs" }
├── build.mjs            esbuild driver — synthesizes .entry.mjs that re-exports the 4 helpers
│                        then runs build() with --bundle --format=iife --global-name=Shifty
│                        --platform=neutral --target=es2020 --minify --sourcemap=external,
│                        and cleans up .entry.mjs in a finally block
├── helpers.bundle.js    1343 bytes — `var Shifty = (()=>{ ... return {…7 exports} })();`
└── helpers.bundle.js.map  9.0 KB external sourcemap
```

Smoke-test (Node REPL, eval'd bundle): `Shifty.canonicalizeText('נועם ג’לאל')` → `'נועם גלאל'` (U+2019 stripped). All 7 expected `Shifty.*` exports reachable.

### Test re-point + new bundle test (Task 3 — `aa27f8e`)

Import path changes (4 specs):

| Spec | Old | New |
| --- | --- | --- |
| `tests/unit/canonicalize.spec.ts` | `legacy/shifty-handlers/helpers/canonicalize.js` | `tools/budibase-helpers/src/canonicalize.js` |
| `tests/unit/color-palette.spec.ts` | `legacy/.../palette.js` | `tools/.../palette.js` |
| `tests/unit/role-tag-canonical.spec.ts` | `legacy/.../role-tag.js` | `tools/.../role-tag.js` |
| `tests/integration/availability-source-precedence.spec.ts` | `app/plugins/shifty-plugin/src/helpers/availability-source.js` (dead post-pivot) | `tools/.../availability-source.js` |

New spec `tests/unit/bundle-shifty-global.spec.ts` (7 cases) loads the minified bundle via `new Function(bundleCode + '; return Shifty;')()` and asserts the contract surface:

1. `Shifty.canonicalizeText` — U+2019 smart-quote stripping
2. `Shifty.PALETTE` — 24 entries; first `#1F77B4`, last `#843C39`
3. `Shifty.pickNextColor` — step-by-2 canary + wrap + null/-1 sentinel
4. `Shifty.colorByIndex` — out-of-range falls back to `PALETTE[0]`
5. `Shifty.canonicalizeRoleTag` — kebab-case + smart-quote chain
6. `Shifty.SOURCE_RANK` — 4-tier precedence + frozen mutation rejection
7. `Shifty.SOURCE_VALUES` — `[default, manager_override, per_slot, range_blockout]`

Test count: **33 → 40** (gained the 7 new bundle cases; no existing case was removed). Final `npm run test:unit`: `# pass 40 / # fail 0`.

### README + BUDIBASE-CONVENTIONS resolution (Task 4 — `8b25ea4`)

`tools/budibase-helpers/README.md` (170 lines) covers:

1. **Surface contract** — table of all 7 `Shifty.*` exports with shapes + semantics
2. **Quick-start** — concrete paste-as-fixture example with BEGIN/END sentinels and call-site code
3. **Why paste-as-fixture** — sandbox network unreliability + no static-asset endpoint
4. **Why a single IIFE** — one update path, esbuild collapses 4 ESM modules to one expression
5. **Update workflow** — `npm run build` → re-paste into every JS block (W0-05 snapshot tarball captures result)
6. **Build invocation + esbuild flags** — exact `cd && npm install && npm run build` recipe
7. **Test contract** — bundle-shifty-global.spec.ts + the 3 source-level specs
8. **File map** — full directory listing

`docs/BUDIBASE-CONVENTIONS.md §10 item #1` marked RESOLVED with cross-link to this summary + the README.

## Deviations from Plan

**1. [Rule 2 — Critical hygiene] `.entry.mjs` cleanup in `build.mjs`**
- **Found during:** Task 2.
- **Issue:** The plan's reference `build.mjs` snippet left the synthesized `.entry.mjs` file on disk after the build. This would leak a build artifact into the worktree on every run — and worse, since it has a `.mjs` extension at the package root, it could confuse the Node module resolver or `glob`-based tooling.
- **Fix:** Wrapped the `esbuild.build()` call in a `try/finally` that `rmSync`'s `.entry.mjs` regardless of build success/failure. Also added a `.gitignore` line for `.entry.mjs` as a safety belt.
- **Files modified:** `tools/budibase-helpers/build.mjs`, `tools/budibase-helpers/.gitignore`.
- **Commit:** `9b3fc28`.

**2. [Rule 3 — Blocking issue] Bundle test uses `new Function()` instead of indirect `eval`**
- **Found during:** Task 3.
- **Issue:** The plan's reference `bundle-shifty-global.spec.ts` snippet used `const indirectEval = eval; indirectEval('Shifty = (function(){ ... return Shifty; })();')` to capture the `Shifty` binding. Under `node --test --experimental-strip-types` (TypeScript strict-mode module scope), an `eval`'d top-level `var` does NOT bind into the enclosing module scope; the test would throw `Shifty is not defined`.
- **Fix:** Switched to `new Function(bundleCode + '; return Shifty;')()` — same load-bundle-and-capture-global semantics, but the function scope is explicit and the `var Shifty` from the IIFE is the return value of the constructed function. Functionally equivalent contract; mechanically what works under strict TS modules.
- **Files modified:** `tests/unit/bundle-shifty-global.spec.ts`.
- **Commit:** `aa27f8e`.

**3. [Documented follow-up — not a deviation, but flagged for W2+] Integration spec YAML-drift assertion**
- **Where:** `tests/integration/availability-source-precedence.spec.ts` lines 384–406 (the meta-test that asserts `app/pages/my_availability.yaml` contains the SQL `CASE` matching `SOURCE_RANK`).
- **Status:** The Lowdefy-era YAML at `app/pages/my_availability.yaml` is gone (deleted in the stack pivot). The drift assertion will throw `ENOENT` if the integration test ever runs.
- **Why this is not a W0-03 blocker:** The plan's `<background>` explicitly says "For W0-03, just confirm the import path is correct; whether the test actually executes is a Phase 3 W2+ concern." The SOURCE_RANK enum check at lines 357–360 is the active load-bearing assertion until the Budibase replacement query lands.
- **Action:** Added an inline comment in the spec flagging this as a W2+ follow-up; when the Budibase Automation/query that embeds the precedence CASE expression lands, that file path needs to be substituted for the dead YAML path.

No other deviations. The 4 source files are byte-identical to legacy; esbuild flags match plan D-01 exactly; bundle size (1.3 KB) is well under the 5 KB ceiling.

## Authentication Gates

None — no external service touched in this plan.

## Known Stubs

None. All artifacts are fully wired:
- The 4 source files are real ports of working helpers (not stubs).
- The bundle is a real esbuild output, not a placeholder.
- The 7 bundle tests assert real behavior, not just smoke "module loads".
- The README documents real-and-tested patterns (the build workflow has been executed; the paste-as-fixture example is the literal output shape).

## Threat Flags

None new. This plan adds a build-tool dev-dep (`esbuild`) scoped to `tools/budibase-helpers/`, which the `legacy/shifty-handlers/` snapshot already contained no equivalent of. The bundle is a static artifact with no network/data-plane surface. SOURCE_RANK / canonicalizeText etc. retain their original threat posture from PRD §8 — no new tenant-isolation, auth, or data-flow surface introduced.

## Final File Tree (`tools/budibase-helpers/`)

```
tools/budibase-helpers/
├── .gitignore               16 B  (node_modules/ + .entry.mjs)
├── README.md             ~7.5 KB  (170 lines, paste-as-fixture pattern + surface contract)
├── build.mjs              1.9 KB  (esbuild driver)
├── helpers.bundle.js     1343 B   (BUILD OUTPUT — minified IIFE)
├── helpers.bundle.js.map 9172 B   (external sourcemap)
├── package.json           634 B   (esbuild devDep + build script)
└── src/
    ├── availability-source.js   ~1.6 KB  (SOURCE_RANK + SOURCE_VALUES, frozen)
    ├── canonicalize.js          ~1.9 KB  (canonicalizeText + STRIP_REGEX)
    ├── palette.js               ~2.0 KB  (PALETTE + pickNextColor + colorByIndex)
    └── role-tag.js              ~2.3 KB  (canonicalizeRoleTag, imports canonicalizeText)
```

Bundle byte count (post-build): **1343 bytes minified** + 9172 bytes external sourcemap.

## Test Pass Breakdown

| Spec | Cases | Status |
| --- | ---: | --- |
| `tests/unit/canonicalize.spec.ts` | 7 | green (re-pointed) |
| `tests/unit/color-palette.spec.ts` | 6 | green (re-pointed) |
| `tests/unit/role-tag-canonical.spec.ts` | 8 | green (re-pointed) |
| `tests/unit/invite-email-rtl.spec.ts` | 12 | green (untouched — depends on legacy/dispatch/resend.js, not a W0-03 target) |
| `tests/unit/bundle-shifty-global.spec.ts` | 7 | green (NEW, exercises the IIFE bundle) |
| **Total** | **40** | **40 pass / 0 fail / 0 skip** |

Baseline before W0-03: 33 cases. Gain: +7 (the new bundle-test suite). The 26-cases-in-CONTEXT.md figure was a rough headline; actual was 33 baseline, 40 post-plan.

`tests/integration/availability-source-precedence.spec.ts` is NOT in the `npm run test:unit` glob (per plan `<background>`) and continues to require `PG_TEST_URL` + a running stack to run. Its import path was re-pointed to the new helper location; its YAML-drift sub-assertion is flagged for W2+ rework (see Deviation #3 above).

## How Builder UI JS Code Blocks Consume the Bundle (one-line example for grep)

```js
// === BEGIN Shifty helpers bundle ===  <…1.3 KB of minified IIFE pasted here…>  // === END Shifty helpers bundle ===  const name = Shifty.canonicalizeText(input); return { name, color: Shifty.PALETTE[Shifty.pickNextColor(lastIdx)] };
```

Full pattern + sentinels + update workflow: `tools/budibase-helpers/README.md`.

## Self-Check: PASSED

- `tools/budibase-helpers/src/canonicalize.js` — FOUND
- `tools/budibase-helpers/src/palette.js` — FOUND
- `tools/budibase-helpers/src/role-tag.js` — FOUND
- `tools/budibase-helpers/src/availability-source.js` — FOUND
- `tools/budibase-helpers/build.mjs` — FOUND
- `tools/budibase-helpers/helpers.bundle.js` — FOUND (1343 bytes)
- `tools/budibase-helpers/helpers.bundle.js.map` — FOUND
- `tools/budibase-helpers/package.json` — FOUND
- `tools/budibase-helpers/README.md` — FOUND
- `tests/unit/bundle-shifty-global.spec.ts` — FOUND
- Commit `1db6521` (Task 1 port) — FOUND in `git log`
- Commit `9b3fc28` (Task 2 bundle) — FOUND in `git log`
- Commit `aa27f8e` (Task 3 tests) — FOUND in `git log`
- Commit `8b25ea4` (Task 4 README) — FOUND in `git log`
- `npm run test:unit` returns `pass 40 / fail 0` — VERIFIED
- 4 source files byte-identical to `legacy/shifty-handlers/helpers/` via `diff -q` — VERIFIED
