// app/plugins/shifty-roster/src/connections.js
// Aggregator: re-exports all request handlers for this plugin.
// Lowdefy picks up these exports at server startup and routes
// YAML `type: <Name>` requests to the matching handler.
import ParseCsvAndValidate from './connections/requests/ParseCsvAndValidate.js';
import CommitRosterImport from './connections/requests/CommitRosterImport.js';
import CreateSoldier from './connections/requests/CreateSoldier.js';
import UpdateSoldier from './connections/requests/UpdateSoldier.js';
import ArchiveSoldier from './connections/requests/ArchiveSoldier.js';
import CreateMembership from './connections/requests/CreateMembership.js';
import InviteLater from './connections/requests/InviteLater.js';

export default {
  ParseCsvAndValidate,
  CommitRosterImport,
  CreateSoldier,
  UpdateSoldier,
  ArchiveSoldier,
  CreateMembership,
  InviteLater,
};
