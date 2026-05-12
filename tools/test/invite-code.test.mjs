// tools/test/invite-code.test.mjs
// Unit tests for Crockford base32 invite-code format (AUTH-04).
// Run with: node --test tools/test/invite-code.test.mjs
//
// Crockford base32 alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ
// (Excludes ambiguous chars I, L, O, U)
// Invite codes must be exactly 8 characters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const CROCKFORD_PATTERN = /^[0-9A-HJKMNPQRSTVWXYZ]{8}$/;

test('valid 8-char Crockford base32 matches', () => {
  assert.match('0123ABCD', CROCKFORD_PATTERN);
});

test('lowercase rejected', () => {
  assert.doesNotMatch('abcdefgh', CROCKFORD_PATTERN);
});

test('ambiguous char I rejected', () => {
  assert.doesNotMatch('1234567I', CROCKFORD_PATTERN);
});

test('ambiguous char L rejected', () => {
  assert.doesNotMatch('1234567L', CROCKFORD_PATTERN);
});

test('ambiguous char O rejected', () => {
  assert.doesNotMatch('1234567O', CROCKFORD_PATTERN);
});

test('ambiguous char U rejected', () => {
  assert.doesNotMatch('1234567U', CROCKFORD_PATTERN);
});

test('7-char string rejected', () => {
  assert.doesNotMatch('0123ABC', CROCKFORD_PATTERN);
});

test('9-char string rejected', () => {
  assert.doesNotMatch('0123ABCDE', CROCKFORD_PATTERN);
});
