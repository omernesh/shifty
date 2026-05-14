// tests/unit/canonicalize.spec.ts
// B1 fix — VALIDATION Wave 0 requires a separate tests/unit/ surface for the
// smart-quote + bidi-mark canonicalizer (ROST-11, D-12).
//
// These tests thinly delegate to app/plugins/shifty-roster/src/helpers/canonicalize.js
// and cover the same fixtures as the plugin-colocated node:test file
// (app/plugins/shifty-roster/tests/canonicalize.test.mjs) but from a separate
// test surface so that Validation's explicit file-path checklist passes independently.
//
// Run: node --test --experimental-strip-types tests/unit/canonicalize.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeText } from '../../app/plugins/shifty-roster/src/helpers/canonicalize.js';

// ─── Kibbutz canary (ROST-11 load-bearing assertion) ─────────────────────────
// The middle character in the input is U+2019 (RIGHT SINGLE QUOTATION MARK).
// After canonicalization the apostrophe is gone: 'נועם גלאל' (no mark, no gap).
test('canonicalize: kibbutz canary — U+2019 stripped from "נועם ג’לאל"', () => {
  // Input contains U+2019 (right single quotation mark)
  const input = 'נועם ג’לאל';
  const expected = 'נועם גלאל';
  assert.equal(canonicalizeText(input), expected);
});

// ─── Bidi marks stripped (D-12) ──────────────────────────────────────────────
test('canonicalize: bidi marks stripped (U+200E, U+200F, U+202A–U+202E)', () => {
  for (const cp of [0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E]) {
    const mid = 'ABC' + String.fromCodePoint(cp) + 'DEF';
    const out = canonicalizeText(mid);
    assert.equal(
      out.indexOf(String.fromCodePoint(cp)),
      -1,
      `codepoint U+${cp.toString(16).toUpperCase()} not stripped from output`
    );
  }
});

// ─── Preservation rules ───────────────────────────────────────────────────────
test('canonicalize: Hebrew gershayim U+05F4 preserved', () => {
  // \" (U+05F4) is a Hebrew abbreviation mark used in ranks like סמ"ר — NOT a quote.
  assert.equal(canonicalizeText('סמ״ר דני'), 'סמ״ר דני');
});

test('canonicalize: ASCII apostrophe U+0027 preserved', () => {
  assert.equal(canonicalizeText("D'Angelo"), "D'Angelo");
});

// ─── Null / undefined handling ────────────────────────────────────────────────
test('canonicalize: null returns empty string', () => {
  assert.equal(canonicalizeText(null), '');
});

test('canonicalize: undefined returns empty string', () => {
  assert.equal(canonicalizeText(undefined), '');
});

// ─── Whitespace normalization ─────────────────────────────────────────────────
test('canonicalize: collapses internal whitespace and trims', () => {
  assert.equal(canonicalizeText('  ABC   DEF  '), 'ABC DEF');
});
