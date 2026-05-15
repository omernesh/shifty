// Merged Knex connection — wraps @lowdefy/connection-knex's upstream Knex with the
// 9 Shifty custom request handlers, all registered into the same `requests` map.
//
// Why this shape:
//   Lowdefy 5.3 resolves a request at runtime as `connection.requests[requestConfig.type]`
//   inside @lowdefy/api/dist/routes/request/getRequestResolver.js. For our 9 custom types
//   to resolve, they MUST live in this map. Upstream KnexBuilder + KnexRaw remain in the
//   spread so non-RLS YAML pages keep working unchanged.
//
//   We import the upstream Knex value (which is `{ schema, requests: { KnexBuilder, KnexRaw } }`)
//   and produce a new default-exported object preserving the schema and merging request maps.
//
// NOTE: writeConnectionImports' template uses `import { Knex as Knex } from '<pkg>/connections'`.
//   Whichever variant resolves to the `{ schema, requests }` object is correct; the upstream
//   exports the value as a NAMED export `Knex` (per @lowdefy/connection-knex/src/connections.js),
//   so `import { Knex as upstreamKnex }` is the precise shape. The plan's `<interfaces>` block
//   notes this should be verified at write time — confirmed by the upstream pattern itself.

import { Knex as upstreamKnex } from '@lowdefy/connection-knex/connections';

import KnexRawTenant from './requests/KnexRawTenant.js';
import AuditWrite from './requests/AuditWrite.js';
import ParseCsvAndValidate from './requests/ParseCsvAndValidate.js';
import CommitRosterImport from './requests/CommitRosterImport.js';
import CreateSoldier from './requests/CreateSoldier.js';
import UpdateSoldier from './requests/UpdateSoldier.js';
import ArchiveSoldier from './requests/ArchiveSoldier.js';
import CreateMembership from './requests/CreateMembership.js';
import InviteLater from './requests/InviteLater.js';

export default {
  schema: upstreamKnex.schema,
  requests: {
    ...upstreamKnex.requests,
    KnexRawTenant,
    AuditWrite,
    ParseCsvAndValidate,
    CommitRosterImport,
    CreateSoldier,
    UpdateSoldier,
    ArchiveSoldier,
    CreateMembership,
    InviteLater,
  },
};
