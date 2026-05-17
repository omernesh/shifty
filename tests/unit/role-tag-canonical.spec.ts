// tests/unit/role-tag-canonical.spec.ts
// B1 fix — VALIDATION Wave 0 requires a separate tests/unit/ surface for the
// role-tag kebab-case canonicalizer (D-13, ROST-07).
//
// These tests thinly delegate to tools/budibase-helpers/src/role-tag.js
// (the post-pivot location — see .planning/phases/03-availability-rules/03-W0-03-PLAN.md;
// the 4 pure-function helpers ported verbatim from the frozen Lowdefy-era snapshot at
// legacy/shifty-handlers/helpers/, now bundled as the global `Shifty` for Budibase JS
// code blocks. The legacy/ files remain on disk as historical record but are NOT the
// source-of-truth for new code).
//
// Run: node --test --experimental-strip-types tests/unit/role-tag-canonical.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeRoleTag } from '../../tools/budibase-helpers/src/role-tag.js';

// ─── Basic lowercase kebab-case ───────────────────────────────────────────────
test('role-tag: lowercase kebab-case proof — "Driving" → "driving"', () => {
  assert.equal(canonicalizeRoleTag('Driving'), 'driving');
});

test('role-tag: spaces to dashes — "long range comms" → "long-range-comms"', () => {
  assert.equal(canonicalizeRoleTag('long range comms'), 'long-range-comms');
});

// ─── Dash normalization ───────────────────────────────────────────────────────
test('role-tag: trim leading/trailing dashes — "--medic--" → "medic"', () => {
  assert.equal(canonicalizeRoleTag('--medic--'), 'medic');
});

test('role-tag: collapse multi-dash — "medic---one" → "medic-one"', () => {
  assert.equal(canonicalizeRoleTag('medic---one'), 'medic-one');
});

// ─── Smart-quote stripping via canonicalizeText chain ─────────────────────────
test('role-tag: smart-quote (U+2019) stripped through canonicalizeText chain', () => {
  // medic's (with U+2019 right single quotation mark) → medics
  assert.equal(canonicalizeRoleTag('medic’s'), 'medics');
});

// ─── Null / empty handling ────────────────────────────────────────────────────
test('role-tag: null returns empty string', () => {
  assert.equal(canonicalizeRoleTag(null), '');
});

test('role-tag: empty string returns empty string', () => {
  assert.equal(canonicalizeRoleTag(''), '');
});

// ─── DB CHECK constraint compliance ──────────────────────────────────────────
// Every non-empty output MUST match the DB CHECK regex: ^[a-z][a-z0-9-]*$
// This is a belt-and-braces assertion — the same regex used in migration 0011.
test('role-tag: every non-empty output matches DB CHECK regex ^[a-z][a-z0-9-]*$', () => {
  const cases = ['Driving', 'long range comms', '--medic--', 'medic’s', 'COMMS'];
  const re = /^[a-z][a-z0-9-]*$/;
  for (const c of cases) {
    const out = canonicalizeRoleTag(c);
    if (out) {
      assert.match(out, re, `input "${c}" → "${out}" does not match DB CHECK regex`);
    }
  }
});
