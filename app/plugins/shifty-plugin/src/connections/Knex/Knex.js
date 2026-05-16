// Merged Knex connection — wraps @lowdefy/connection-knex's upstream Knex with the
// 21 Shifty custom request handlers (9 Phase 02 + 12 Phase 03), all registered into
// the same `requests` map.
//
// Why this shape:
//   Lowdefy 5.3 resolves a request at runtime as `connection.requests[requestConfig.type]`
//   inside @lowdefy/api/dist/routes/request/getRequestResolver.js. For our custom types
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
//
// PHASE 03 SKELETON WIRING (Plan 03-02):
//   The 12 Phase 03 handler files (CreateShiftSlot ... SeedTeamRules below) DO NOT YET
//   EXIST on disk at the end of Plan 03-02. They are created incrementally by Plans
//   03-03 through 03-06 (one or more handlers per plan). This file references them via
//   `import ... from './requests/<Name>.js'` so that downstream plans only need to ADD
//   their handler file under `./requests/` without re-editing this file — file-ownership
//   contention is fully resolved.
//
//   Consequence: this file will not parse cleanly via Node's ES module loader (or via
//   the Lowdefy build pipeline) until all 12 handler files exist. That is acceptable
//   because Lowdefy is NOT rebuilt or redeployed during Plans 03-02..03-06 — the
//   rebuild happens in Plan 03-07 once all handlers are in place. The structural
//   verifier tools/check-handler-registration.mjs (introduced in Plan 03-01) will
//   correctly report the missing files until Plan 03-07's verification step passes.

import { Knex as upstreamKnex } from '@lowdefy/connection-knex/connections';

// Phase 02 handlers (9)
import KnexRawTenant from './requests/KnexRawTenant.js';
import AuditWrite from './requests/AuditWrite.js';
import ParseCsvAndValidate from './requests/ParseCsvAndValidate.js';
import CommitRosterImport from './requests/CommitRosterImport.js';
import CreateSoldier from './requests/CreateSoldier.js';
import UpdateSoldier from './requests/UpdateSoldier.js';
import ArchiveSoldier from './requests/ArchiveSoldier.js';
import CreateMembership from './requests/CreateMembership.js';
import InviteLater from './requests/InviteLater.js';

// Phase 03 handlers (12) — files added by Plans 03-03..03-06.
import CreateShiftSlot from './requests/CreateShiftSlot.js';
import UpdateShiftSlot from './requests/UpdateShiftSlot.js';
import DeleteShiftSlot from './requests/DeleteShiftSlot.js';
import OpenPlanningWindow from './requests/OpenPlanningWindow.js';
import EditPlanningWindow from './requests/EditPlanningWindow.js';
import DeletePlanningWindow from './requests/DeletePlanningWindow.js';
import ApplyShiftTemplate from './requests/ApplyShiftTemplate.js';
import DeclareAvailability from './requests/DeclareAvailability.js';
import UpsertRule from './requests/UpsertRule.js';
import UpsertRuleOverride from './requests/UpsertRuleOverride.js';
import ResetRuleOverride from './requests/ResetRuleOverride.js';
import SeedTeamRules from './requests/SeedTeamRules.js';

export default {
  schema: upstreamKnex.schema,
  requests: {
    ...upstreamKnex.requests,
    // Phase 02
    KnexRawTenant,
    AuditWrite,
    ParseCsvAndValidate,
    CommitRosterImport,
    CreateSoldier,
    UpdateSoldier,
    ArchiveSoldier,
    CreateMembership,
    InviteLater,
    // Phase 03
    CreateShiftSlot,
    UpdateShiftSlot,
    DeleteShiftSlot,
    OpenPlanningWindow,
    EditPlanningWindow,
    DeletePlanningWindow,
    ApplyShiftTemplate,
    DeclareAvailability,
    UpsertRule,
    UpsertRuleOverride,
    ResetRuleOverride,
    SeedTeamRules,
  },
};
