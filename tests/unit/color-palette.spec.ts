// tests/unit/color-palette.spec.ts
// B1 fix — VALIDATION Wave 0 requires a separate tests/unit/ surface for the
// 24-color Glasbey-style palette and the round-robin picker (D-14, D-15, ROST-06).
//
// These tests thinly delegate to tools/budibase-helpers/src/palette.js
// (the post-pivot location — see .planning/phases/03-availability-rules/03-W0-03-PLAN.md;
// the 4 pure-function helpers ported verbatim from the frozen Lowdefy-era snapshot at
// legacy/shifty-handlers/helpers/, now bundled as the global `Shifty` for Budibase JS
// code blocks. The legacy/ files remain on disk as historical record but are NOT the
// source-of-truth for new code).
//
// Run: node --test --experimental-strip-types tests/unit/color-palette.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, pickNextColor } from '../../tools/budibase-helpers/src/palette.js';

// ─── Palette size and uniqueness ──────────────────────────────────────────────
test('palette: PALETTE has 24 unique hex entries', () => {
  assert.equal(PALETTE.length, 24);
  assert.equal(new Set(PALETTE).size, 24);
});

// ─── Round-robin step-by-2 (W1 canary) ───────────────────────────────────────
// CRITICAL: pickNextColor(0) === 2 proves the step-by-2 stride is enforced.
// This assertion is the W1-flagged canary from the VALIDATION revision directive.
// Do NOT change the expected value to 1 or anything else without re-reading
// plan 02-02 (D-15 adjacency rule) and palette.js.
test('palette: pickNextColor(0) === 2 (step-by-2 stride canary)', () => {
  assert.equal(pickNextColor(0), 2);
});

// ─── Wraparound ───────────────────────────────────────────────────────────────
test('palette: pickNextColor(22) wraps to 0', () => {
  assert.equal(pickNextColor(22), 0);
});

// ─── Sentinel and null handling ───────────────────────────────────────────────
test('palette: pickNextColor(-1) returns 0 (sentinel: no prior assignment)', () => {
  assert.equal(pickNextColor(-1), 0);
});

test('palette: pickNextColor(null) returns 0', () => {
  assert.equal(pickNextColor(null), 0);
});

test('palette: pickNextColor(undefined) returns 0', () => {
  assert.equal(pickNextColor(undefined), 0);
});
