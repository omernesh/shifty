// app/plugins/shifty-roster/src/helpers/palette.js
// FROZEN 24-color Glasbey-style perceptually-distinct palette.
//
// Source of truth: 02-UI-SPEC.md §"Color B. 24-color soldier-calendar palette"
// (lines 119–155). The array INDEX is the adjacency identifier per D-15:
// indices ±1 in this array are "adjacent" colors and must NOT be assigned
// to two soldiers in the same team in immediate succession.
//
// The array order IS persisted as a numeric index on org_unit.last_color_index.
// Do NOT reorder, substitute, or re-tune under any cosmetic pretext — every
// existing soldier's color would silently shift. The unit test asserts byte-
// equal match against the FROZEN list (palette.test.mjs, W3 fix).

export const PALETTE = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B',
  '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF', '#AEC7E8', '#FFBB78',
  '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#C7C7C7',
  '#DBDB8D', '#9EDAE5', '#393B79', '#637939', '#8C6D31', '#843C39',
];

/**
 * Picks the next palette index for a new soldier, jumping by 2 to keep
 * adjacent soldiers visually distinct (D-15).
 *
 * @param {number | null | undefined} lastIndex — previous assignment in this team;
 *   the sentinel -1 (or null / undefined) means "no prior assignment".
 * @returns {number} next index in [0, 23].
 */
export function pickNextColor(lastIndex) {
  if (lastIndex === undefined || lastIndex === null || lastIndex < 0) return 0;
  return (lastIndex + 2) % PALETTE.length;
}

/**
 * Safe lookup of a hex color by palette index. Out-of-range / null / undefined
 * fall back to PALETTE[0] so cellRenderers never emit `undefined` as a CSS color.
 *
 * @param {number | null | undefined} idx
 * @returns {string} hex string (e.g. '#1F77B4').
 */
export function colorByIndex(idx) {
  if (idx === null || idx === undefined || idx < 0 || idx >= PALETTE.length) {
    return PALETTE[0];
  }
  return PALETTE[idx];
}
