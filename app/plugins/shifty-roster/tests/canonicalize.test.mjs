// Run: node --test app/plugins/shifty-roster/tests/canonicalize.test.mjs
// Unit tests for canonicalizeText helper (D-12, ROST-11).
// Strip set: U+2019 (right single quotation mark) + U+200E/U+200F (LRM/RLM)
//   + U+202A..U+202E (LRE/RLE/PDF/LRO/RLO).
// Preservation: Hebrew gershayim U+05F4, ASCII apostrophe U+0027, all letters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeText } from '../src/helpers/canonicalize.js';

// Kibbutz canary — D-12 reason-of-being.
// The middle character in the input is U+2019 (RIGHT SINGLE QUOTATION MARK).
// After stripping, the apostrophe is gone and the name is "נועם גלאל".
test('kibbutz canary: strips U+2019 from "נועם ג’לאל"', () => {
  assert.equal(canonicalizeText('נועם ג’לאל'), 'נועם גלאל');
});

test('strips U+2019 (RIGHT SINGLE QUOTATION MARK)', () => {
  assert.equal(canonicalizeText('a’b'), 'ab');
});

test('strips U+200E (LRM)', () => {
  assert.equal(canonicalizeText('a‎b'), 'ab');
});

test('strips U+200F (RLM)', () => {
  assert.equal(canonicalizeText('a‏b'), 'ab');
});

test('strips U+202A (LRE)', () => {
  assert.equal(canonicalizeText('a‪b'), 'ab');
});

test('strips U+202B (RLE)', () => {
  assert.equal(canonicalizeText('a‫b'), 'ab');
});

test('strips U+202C (PDF)', () => {
  assert.equal(canonicalizeText('a‬b'), 'ab');
});

test('strips U+202D (LRO)', () => {
  assert.equal(canonicalizeText('a‭b'), 'ab');
});

test('strips U+202E (RLO)', () => {
  assert.equal(canonicalizeText('a‮b'), 'ab');
});

// Preservation rules — these characters MUST survive canonicalization.

test('preserves Hebrew gershayim U+05F4', () => {
  // סמ"ר is a Hebrew rank abbreviation using gershayim (NOT a quote).
  assert.equal(canonicalizeText('סמ״ר דני'), 'סמ״ר דני');
});

test('preserves ASCII apostrophe U+0027', () => {
  assert.equal(canonicalizeText("D'Angelo"), "D'Angelo");
});

test('preserves ASCII double-quote U+0022', () => {
  assert.equal(canonicalizeText('say "hi"'), 'say "hi"');
});

// Null / undefined / whitespace handling.

test('returns empty string for null', () => {
  assert.equal(canonicalizeText(null), '');
});

test('returns empty string for undefined', () => {
  assert.equal(canonicalizeText(undefined), '');
});

test('returns empty string for empty string', () => {
  assert.equal(canonicalizeText(''), '');
});

test('NFC normalization + whitespace collapse: trims and collapses runs', () => {
  assert.equal(canonicalizeText('  ABC   DEF  '), 'ABC DEF');
});

test('coerces non-string input to string', () => {
  assert.equal(canonicalizeText(42), '42');
});
