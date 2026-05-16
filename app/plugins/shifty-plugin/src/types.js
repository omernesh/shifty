// shifty-plugin merged type registry.
//
// THIS IS THE LOAD-BEARING DECLARATION for the Phase-2 plugin-registration hotfix
// (Plan 02-11; see .planning/phases/02-org-people/02-UAT-FINDINGS.md §3).
//
// Lowdefy 5.3's writePluginImports only emits request handlers that live inside a
// connection-type's `requests` map (via writeConnectionImports). The prior
// three-plugin layout (shifty-auth, shifty-roster, shifty-audit-writer) declared
// `requests: [...]` but no `connections: [...]`, so writePluginImports silently
// dropped every custom request handler at build time, surfacing at runtime as
// `Request type "X" can not be found.` from @lowdefy/api/dist/routes/request/getRequestResolver.js.
//
// Fix: declare BOTH `connections: ['Knex']` AND the `requests:` names here, AND
// route every handler through the named `Knex` export in src/connections.js.
//
// auth.adapters: KnexAdapter — next-auth database adapter (Shifty Postgres schema).
// auth.callbacks: ShiftySessionCallback — hydrates session with
//   {tenant_id, user_id, soldier_id, roles, team_ids, locale}.
// auth.providers: EmailProvider — next-auth magic-link/SMTP provider (not bundled in
//   @lowdefy/plugin-next-auth).
//
// requests: 21 Shifty handlers (9 Phase 02 + 12 Phase 03), all bound to
// connectionType: 'Knex'. Order mirrors documentation order:
//   Phase 02 (02-11-PLAN.md): KnexRawTenant, AuditWrite, ParseCsvAndValidate,
//     CommitRosterImport, CreateSoldier, UpdateSoldier, ArchiveSoldier,
//     CreateMembership, InviteLater
//   Phase 03 (03-RESEARCH.md Recipe 1): CreateShiftSlot, UpdateShiftSlot,
//     DeleteShiftSlot, OpenPlanningWindow, EditPlanningWindow,
//     DeletePlanningWindow, ApplyShiftTemplate, DeclareAvailability,
//     UpsertRule, UpsertRuleOverride, ResetRuleOverride, SeedTeamRules
// Order is not significant at runtime but documents the wave of introduction.
//
// NOTE (Plan 03-02): The 12 Phase 03 handler FILES referenced via Knex.js imports
// do not yet exist; they are created in Plans 03-03 through 03-06. The structural
// verifier tools/check-handler-registration.mjs (from Plan 03-01) will fail until
// all 12 files land — this is documented carry-forward and is expected. Lowdefy
// is not rebuilt/redeployed against this skeleton until Plan 03-07.
export default {
  connections: ['Knex'],
  requests: [
    'KnexRawTenant',
    'AuditWrite',
    'ParseCsvAndValidate',
    'CommitRosterImport',
    'CreateSoldier',
    'UpdateSoldier',
    'ArchiveSoldier',
    'CreateMembership',
    'InviteLater',
    'CreateShiftSlot',
    'UpdateShiftSlot',
    'DeleteShiftSlot',
    'OpenPlanningWindow',
    'EditPlanningWindow',
    'DeletePlanningWindow',
    'ApplyShiftTemplate',
    'DeclareAvailability',
    'UpsertRule',
    'UpsertRuleOverride',
    'ResetRuleOverride',
    'SeedTeamRules',
  ],
  auth: {
    adapters: ['KnexAdapter'],
    callbacks: ['ShiftySessionCallback'],
    providers: ['EmailProvider'],
  },
};
