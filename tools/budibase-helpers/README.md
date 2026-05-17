# `tools/budibase-helpers/` — Shifty helpers, bundled for Builder UI JS code blocks

A single IIFE bundle (`helpers.bundle.js`, ~1.3 KB minified) that exposes 4 pure
Shifty helpers as a global named `Shifty`, designed to be **pasted as-is into any
Budibase Builder UI JS code block** that needs canonical text normalization,
deterministic soldier coloring, role-tag canonicalization, or availability-source
precedence ranking.

This file is the canonical reference for the Shifty Budibase era; downstream Phase 3
plans (W1+ availability flows) consume the bundle via the paste-as-fixture pattern
documented below. `BUDIBASE-CONVENTIONS.md` §10 item #1 resolves to this README.

---

## Surface contract (the `Shifty.*` exports)

| Export                           | Shape                          | Semantics                                                                                                  |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Shifty.canonicalizeText(s)`     | `(string\|null\|undefined) → string` | NFC-normalize, strip `U+2019` smart quote + `U+200E..U+202E` bidi marks, collapse whitespace, trim.        |
| `Shifty.PALETTE`                 | `string[]` (length 24, frozen) | 24-color Glasbey-style perceptually-distinct hex palette. Index is persisted in `org_unit.last_color_index`. |
| `Shifty.pickNextColor(lastIdx)`  | `(number\|null\|undefined) → number` | Returns next palette index, jumping by 2 modulo 24 (D-15 adjacency). Null / `-1` returns 0.              |
| `Shifty.colorByIndex(idx)`       | `(number\|null\|undefined) → string` | Safe hex lookup; out-of-range / null falls back to `PALETTE[0]` so cell renderers never emit `undefined`. |
| `Shifty.canonicalizeRoleTag(s)`  | `(string\|null\|undefined) → string` | Pipeline: canonicalizeText → lowercase → spaces/underscores to dash → drop non-[a-z0-9-] → collapse + trim dashes. Output matches DB `role_tag.key` CHECK `^[a-z][a-z0-9-]*$` (caller still enforces leading-letter rule). |
| `Shifty.SOURCE_RANK`             | frozen `{manager_override:3, per_slot:2, range_blockout:1, default:0}` | Availability source precedence (PRD §7.6). Higher wins. Mirrored in SQL `CASE` expressions; drift-detection test in `tests/integration/availability-source-precedence.spec.ts`. |
| `Shifty.SOURCE_VALUES`           | `string[]`                     | `Object.keys(SOURCE_RANK)` — convenient list for select-box options.                                       |

The bundle test at `tests/unit/bundle-shifty-global.spec.ts` asserts each of these
remains reachable after every `npm run build`. CI fails if any export disappears.

---

## Quick-start: paste-as-fixture in a Builder UI JS code block

This is the **canonical consumption pattern** for downstream phases. The bundle's
minified source is pasted as the first block of any Builder UI JS code block that
needs a helper. Pattern:

```js
// === BEGIN Shifty helpers bundle (from tools/budibase-helpers/helpers.bundle.js, build 2026-05-17) ===
var Shifty = ...; // <-- the full ~1.3 KB minified IIFE goes here, verbatim
// === END Shifty helpers bundle ===

// Your code below uses Shifty.<name>:
const cleaned   = Shifty.canonicalizeText(name);         // soldier name normalization
const colorIdx  = Shifty.pickNextColor(lastIndex);       // round-robin coloring
const hex       = Shifty.PALETTE[colorIdx];              // resolve to hex
const tag       = Shifty.canonicalizeRoleTag(input);     // role-tag → kebab-case
const winsOver  = Shifty.SOURCE_RANK['manager_override'] // 3
                  > Shifty.SOURCE_RANK['per_slot'];      // 2 → true

