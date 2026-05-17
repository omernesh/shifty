// app/plugins/shifty-plugin/src/helpers/role-tag.js
// Canonicalize free-form role-tag input to lowercase kebab-case (D-13, ROST-07).
//
// The output MUST satisfy the DB CHECK constraint on role_tag.key:
//   key ~ '^[a-z][a-z0-9-]*$'
// (migration 0011 — written by plan 02-01).
//
// Boundary note: this canonicalizer enforces the CHARACTER SET and SHAPE
// (lowercase kebab, no leading/trailing dash, no double dash) but does NOT
// enforce the leading-letter rule. Inputs that begin with a digit (e.g. "9mm")
// produce outputs that the canonicalizer accepts but that FAIL the DB CHECK.
// The CSV import handler / single-row mutation handler is responsible for
// flagging such outputs as invalid role tags before insert. This boundary is
// documented and tested in role-tag.test.mjs.
//
// Order of operations matters:
//   1. canonicalizeText FIRST — NFC normalize + strip smart-quotes / bidi marks.
//      This ensures a smart-quoted CSV cell (e.g., "medic’s") canonicalizes
//      identically to its plain ASCII counterpart ("medics").
//   2. lowercase
//   3. spaces + underscores → dash
//   4. drop everything outside [a-z0-9-]
//   5. collapse multi-dash runs
//   6. trim leading / trailing dashes

import { canonicalizeText } from './canonicalize.js';

/**
 * Canonicalize a role-tag input string.
 *
 * @param {string | null | undefined} input
 * @returns {string} kebab-case key, or '' for null/empty.
 */
export function canonicalizeRoleTag(input) {
  if (!input) return '';
  const cleaned = canonicalizeText(input);
  if (!cleaned) return '';
  return cleaned
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default canonicalizeRoleTag;
