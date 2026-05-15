// tests/unit/color-palette.spec.ts
// B1 fix — VALIDATION Wave 0 requires a separate tests/unit/ surface for the
// 24-color Glasbey-style palette and the round-robin picker (D-14, D-15, ROST-06).
//
// These tests thinly delegate to app/plugins/shifty-plugin/src/helpers/palette.js
// (the merged Phase-2 plugin — see .planning/phases/02-org-people/02-11-PLAN.md;
// helper moved from shifty-roster as part of the plugin-registration hotfix).
//
// Run: node --test --experimental-strip-types tests/unit/color-palette.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, pickNextColor } from '../../app/plugins/shifty-plugin/src/helpers/palette.js';

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
