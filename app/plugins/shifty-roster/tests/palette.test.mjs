// Run: node --test app/plugins/shifty-roster/tests/palette.test.mjs
// Unit tests for the FROZEN 24-color soldier-calendar palette (D-14, D-15, ROST-06).
//
// W3 fix: the EXPECTED_PALETTE array below MUST be byte-equal to the FROZEN
// list in 02-UI-SPEC §"Color B" (lines 119–155). The array index IS the
// adjacency identifier — downstream code persists numeric indices to
// org_unit.last_color_index. A re-ordered or substituted hex would silently
// shift every soldier's color. assert.deepStrictEqual against the literal
// array catches this loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, pickNextColor, colorByIndex } from '../src/helpers/palette.js';

// EXPECTED_PALETTE — copy of the FROZEN 24-element list from UI-SPEC §"Color B".
const EXPECTED_PALETTE = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B',
  '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF', '#AEC7E8', '#FFBB78',
  '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#C7C7C7',
  '#DBDB8D', '#9EDAE5', '#393B79', '#637939', '#8C6D31', '#843C39',
];

// W3 fix — the load-bearing assertion: byte-equal match against the FROZEN list.
test('PALETTE is byte-equal to UI-SPEC §"Color B" FROZEN 24-element array', () => {
  assert.deepStrictEqual(PALETTE, EXPECTED_PALETTE);
});

test('PALETTE has exactly 24 entries', () => {
  assert.equal(PALETTE.length, 24);
});

test('every PALETTE entry matches /^#[0-9A-F]{6}$/i', () => {
  for (const hex of PALETTE) {
    assert.match(hex, /^#[0-9A-F]{6}$/i, `not a hex: ${hex}`);
  }
});

test('no duplicate hex values in PALETTE', () => {
  const unique = new Set(PALETTE);
  assert.equal(unique.size, PALETTE.length);
});

// pickNextColor — (lastIndex + 2) mod 24 per D-15.

test('pickNextColor(-1) returns 0 (sentinel: no prior assignment)', () => {
  assert.equal(pickNextColor(-1), 0);
});

test('pickNextColor(0) returns 2 (even-stride keeps neighbors visually distinct)', () => {
  assert.equal(pickNextColor(0), 2);
});

test('pickNextColor(22) wraps to 0', () => {
  assert.equal(pickNextColor(22), 0);
});

test('pickNextColor(23) wraps to 1', () => {
  assert.equal(pickNextColor(23), 1);
});

test('pickNextColor(null) returns 0', () => {
  assert.equal(pickNextColor(null), 0);
});

test('pickNextColor(undefined) returns 0', () => {
  assert.equal(pickNextColor(undefined), 0);
});

// colorByIndex — safe lookup with fallback to PALETTE[0].

test('colorByIndex(0) returns PALETTE[0]', () => {
  assert.equal(colorByIndex(0), PALETTE[0]);
});

test('colorByIndex(23) returns PALETTE[23]', () => {
  assert.equal(colorByIndex(23), PALETTE[23]);
});

test('colorByIndex out-of-range returns PALETTE[0]', () => {
  assert.equal(colorByIndex(24), PALETTE[0]);
  assert.equal(colorByIndex(-1), PALETTE[0]);
  assert.equal(colorByIndex(null), PALETTE[0]);
});
