// shifty-plugin connection exports — load-bearing structural file.
//
// Lowdefy 5.3's writeConnectionImports.js generates an import line of the form:
//   import { Knex as Knex } from 'shifty-plugin/connections';
// from this plugin's types.js declaration `connections: ['Knex']`.
//
// That import is a NAMED import. A default-exported object (the prior plugins' shape,
// `export default { KnexRawTenant }`) resolves to `undefined` against `import { Knex }`,
// which silently drops the connection and every nested request handler. The fix is to
// re-export the merged Knex value as a NAMED export with the same name Lowdefy looks for.
//
// Side-effect import: log-redact.js monkey-patches console at module load to redact
// PII from log lines (PRD §13). Must run before any request handler logs.
import './middleware/log-redact.js';

// NAMED export — the load-bearing identifier writeConnectionImports' template binds to.
// `./connections/Knex/Knex.js` default-exports { schema, requests } where requests is
// the upstream @lowdefy/connection-knex request map spread with the 9 Shifty handlers.
export { default as Knex } from './connections/Knex/Knex.js';
