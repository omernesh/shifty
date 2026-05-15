// tests/unit/role-tag-canonical.spec.ts
// B1 fix — VALIDATION Wave 0 requires a separate tests/unit/ surface for the
// role-tag kebab-case canonicalizer (D-13, ROST-07).
//
// These tests thinly delegate to app/plugins/shifty-plugin/src/helpers/role-tag.js
// (the merged Phase-2 plugin — see .planning/phases/02-org-people/02-11-PLAN.md;
// helper moved from shifty-roster as part of the plugin-registration hotfix).
//
// Run: node --test --experimental-strip-types tests/unit/role-tag-canonical.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeRoleTag } from '../../app/plugins/shifty-plugin/src/helpers/role-tag.js';

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
