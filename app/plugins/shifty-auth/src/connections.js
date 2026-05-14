// shifty-auth plugin connection / request exports.
//
// Side-effect import: log-redact.js monkey-patches console at module load to redact
// PII from log lines (PRD §13).
//
// Request exports: KnexRawTenant — Layer 5 RLS-aware drop-in replacement for KnexRaw.
// Lowdefy reads this default export and registers each named property as a request
// type with `connectionType: 'Knex'` (KnexRawTenant rides the @lowdefy/connection-knex
// connection schema).
import './middleware/log-redact.js';
import KnexRawTenant from './connections/requests/KnexRawTenant.js';

export default { KnexRawTenant };
