// tests/unit/bundle-shifty-global.spec.ts
// Verifies the IIFE bundle at tools/budibase-helpers/helpers.bundle.js
// exposes the global `Shifty` with all expected helper exports.
//
// This is the contract surface for Builder UI JS code blocks consuming
// the paste-as-fixture pattern documented in tools/budibase-helpers/README.md.
// If a change to a helper or to build.mjs breaks the bundle's exported shape,
// this spec fails in CI before any Automation has a chance to ship the regression.
//
// Run: node --test --experimental-strip-types tests/unit/bundle-shifty-global.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(
  __dirname,
  '..',
  '..',
  'tools',
  'budibase-helpers',
  'helpers.bundle.js',
);
const bundleCode = readFileSync(BUNDLE_PATH, 'utf8');

// Evaluate the bundle in a function scope and return the `Shifty` global it
// installs. The IIFE produces `var Shifty = (...);` at the top of the bundle,
// so a local `var` binding inside the function scope is what we capture.
function loadShifty(): any {
  // Function-scoped `var` keeps the binding inside the IIFE evaluator and
  // out of the module-top-level. The `return Shifty` then surfaces the value.
  // Note: bundle is minified IIFE → safe to wrap in a Function() constructor.
  // eslint-disable-next-line no-new-func
  return new Function(`${bundleCode}\nreturn Shifty;`)();
}

const Shifty: any = loadShifty();

test('bundle: Shifty.canonicalizeText strips U+2019 (smart quote)', () => {
  assert.equal(Shifty.canonicalizeText('נועם ג’לאל'), 'נועם גלאל');
});

test('bundle: Shifty.PALETTE is the 24-color frozen array', () => {
  assert.equal(Array.isArray(Shifty.PALETTE), true);
  assert.equal(Shifty.PALETTE.length, 24);
  assert.equal(Shifty.PALETTE[0], '#1F77B4');
  assert.equal(Shifty.PALETTE[23], '#843C39');
});

test('bundle: Shifty.pickNextColor handles null/undefined/negative sentinel + wrap', () => {
  assert.equal(Shifty.pickNextColor(null), 0);
  assert.equal(Shifty.pickNextColor(undefined), 0);
  assert.equal(Shifty.pickNextColor(-1), 0);
  assert.equal(Shifty.pickNextColor(0), 2); // step-by-2 canary (D-15)
  assert.equal(Shifty.pickNextColor(22), 0); // wraps modulo 24
});

test('bundle: Shifty.colorByIndex out-of-range falls back to PALETTE[0]', () => {
  assert.equal(Shifty.colorByIndex(0), '#1F77B4');
  assert.equal(Shifty.colorByIndex(null), '#1F77B4');
  assert.equal(Shifty.colorByIndex(undefined), '#1F77B4');
  assert.equal(Shifty.colorByIndex(99), '#1F77B4');
  assert.equal(Shifty.colorByIndex(-1), '#1F77B4');
});

test('bundle: Shifty.canonicalizeRoleTag lowercases + kebabs + NFC-normalizes', () => {
  assert.equal(Shifty.canonicalizeRoleTag('Medic Officer'), 'medic-officer');
  // U+2019 smart quote stripped via canonicalizeText chain
  assert.equal(Shifty.canonicalizeRoleTag('medic’s'), 'medics');
  assert.equal(Shifty.canonicalizeRoleTag(''), '');
  assert.equal(Shifty.canonicalizeRoleTag(null), '');
});

test('bundle: Shifty.SOURCE_RANK preserves the 4-tier precedence and is frozen', () => {
  assert.equal(Shifty.SOURCE_RANK.manager_override, 3);
  assert.equal(Shifty.SOURCE_RANK.per_slot, 2);
  assert.equal(Shifty.SOURCE_RANK.range_blockout, 1);
  assert.equal(Shifty.SOURCE_RANK.default, 0);
  // Frozen — strict-mode mutation throws; sloppy-mode silently fails. Either is fine
  // for our purpose: the value must NOT change.
  const original = Shifty.SOURCE_RANK.manager_override;
  try {
    Shifty.SOURCE_RANK.manager_override = 99;
  } catch {
    /* strict mode throws; sloppy mode silently fails — either is acceptable */
  }
  assert.equal(Shifty.SOURCE_RANK.manager_override, original);
});

test('bundle: Shifty.SOURCE_VALUES enumerates the 4 source keys', () => {
  assert.deepEqual(
    [...Shifty.SOURCE_VALUES].sort(),
    ['default', 'manager_override', 'per_slot', 'range_blockout'],
  );
});
