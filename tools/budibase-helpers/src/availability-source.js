// app/plugins/shifty-plugin/src/helpers/availability-source.js
// Canonical SOURCE_RANK enum for availability precedence ordering (PRD §7.6 / RESEARCH §"Precedence").
//
// Single source of truth — DO NOT redefine these values inline anywhere else.
//   • DeclareAvailability (Plan 03-05) imports SOURCE_RANK to drive ON CONFLICT WHERE
//     precedence logic when a soldier upserts an availability row.
//   • The my_availability read query (Plan 03-07 KnexRawTenant SQL) embeds a CASE
//     expression that MUST mirror this exact ordering. A unit test in Plan 03-05
//     asserts the CASE expression string matches SOURCE_RANK so the two cannot drift.
//
// Precedence semantics:
//   Higher rank wins. When two availability declarations conflict on the same
//   (soldier_id, shift_instance_id) tuple, the row with the higher source rank
//   is the authoritative answer. A `manager_override` (rank 3) always trumps a
//   soldier's `per_slot` (rank 2) declaration, which trumps a `range_blockout`
//   (rank 1), which trumps the implicit `default` (rank 0, never written; used
//   only when the read query returns no row for a soldier+slot pair).
//
// Risk R-03-3 (precedence drift) mitigation: having ONE constant for both the
// handler logic and the read query removes the possibility of the two sides
// disagreeing on which source wins.

export const SOURCE_RANK = Object.freeze({
  manager_override: 3,
  per_slot: 2,
  range_blockout: 1,
  default: 0,
});

export const SOURCE_VALUES = Object.keys(SOURCE_RANK);

export default SOURCE_RANK;
