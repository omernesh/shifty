// app/plugins/shifty-audit-writer/src/connections.js
// Aggregator: re-exports all request handlers for this plugin.
// Lowdefy picks up these exports at server startup and routes
// YAML `type: AuditWrite` requests to the AuditWrite handler.
import AuditWrite from './connections/requests/AuditWrite.js';

export default { AuditWrite };
