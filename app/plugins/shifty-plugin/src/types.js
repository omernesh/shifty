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
// Fix: declare BOTH `connections: ['Knex']` AND the 9 `requests:` names here, AND
// route every handler through the named `Knex` export in src/connections.js.
//
// auth.adapters: KnexAdapter — next-auth database adapter (Shifty Postgres schema).
// auth.callbacks: ShiftySessionCallback — hydrates session with {tenant_id, roles, team_ids, locale}.
// auth.providers: EmailProvider — next-auth magic-link/SMTP provider (not bundled in
//   @lowdefy/plugin-next-auth).
//
// requests: 9 Shifty handlers, all bound to connectionType: 'Knex'. Order mirrors
// documentation order in 02-11-PLAN.md (not significant at runtime).
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
  ],
  auth: {
    adapters: ['KnexAdapter'],
    callbacks: ['ShiftySessionCallback'],
    providers: ['EmailProvider'],
  },
};