return { cleaned, color: hex, tag };
```

The two `BEGIN` / `END` sentinels are load-bearing for the diff-against-source
workflow described under "Update workflow" below; do not remove them.

---

## Why paste-as-fixture (and not HTTP fetch / NPM tarball)

- **Sandbox network reliability.** The Budibase JS sandbox is browser-shaped with
  no guaranteed CDN access; an HTTP fetch per Automation invocation would add
  latency and a network-dep failure mode. A 1.3 KB inline paste eliminates both.
- **No per-Automation duplication of helper source.** The bundle is the single
  artifact; each Automation references it via the same `BEGIN…END` block. When a
  helper changes, the workflow is "re-paste the new bundle" rather than "find every
  inline copy of every helper".
- **Rejected alternatives (per `03-W0-03-PLAN.md` D-01):**
  - **NPM-package-in-snapshot-tarball** — Budibase apps export to a JSON snapshot;
    there is no `node_modules` to ship alongside.
  - **Inline-copy-per-Automation** — duplication explosion as more Automations land.
  - **HTTP fetch from a static-asset endpoint** — we do not have one (no static
    file server in front of Budibase that the sandbox can reliably reach).

---

## Why a single IIFE bundle (and not direct source copy-paste)

- One artifact, one update path. A future bug-fix in `canonicalize.js` produces
  one new `helpers.bundle.js`; the operator pastes that into N JS blocks (or a
  future tool diffs it for them). Without a bundle, every JS block would need to
  inline the helper-of-interest and any of its transitive imports
  (`role-tag.js` → `canonicalize.js`), and re-do every relative-path fixup.
- esbuild's `--format=iife --global-name=Shifty` collapses the 4 ESM modules into
  a single `var Shifty = (()=>{ … return {…} })();` expression — the exact shape
  Builder UI's eval-style JS runtime expects.

---

## Update workflow (when a helper changes — rare)

1. Edit the source under `tools/budibase-helpers/src/<name>.js`.
2. `cd tools/budibase-helpers && npm install && npm run build`.
3. `npm run test:unit` from the repo root — confirms both per-source tests and the
   bundle test still pass.
4. Open the new `helpers.bundle.js` and copy the full file contents.
5. In each Builder UI JS code block that consumes the bundle, replace the content
   between `// === BEGIN Shifty helpers bundle …` and `// === END Shifty helpers
   bundle ===` with the new bundle.
6. Re-deploy / re-publish the Budibase app via the W0-05 snapshot tarball workflow.

A v1.1 nice-to-have is a tool that introspects every Automation's JS block and
diffs the embedded bundle against the current `helpers.bundle.js`, surfacing
out-of-date pastes. Out of scope for W0.

---

## Build invocation

```bash
cd tools/budibase-helpers
npm install      # first time only — pulls esbuild ^0.24
npm run build    # writes helpers.bundle.js + helpers.bundle.js.map
```

esbuild flags applied by `build.mjs`:

```
--bundle --format=iife --global-name=Shifty
--platform=neutral --target=es2020
--minify --sourcemap=external
```

Output size (post-build, 2026-05-17): `helpers.bundle.js` ≈ 1.3 KB,
`helpers.bundle.js.map` ≈ 9.0 KB.

---

## Test contract

`tests/unit/bundle-shifty-global.spec.ts` evaluates the bundle and asserts:

- All 7 named exports (`canonicalizeText`, `PALETTE`, `pickNextColor`,
  `colorByIndex`, `canonicalizeRoleTag`, `SOURCE_RANK`, `SOURCE_VALUES`) are
  reachable on the `Shifty` global.
- Key invariants per export (smart-quote stripping, 24-color palette length and
  byte-equal first/last entries, step-by-2 stride, kebab-case shape, 4-tier
  precedence with frozen mutation rejection).

If a future change to `build.mjs` or `src/*.js` breaks any of these, the spec
fails in CI before the regression has a chance to be pasted into a Builder UI
code block.

The 3 source-level specs (`canonicalize.spec.ts`, `color-palette.spec.ts`,
`role-tag-canonical.spec.ts`) continue to exercise the underlying `src/*.js`
files directly — so a regression in source is caught even before the bundle is
rebuilt.

---

## File map

```
tools/budibase-helpers/
├── README.md              ← this file
├── package.json           ← esbuild devDep + `npm run build` script
├── build.mjs              ← esbuild driver (synthesizes .entry.mjs, then cleans it)
├── helpers.bundle.js      ← BUILD OUTPUT — paste this into Builder UI JS blocks
├── helpers.bundle.js.map  ← external sourcemap (sibling to bundle)
├── .gitignore             ← node_modules/ + .entry.mjs safety belt
└── src/
    ├── canonicalize.js          ← verbatim from legacy/shifty-handlers/helpers/
    ├── palette.js               ← verbatim from legacy/shifty-handlers/helpers/
    ├── role-tag.js              ← verbatim from legacy/shifty-handlers/helpers/
    └── availability-source.js   ← verbatim from legacy/shifty-handlers/helpers/
```

`legacy/shifty-handlers/helpers/` remains the frozen historical snapshot — do
not edit those files; treat this `tools/budibase-helpers/src/` location as the
new source of truth.
