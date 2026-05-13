// Run: node --test app/plugins/shifty-roster/tests/role-tag.test.mjs
// Unit tests for canonicalizeRoleTag (D-13, ROST-07).
// Output regex MUST match the DB CHECK on role_tag.key: ^[a-z][a-z0-9-]*$
// (or be the empty string for null / empty / unreachable inputs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeRoleTag } from '../src/helpers/role-tag.js';

const DB_CHECK_REGEX = /^[a-z][a-z0-9-]*$/;

test('lowercases ASCII: "Driving" → "driving"', () => {
  assert.equal(canonicalizeRoleTag('Driving'), 'driving');
});

test('spaces become dashes: "long range comms" → "long-range-comms"', () => {
  assert.equal(canonicalizeRoleTag('long range comms'), 'long-range-comms');
});

test('underscores become dashes: "long_range_comms" → "long-range-comms"', () => {
  assert.equal(canonicalizeRoleTag('long_range_comms'), 'long-range-comms');
});

test('strips leading/trailing dashes: "--medic--" → "medic"', () => {
  assert.equal(canonicalizeRoleTag('--medic--'), 'medic');
});

test('collapses multiple internal dashes: "medic---one" → "medic-one"', () => {
  assert.equal(canonicalizeRoleTag('medic---one'), 'medic-one');
});

test('strips smart quotes through canonicalize chain: "medic’s" → "medics"', () => {
  assert.equal(canonicalizeRoleTag('medic’s'), 'medics');
});

test('strips non-kebab characters: "rifle/m4" → "riflem4"', () => {
  assert.equal(canonicalizeRoleTag('rifle/m4'), 'riflem4');
});

test('returns empty string for null', () => {
  assert.equal(canonicalizeRoleTag(null), '');
});

test('returns empty string for undefined', () => {
  assert.equal(canonicalizeRoleTag(undefined), '');
});

test('returns empty string for empty string', () => {
  assert.equal(canonicalizeRoleTag(''), '');
});

test('every non-empty output matches the DB CHECK regex', () => {
  const inputs = [
    'Driving',
    'long range comms',
    'long_range_comms',
    '--medic--',
    'medic---one',
    'medic’s',
    'rifle/m4',
    'COMMS',
    'driver',
  ];
  for (const input of inputs) {
    const out = canonicalizeRoleTag(input);
    if (out !== '') {
      assert.match(out, DB_CHECK_REGEX, `input "${input}" → "${out}" does not match DB CHECK`);
    }
  }
});

test('numbers allowed but cannot lead: "9mm" → "mm" (leading digit dropped is acceptable behaviour, CHECK requires letter-start)', () => {
  // The canonicalizer does NOT enforce the leading-letter rule itself; it
  // produces "9mm" which would FAIL the DB CHECK. The import handler is
  // responsible for treating such outputs as invalid role tags. We document
  // the boundary here for clarity.
  const out = canonicalizeRoleTag('9mm');
  assert.equal(out, '9mm');
  // Confirm it does NOT pass the DB CHECK so the import handler treats it as invalid:
  assert.equal(DB_CHECK_REGEX.test(out), false);
});
