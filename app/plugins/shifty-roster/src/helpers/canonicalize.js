// app/plugins/shifty-roster/src/helpers/canonicalize.js
// Smart-quote + Unicode bidi-mark stripper (D-12, ROST-11).
//
// Strip set per CONTEXT D-12:
//   U+2019  RIGHT SINGLE QUOTATION MARK
//   U+200E  LEFT-TO-RIGHT MARK (LRM)
//   U+200F  RIGHT-TO-LEFT MARK (RLM)
//   U+202A  LEFT-TO-RIGHT EMBEDDING (LRE)
//   U+202B  RIGHT-TO-LEFT EMBEDDING (RLE)
//   U+202C  POP DIRECTIONAL FORMATTING (PDF)
//   U+202D  LEFT-TO-RIGHT OVERRIDE (LRO)
//   U+202E  RIGHT-TO-LEFT OVERRIDE (RLO)
//
// Preservation rules (all OTHER characters survive):
//   • Hebrew gershayim U+05F4 (NOT a quote — it is a Hebrew abbreviation mark, e.g., סמ״ר)
//   • ASCII apostrophe U+0027  (legitimate Latin punctuation, e.g., D'Angelo)
//   • ASCII double-quote U+0022
//   • All letters in any script
//
// Applied at WRITE time on every soldier roster mutation path:
// single-row create, CSV import row, and "Invite later" form. This is a
// belt-and-braces defense — the same canonicalization runs in both single-row
// and CSV handlers so no input path can bypass the rule.
//
// Implementation note: STRIP_REGEX uses explicit Unicode escape sequences in
// the source so any editor / file-encoding conversion preserves the codepoints
// faithfully. Range U+202A..U+202E is expressed as ‪-‮.

const STRIP_REGEX = /[’‎‏‪-‮]/g;

/**
 * Canonicalize free-form text: NFC-normalize, strip smart quotes + bidi marks,
 * collapse internal whitespace runs, trim outer whitespace.
 *
 * @param {string | null | undefined} text
 * @returns {string} canonicalized string ('' for null / undefined).
 */
export function canonicalizeText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .normalize('NFC')
    .replace(STRIP_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default canonicalizeText;
