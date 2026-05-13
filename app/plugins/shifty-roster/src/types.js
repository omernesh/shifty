// app/plugins/shifty-roster/src/types.js
// Plugin type registry for shifty-roster — registers Phase 2 request types.
// Phase 2 request types: ParseCsvAndValidate, CommitRosterImport,
// CreateSoldier, UpdateSoldier, ArchiveSoldier, CreateMembership, InviteLater.
// TypeName must match exactly the `type:` field used in YAML request blocks.
export default {
  requests: [
    'ParseCsvAndValidate',
    'CommitRosterImport',
    'CreateSoldier',
    'UpdateSoldier',
    'ArchiveSoldier',
    'CreateMembership',
    'InviteLater',
  ],
};
