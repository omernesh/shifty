# Phase 1: Foundations — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 31 new/modified files
**Analogs found:** 27 / 31 (4 have no codebase analog — see §No Analog Found)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `db/migrations/0002_tenancy_and_org.sql` | migration | write (DDL+DML) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0003_shifts_and_windows.sql` | migration | write (DDL) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0004_availability_rules_swaps.sql` | migration | write (DDL) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0005_auth_and_notifications.sql` | migration | write (DDL) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0006_audit_and_solver_runs.sql` | migration | write (DDL) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0007_imports_and_exports.sql` | migration | write (DDL) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0009_rls_policies.sql` | migration | write (DDL + DO block) | `db/migrations/0001_init.sql` | role-match |
| `db/migrations/0010_audit_revokes.sql` | migration | write (REVOKE) | `db/migrations/0001_init.sql` | role-match |
| `app/lowdefy.yaml` | config | request-response | `app/lowdefy.yaml` (self) | exact (extension) |
| `app/pnpm-workspace.yaml` | config | build-time | none in repo | no analog |
| `app/connections/shifts_db.yaml` | config | request-response | `app/lowdefy.yaml` (inline Knex block) | exact (extraction) |
| `app/plugins/shifty-audit-writer/package.json` | config | build-time | `.claude/skills/lowdefy/reference/09-plugins.md` | skill reference |
| `app/plugins/shifty-audit-writer/plugin.js` | plugin | write (CRUD) | skill `09-plugins.md` §Authoring a connection | skill reference |
| `app/plugins/shifty-audit-writer/tests/audit-writer.test.mjs` | test | write | none in repo | no analog |
| `app/plugins/shifty-auth/package.json` | config | build-time | `app/plugins/shifty-audit-writer/package.json` | role-match |
| `app/plugins/shifty-auth/plugin.js` | plugin | request-response | skill `08-auth.md` + `09-plugins.md` | skill reference |
| `app/plugins/shifty-auth/tests/auth.test.mjs` | test | read | none in repo | no analog |
| `docker-compose.yml` | config | write (ops) | `docker-compose.yml` (self) | exact (extension) |
| `tools/check-queries.mjs` | utility | read (static analysis) | none in repo | no analog (RESEARCH pattern) |
| `tools/test/invite-code.test.mjs` | test | read | none in repo | no analog |
| `playwright.config.ts` | config | test | none in repo | no analog |
| `tests/e2e/_fixtures/seed-tenants.ts` | test fixture | write | none in repo | no analog |
| `tests/e2e/_fixtures/teardown.ts` | test fixture | write | none in repo | no analog |
| `tests/e2e/cross-tenant-leak.spec.ts` | test | read | none in repo | no analog (RESEARCH pattern) |
| `tests/e2e/rls-cross-tenant.spec.ts` | test | read | none in repo | no analog |
| `tests/e2e/audit-immutable.spec.ts` | test | write | none in repo | no analog |
| `tests/e2e/audit-writer.spec.ts` | test | write | none in repo | no analog |
| `tests/e2e/invite-flow.spec.ts` | test | write | none in repo | no analog |
| `tests/e2e/session-shape.spec.ts` | test | read | none in repo | no analog |
| `tests/e2e/auth-cookies.spec.ts` | test | read | none in repo | no analog |
| `tests/e2e/tenant-bootstrap.spec.ts` | test | write | none in repo | no analog |
| `tests/e2e/log-redaction.spec.ts` | test | read | none in repo | no analog |
| `tests/e2e/hebrew-collation.spec.ts` | test | read | none in repo | no analog |
| `tools/backup/backup-postgres.ps1` | utility | file-I/O (ops) | none in repo | no analog (RESEARCH pattern) |
| `tools/backup/restore-test.ps1` | utility | file-I/O (ops) | none in repo | no analog (RESEARCH pattern) |
| `tools/fixtures/kibbutz.sql` | fixture | write | `db/migrations/0001_init.sql` (BEGIN/COMMIT shape) | partial |
| `docs/OPERATIONS.md` | docs | — | none in repo | no analog (CONTEXT D-09) |

---

## Pattern Assignments

---

### MIGRATIONS

---

#### `db/migrations/0002_tenancy_and_org.sql` (migration, DDL write)

**Analog:** `db/migrations/0001_init.sql`

**Transaction envelope pattern** (lines 1–6, 99–101):
```sql
-- 0001_init.sql -- initial schema for shifts-manager v1
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ... tables ...

COMMIT;
```

**UUID PK + timestamps pattern** (lines 9–21):
```sql
CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    email           TEXT        UNIQUE,
    employment_type TEXT        CHECK (employment_type IN ('full-time','part-time','casual')),
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Composite index pattern** (lines 23, 38–39):
```sql
CREATE INDEX idx_employees_active ON employees(active) WHERE active = TRUE;
CREATE INDEX idx_shifts_starts_at ON shifts(starts_at);
CREATE INDEX idx_shifts_role      ON shifts(role_required) WHERE role_required IS NOT NULL;
```

**`set_updated_at()` trigger pattern** (lines 89–98):
```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Adaptations needed for 0002:**
- Add `CREATE EXTENSION IF NOT EXISTS citext;` after pgcrypto (for case-insensitive email)
- Add `CREATE COLLATION IF NOT EXISTS "he-x-icu" (PROVIDER = icu, LOCALE = 'he');` before any `COLLATE "he-x-icu"` column
- Apply `COLLATE "he-x-icu"` to: `tenant.name`, `org_unit.name`, `app_user.display_name`, `soldier.display_name`
- Include NextAuth KnexAdapter tables (`users`, `accounts`, `sessions`, `verification_tokens`) in the same file — see RESEARCH.md Pattern 3 (lines 360–415) for exact column names Auth.js requires (camelCase quoted identifiers like `"emailVerified"`, `"sessionToken"`, `"userId"`)
- Every domain table that has `tenant_id` gets a composite index `(tenant_id, id)` and/or `(tenant_id, <hot column>)` per PERF-04
- FK references use `ON DELETE CASCADE` (for child rows) or `ON DELETE RESTRICT` (for business-critical links) — follow 0001 pattern

---

#### `db/migrations/0003_shifts_and_windows.sql` through `0007_imports_and_exports.sql` (migrations, DDL write)

**Analog:** `db/migrations/0001_init.sql`

Same envelope + UUID + trigger patterns as above. Key additional conventions:

**FK with ON DELETE pattern** (lines 42–47):
```sql
CREATE TABLE assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES shifts(id)    ON DELETE CASCADE,
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    ...
    UNIQUE (shift_id, employee_id)
);
```

**CHECK constraint pattern** (lines 31–34):
```sql
ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
min_staff INTEGER NOT NULL DEFAULT 1 CHECK (min_staff >= 0),
max_staff INTEGER NOT NULL DEFAULT 1 CHECK (max_staff >= min_staff),
```

**Adaptations needed for 0003–0007:**
- Every table with tenant-scoped data gets `tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE`
- Composite indexes: `CREATE INDEX idx_<table>_tenant ON <table>(tenant_id);` as minimum; hot query paths get `(tenant_id, <lookup_col>)` composite
- Hebrew-text columns in 0003 (`shift_slot.name`): add `COLLATE "he-x-icu"` — see RESEARCH.md Pattern 14
- RLS bypass preamble for any DML in migration files: `SET app.current_tenant = '00000000-0000-0000-0000-000000000000';` at top of file if any INSERT is present (RESEARCH.md Pitfall 2)

---

#### `db/migrations/0009_rls_policies.sql` (migration, DDL + DO block)

**Analog:** `db/migrations/0001_init.sql` (envelope); pattern is entirely from RESEARCH.md Pattern 7

**DO-block loop pattern** (RESEARCH.md lines 644–665):
```sql
BEGIN;

DO $$ DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'tenant', 'org_unit', 'app_user', 'soldier', 'membership',
    -- ... full table list
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)
       WITH CHECK (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
      tbl
    );
  END LOOP;
END $$;

-- Special override for `tenant` table (id = current_tenant, no tenant_id column):
DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  USING (id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
```

**Adaptations needed:**
- Use `true` (missing_ok) flag in `current_setting('app.current_tenant', true)` — prevents hard error on unauthenticated connections
- The `tenant` table requires its own override policy (its PK `id` IS the tenant — no `tenant_id` column)
- Confirm `shifts` role is not SUPERUSER before enabling RLS (superusers bypass all policies)

---

#### `db/migrations/0010_audit_revokes.sql` (migration, REVOKE)

**Analog:** `db/migrations/0001_init.sql` (envelope only)

**Complete pattern** (RESEARCH.md lines 1000–1016):
```sql
BEGIN;

REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifts;

-- notification_log allows UPDATE (status transitions: queued→sent→delivered)
REVOKE DELETE, TRUNCATE ON notification_log FROM shifts;

COMMIT;
```

**Adaptations needed:** None — copy the pattern verbatim. Add a comment explaining why each table has its specific REVOKE set.

---

### LOWDEFY APP EXTENSIONS

---

#### `app/lowdefy.yaml` (config, extension)

**Analog:** `app/lowdefy.yaml` (self — additive changes)

**Existing plugin declaration pattern** (lines 5–9):
```yaml
plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
```

**Existing connection pattern** (lines 11–19):
```yaml
connections:
  - id: shifts_db
    type: Knex
    properties:
      client: pg
      connection:
        connectionString:
          _secret: POSTGRES_CONNECTION_STRING
```

**Existing page + KnexRaw request pattern** (lines 54–63):
```yaml
  - id: employees
    type: PageHeaderMenu
    requests:
      - id: list_employees
        type: KnexRaw
        connectionId: shifts_db
        properties:
          query: |
            SELECT id, name, email, role, employment_type, hourly_rate, max_weekly_hrs, active
            FROM employees
            ORDER BY name;
```

**Adaptations needed — additions to lowdefy.yaml** (from RESEARCH.md Pattern 5, lines 498–559):
```yaml
# Add to plugins: list
  - name: '@lowdefy/plugin-nextauth'
    version: '5.3.0'
  - name: 'shifty-auth'
    version: 'workspace:*'
  - name: 'shifty-audit-writer'
    version: 'workspace:*'

# Add top-level auth: block
auth:
  pages:
    protected: true
    public:
      - login
      - signup
      - signup_with_invite
      - '404'
    roles:
      unit_admin:
        - admin_dashboard
        - admin_test_audit
        - manage_invites
        - manage_teams
      team_manager:
        - manager_dashboard
      member:
        - my_dashboard
  providers:
    - id: email
      type: EmailProvider
      properties:
        server:
          host: smtp.resend.com
          port: 465
          auth:
            user: resend
            pass:
              _secret: RESEND_API_KEY
        from:
          _secret: RESEND_FROM_EMAIL
        maxAge: 1800
  adapter:
    type: KnexAdapter
    properties:
      connectionId: shifts_db
  session:
    strategy: database
    maxAge: 2592000
  callbacks:
    - id: shifty_session
      type: ShiftySessionCallback
  pages:
    signIn: /login
```

**Critical:** `EmailProvider` MUST pair with `adapter: KnexAdapter` AND `session: strategy: database` — JWT strategy breaks magic-link token persistence (RESEARCH.md Pitfall 1).

---

#### `app/connections/shifts_db.yaml` (config, extracted connection)

**Analog:** Inline `connections:` block in `app/lowdefy.yaml` (lines 11–19)

**Copy-exact pattern:**
```yaml
id: shifts_db
type: Knex
properties:
  client: pg
  connection:
    connectionString:
      _secret: POSTGRES_CONNECTION_STRING
```

**Adaptations needed:**
- Add `pool.afterCreate` hook registration comment (the actual hook runs from `shifty-auth` plugin — Lowdefy YAML cannot express a JS function here; the plugin registers it at server startup)
- Remove the inline `connections:` block from `lowdefy.yaml` after extraction

---

#### `app/pnpm-workspace.yaml` (config, build-time)

**No codebase analog.** Required to resolve `workspace:*` references for local plugins during Docker build.

**Pattern from RESEARCH.md Pitfall 3:**
```yaml
packages:
  - '.'
  - 'plugins/*'
```

Place at `app/pnpm-workspace.yaml` (sibling of `app/package.json`). Without this file, `pnpm install` in the Docker builder stage fails with "workspace package not found" for `shifty-auth` and `shifty-audit-writer`.

---

#### `app/plugins/shifty-audit-writer/package.json` (plugin config)

**Analog:** `.claude/skills/lowdefy/reference/09-plugins.md` §Authoring a custom plugin (lines 74–97)

**Copy-exact pattern** (RESEARCH.md Pattern 8, lines 755–767):
```json
{
  "name": "shifty-audit-writer",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./connections": "./src/connections.js",
    "./types": "./src/types.js"
  }
}
```

**Rule:** Only declare the export paths you actually use. `"type": "module"` is mandatory — Lowdefy plugins are ESM-only.

---

#### `app/plugins/shifty-audit-writer/plugin.js` (plugin, write CRUD)

**Analog:** skill `09-plugins.md` §Authoring a connection (lines 193–239)

**Skill connection request pattern** (lines 219–239):
```javascript
// src/connections/requests/MyConnectionDo.js
async function MyConnectionDo({ request, connection }) {
  const res = await fetch(`${connection.baseUrl}/${request.endpoint}`, {
    headers: { 'X-API-Key': connection.apiKey },
  });
  return await res.json();
}
MyConnectionDo.schema = {
  type: 'object',
  properties: {
    endpoint: { type: 'string' },
  },
  required: ['endpoint'],
};
MyConnectionDo.connectionType = 'MyConnection';
export default MyConnectionDo;
```

**Adapted implementation** (RESEARCH.md Pattern 8, lines 781–830):
- Replace `fetch(...)` with `knex('schedule_audit').insert({...})`
- Actor ALWAYS from `request.user?.user_id` (session-injected by Lowdefy) — never from `request.properties`
- `connectionType = 'Knex'` (matches `shifts_db` connection type)
- Guard: throw if `actor_user_id` is missing (unauthenticated request must hard-fail)
- Always `await knex.destroy()` in `finally` block to return connection to pool
- `src/types.js` exports `{ requests: ['AuditWrite'] }` — name must match exactly the `type:` used in YAML

**File structure to create:**
```
app/plugins/shifty-audit-writer/
  package.json
  src/
    types.js          -- { requests: ['AuditWrite'] }
    connections.js    -- import AuditWrite; export default { AuditWrite }
    connections/
      requests/
        AuditWrite.js -- async function AuditWrite({ request, connection })
```

---

#### `app/plugins/shifty-auth/package.json` (plugin config)

**Analog:** `app/plugins/shifty-audit-writer/package.json` (same role, same shape)

**Pattern** (extended for auth callbacks):
```json
{
  "name": "shifty-auth",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./auth/callbacks": "./src/auth/callbacks.js",
    "./connections": "./src/connections.js",
    "./types": "./src/types.js"
  }
}
```

**Adaptations needed:**
- `exports` includes `./auth/callbacks` (for `ShiftySessionCallback`)
- `exports` includes `./connections` (for the Knex `afterCreate` tenant hook)
- Add `"dependencies": { "knex": "*" }` — the session callback imports Knex directly

---

#### `app/plugins/shifty-auth/plugin.js` (plugin, session hydration)

**Analog:** skill `08-auth.md` §Adding role to the session (lines 195–213) + skill `09-plugins.md` §auth callbacks pattern

**Skill auth callback pattern** (08-auth.md lines 195–213):
```yaml
auth:
  callbacks:
    - id: session
      type: SessionCallback
      properties:
        _function:
          __args: 0
          __return:
            session:
              user:
                role: { __args: 0.token.role }
```

For non-trivial callbacks (D-03 session hydration requires a DB query), the callback must be implemented in a plugin, not inline YAML.

**Session callback implementation** (RESEARCH.md Pattern 4, lines 428–482):
```javascript
// app/plugins/shifty-auth/src/auth/callbacks.js
export async function ShiftySessionCallback({ session, token, user }, connectionProperties) {
  const db = knex(connectionProperties);
  try {
    const result = await db
      .select('au.id as user_id', 'au.tenant_id', 'au.locale',
              db.raw('array_agg(m.role) as roles'),
              db.raw('array_agg(m.org_unit_id::text) as team_ids'))
      .from('app_user as au')
      .leftJoin(...)
      .where('au.email', session.user.email)
      .groupBy('au.id', 'au.tenant_id', 'au.locale')
      .first();

    session.user.tenant_id = result?.tenant_id ?? null;
    session.user.roles     = result?.roles ?? [];
    session.user.team_ids  = result?.team_ids ?? [];
    session.user.locale    = result?.locale ?? 'he';
  } finally {
    await db.destroy();
  }
  return session;
}
```

**Log-redaction middleware** lives in this plugin at `src/middleware/log-redact.js` — patches `console.log/error/warn` at startup (RESEARCH.md Pattern 12).

**Knex tenant hook** lives in this plugin at `src/hooks/knex-tenant.js`:
```javascript
export function setTenantOnConnection(conn, done, tenantId) {
  conn.query(`SET LOCAL app.current_tenant = '${tenantId}'`, (err) => done(err, conn));
}
```

**Critical:** `SET LOCAL` (not `SET`) — without `LOCAL`, the value persists across pooled connections (RESEARCH.md Anti-Patterns).

---

### DOCKER COMPOSE EXTENSIONS

---

#### `docker-compose.yml` (config, extension)

**Analog:** `docker-compose.yml` (self — additive changes)

**Existing service pattern with healthcheck and depends_on** (lines 1–44 — full file, already read):
```yaml
services:
  lowdefy:
    build: ./app
    container_name: shifty-lowdefy
    ports:
      - "8080:3000"
    environment:
      POSTGRES_CONNECTION_STRING: "postgresql://${POSTGRES_USER:-shifts}:${POSTGRES_PASSWORD:?missing}@postgres:5432/${POSTGRES_DB:-shifts}"
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?missing}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-https://apps.nesher.co}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
```

**`migrate` service to add** (RESEARCH.md Pattern 2, lines 311–328):
```yaml
  migrate:
    image: migrate/migrate:v4.18.3
    container_name: shifty-migrate
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./db/migrations:/migrations:ro
    command:
      - "-path=/migrations"
      - "-database=postgres://${POSTGRES_USER:-shifts}:${POSTGRES_PASSWORD:?missing}@postgres:5432/${POSTGRES_DB:-shifts}?sslmode=disable"
      - "up"
    restart: "no"
```

**Commented stubs to add** (per OPS-01):
```yaml
  # solver:  # Phase 4 — FastAPI solver service
  #   ...
  # cron:    # Phase 6 — notification cron
  #   ...
  # waha:    # Phase 6 — WhatsApp API; Tailscale-bound UI port
  #   ...
```

**New env vars to add to `lowdefy` service:**
```yaml
      RESEND_API_KEY: ${RESEND_API_KEY:?missing}
      RESEND_FROM_EMAIL: ${RESEND_FROM_EMAIL:-shifty@nesher.co}
```

**Adaptations needed:** `migrate` service uses `restart: "no"` (one-shot; exits after running `up`). Do NOT add `migrate` to `lowdefy.depends_on` if you want to keep `docker compose up -d` fast on restarts — run migrations manually with `docker compose run --rm migrate up` before each deploy.

---

### CI / VERIFICATION TOOLING

---

#### `tools/check-queries.mjs` (utility, static analysis)

**No codebase analog.** Pattern entirely from RESEARCH.md Pattern 9 (lines 858–936).

**Complete implementation** (RESEARCH.md lines 862–920):
```javascript
#!/usr/bin/env node
// tools/check-queries.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ALLOWLIST_MARKER = '-- @gsd-allow-untenanted:';
const KNEX_REQUEST_TYPES = new Set(['KnexRaw', 'KnexBuilder', 'KnexInsertOne', 'KnexUpdateOne', 'KnexDeleteOne']);
const TENANT_FILTER_PATTERN = /\btenant_id\b/i;
const DML_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

// ... (collectYaml + extractType helpers)

process.exit(failures > 0 ? 1 : 0);
```

**Allowlist comment syntax** (RESEARCH.md lines 922–935):
```yaml
requests:
  - id: check_invite_code
    type: KnexRaw
    connectionId: shifts_db
    properties:
      query: |
        -- @gsd-allow-untenanted: invite code validation — no tenant context before signup
        SELECT tenant_id FROM invite_code WHERE code = UPPER(:code)
```

---

#### `playwright.config.ts` (config, test)

**No codebase analog.** Standard Playwright configuration.

**Pattern from VALIDATION.md + RESEARCH.md:**
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,          // sequence mode (shared DB state)
  use: {
    baseURL: 'http://localhost:8080',
  },
  projects: [
    {
      name: 'cross-tenant',
      testMatch: '**/cross-tenant-*.spec.ts',
    },
  ],
});
```

Place at repo root (`C:\Projects\shifts manager\playwright.config.ts`).

---

#### `tests/e2e/_fixtures/seed-tenants.ts` (test fixture, write)

**No codebase analog.** Seeding pattern from RESEARCH.md Pattern 10 (lines 944–993).

**Shape reference:**
```typescript
// Seeds tenant-A and tenant-B each with: 1 admin user + 1 org_unit + 1 membership
export async function seedTwoTenants() {
  // Uses pg directly (not Lowdefy) — connect to localhost:5432
  // Returns { tenantA: { adminEmail, tenantId, ... }, tenantB: { ... } }
}
export async function signInAs(email: string) { /* returns auth cookies */ }
export function getTenantBIds(tenantB) { /* returns { soldiers, windows, assignments } */ }
```

---

#### `tests/e2e/_fixtures/teardown.ts` (test fixture, write)

**No codebase analog.**

**Shape reference:**
```typescript
// TRUNCATE all tenant-scoped tables between tests; preserves schema
// Uses pg directly; called in afterAll or as a globalTeardown
export async function teardownTestData() {
  // TRUNCATE in reverse FK order
}
```

---

#### `tools/test/invite-code.test.mjs` (test, unit)

**No codebase analog.** Uses Node built-in `node:test`.

**Pattern:**
```javascript
// node --test tools/test/invite-code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CROCKFORD_PATTERN = /^[0-9A-HJKMNPQRSTVWXYZ]{8}$/;

test('valid 8-char Crockford base32 matches', () => {
  assert.match('0123ABCD', CROCKFORD_PATTERN);
});
test('lowercase rejected', () => {
  assert.doesNotMatch('abcdefgh', CROCKFORD_PATTERN);
});
test('ambiguous chars I L O U rejected', () => {
  for (const ch of ['I', 'L', 'O', 'U']) {
    assert.doesNotMatch(`1234567${ch}`, CROCKFORD_PATTERN);
  }
});
```

---

### PLAYWRIGHT E2E TESTS

All Playwright specs have **no codebase analog.** Each follows the same structural pattern. Source: RESEARCH.md Pattern 10.

**Shared structural pattern for every `*.spec.ts`:**
```typescript
import { test, expect } from '@playwright/test';
// import fixtures

test.describe('<feature>', () => {
  test.beforeAll(async () => {
    // seed via seed-tenants fixture
  });

  test.afterAll(async () => {
    // teardown via teardown fixture
  });

  test('<behavior>', async ({ page, request }) => {
    // arrange + act + assert
    // Playwright assertions: expect(resp.status()).toBe(403)
    // Content assertions: expect(await page.content()).not.toContain(tenantBId)
  });
});
```

**Per-spec verification targets** (from VALIDATION.md):

| Spec file | REQ-ID | Key assertion |
|-----------|--------|---------------|
| `cross-tenant-leak.spec.ts` | SEC-06 | No tenant-B data visible when signed in as tenant-A |
| `rls-cross-tenant.spec.ts` | SEC-04 | `app.current_tenant` blocks SELECT/UPDATE/DELETE across tenants |
| `audit-immutable.spec.ts` | SEC-07 | `UPDATE`/`DELETE` on `schedule_audit` returns permission denied |
| `audit-writer.spec.ts` | D-08 | Plugin writes a row to `schedule_audit`; SELECT confirms row exists |
| `invite-flow.spec.ts` | AUTH-03/05/06 | Code generated; redemption creates membership; expired/used code rejects |
| `session-shape.spec.ts` | AUTH-07 | Session JSON has `{tenant_id, roles[], team_ids[], locale}` |
| `auth-cookies.spec.ts` | AUTH-02 | Cookie is `HttpOnly; Secure`; CSRF token present on POST |
| `tenant-bootstrap.spec.ts` | TEN-01..05 | Self-signup creates tenant; org tree visible; admin can CRUD org_units |
| `log-redaction.spec.ts` | SEC-10 | Logs contain `[REDACTED]` where env secrets appeared |
| `hebrew-collation.spec.ts` | I18N-07 | ORDER BY on Hebrew display_name returns correct alphabetic order |

---

### OPS SCAFFOLDING

---

#### `tools/backup/backup-postgres.ps1` (utility, file-I/O)

**No codebase analog.** Pattern from RESEARCH.md Pattern 13 (lines 1057–1103).

**Key pattern excerpt** (RESEARCH.md lines 1062–1098):
```powershell
$Date = Get-Date -Format "yyyy-MM-dd"
$BackupDir = "C:\shifts-manager\backups\pg"
$DumpFile = "$BackupDir\$Date.dump"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

docker exec shifts-postgres pg_dump `
  -U shifts -d shifts --format=custom --no-password `
  -f /tmp/backup.dump

docker cp shifts-postgres:/tmp/backup.dump $DumpFile

rclone copy $DumpFile "neshernas_pg_backup:pg-backups/$Date.dump" `
  --config "C:\shifts-manager\.rclone.conf"

# Self-test
$TestResult = docker exec shifts-postgres pg_restore --list /tmp/backup.dump 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-EventLog -LogName Application -Source "ShiftyBackup" `
    -EventId 1001 -EntryType Error `
    -Message "pg_restore --list FAILED for dump $Date."
  exit 1
}

# Retention: delete files older than 14 days
Get-ChildItem $BackupDir -Filter "*.dump" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item
```

**Note:** `docker exec` and `docker cp` do NOT require PsExec (they don't pull images). This script runs from Task Scheduler as `claude`, not from SSH.

---

#### `tools/backup/restore-test.ps1` (utility, file-I/O)

**No codebase analog.** Derived from backup script pattern.

**Shape:**
```powershell
$LatestDump = Get-ChildItem "C:\shifts-manager\backups\pg" -Filter "*.dump" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

docker cp $LatestDump.FullName shifts-postgres:/tmp/restore-test.dump
$Result = docker exec shifts-postgres pg_restore --list /tmp/restore-test.dump 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-EventLog ... -EntryType Error ...
  exit 1
}
Write-Host "Restore test passed: $($Result.Count) lines in TOC"
```

---

#### `tools/fixtures/kibbutz.sql` (fixture, write)

**Analog:** `db/migrations/0001_init.sql` (BEGIN/COMMIT envelope only)

**BEGIN/COMMIT envelope to copy:**
```sql
BEGIN;
-- INSERT statements here
COMMIT;
```

**Full fixture pattern** (RESEARCH.md Pattern 15, lines 1152–1185):
```sql
-- tools/fixtures/kibbutz.sql
-- 12 soldiers, 1 team, 64-day planning window
-- One soldier has U+2019 RIGHT SINGLE QUOTATION MARK in display_name (PRD §8.4)
BEGIN;

INSERT INTO tenant (id, name, org_depth)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Kibbutz', 1);

INSERT INTO org_unit (id, tenant_id, parent_id, level, name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', NULL, 1, 'צוות ראשי');

INSERT INTO soldier (id, tenant_id, display_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-...', 'יוסי כהן'),
  -- ... 10 more normal soldiers ...
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-...', 'נועם ג’לאל');
  --                                                              ^-- U+2019

COMMIT;
```

**Critical:** The U+2019 character must be the actual Unicode RIGHT SINGLE QUOTATION MARK (U+2019), not an ASCII apostrophe (U+0027). Copy-paste from RESEARCH.md line 1174 exactly.

---

#### `docs/OPERATIONS.md` (runbook stub)

**No codebase analog.** Section outline from CONTEXT.md D-09:

Required sections (per D-09):
1. Backup Self-Test Verification (nightly `pg_restore --list`; alert on non-zero exit)
2. Windows Update Active Hours (exclude 06:50–08:30 Israel time to avoid reboot collisions)
3. AV Exclusions (`C:\shifts-manager\` directory excluded from Windows Defender scans)
4. VHDX Quarterly Compaction (forward-declared; first compaction Q3 2026)
5. Tailscale-Bound WAHA UI Port (forward-declared for Phase 6)
6. Dedicated WAHA SIM (forward-declared for Phase 6)
7. Cloudflared User Account Separation (already in place; document the account name)
8. Restore Drill Protocol (quarterly; manual; spin up disposable Postgres + staging Lowdefy)
9. Test Strategy (per PRD §8.4; OPS-09)

---

## Shared Patterns

### 1. Transaction Envelope (all SQL migrations)
**Source:** `db/migrations/0001_init.sql` lines 3–4, 100
**Apply to:** All files in `db/migrations/`
```sql
BEGIN;
-- ... DDL and DML ...
COMMIT;
```

### 2. UUID Primary Key (all domain tables)
**Source:** `db/migrations/0001_init.sql` line 10
**Apply to:** Every `CREATE TABLE` in migrations 0002–0007
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
```

### 3. Secret Resolution via `_secret:` (all Lowdefy config)
**Source:** `app/lowdefy.yaml` lines 17–18
**Apply to:** All env-var references in `app/lowdefy.yaml`, `app/connections/shifts_db.yaml`, new auth provider config
```yaml
connectionString:
  _secret: POSTGRES_CONNECTION_STRING
```
Never put literal credential values in YAML. Always `_secret: VAR_NAME`.

### 4. Plugin Dual Declaration (all Lowdefy plugins)
**Source:** skill `09-plugins.md` lines 3–7; `app/lowdefy.yaml` lines 5–9
**Apply to:** Every new plugin entry — BOTH `app/package.json` dependencies AND `lowdefy.yaml` plugins list must be updated together. Omitting either causes silent build failures.

### 5. `_user` for Tenant ID in Query Payloads (all KnexRaw request blocks)
**Source:** RESEARCH.md Anti-Patterns (line 1191); skill `08-auth.md` lines 183–189
**Apply to:** Every `KnexRaw`/`Knex` request block that touches a tenant-scoped table
```yaml
payload:
  tenant_id:
    _user: tenant_id      # server-evaluated: safe
properties:
  query: |
    SELECT ... FROM soldier WHERE tenant_id = :t
  parameters:
    t:
      _payload: tenant_id
```
NEVER: `_state: tenant_id` or `_user: tenant_id` directly in `query:` parameters — those evaluate client-side.

### 6. PsExec Wrapping for Docker Build on hpg5
**Source:** `CLAUDE.md` §Why PsExec for SSH-side docker commands
**Apply to:** Any plan task that calls `docker compose build` or `docker pull` from SSH
```powershell
plink -ssh -l claude -pw "Onclaude2103" -batch `
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" `
  hpg5 "powershell -c `"psexec -accepteula -nobanner -i 1 -u claude -p Onclaude2103 cmd /c 'cd C:\shifts-manager && docker compose build lowdefy > C:\shifts-manager\build.txt 2>&1 && docker compose up -d lowdefy >> C:\shifts-manager\build.txt 2>&1'; Get-Content C:\shifts-manager\build.txt -Tail 30`""
```
Operations that do NOT need PsExec: `docker ps`, `docker logs`, `docker exec`, `docker compose up -d` (images cached), `docker compose stop`.

### 7. `COLLATE "he-x-icu"` on Hebrew-Text Columns
**Source:** RESEARCH.md Pattern 14 (line 1140)
**Apply to:** `tenant.name`, `org_unit.name`, `app_user.display_name`, `soldier.display_name`, `shift_slot.name`
```sql
display_name TEXT COLLATE "he-x-icu" NOT NULL,
```
**Prerequisite:** Migration 0002 must first CREATE the collation if not present:
```sql
CREATE COLLATION IF NOT EXISTS "he-x-icu" (PROVIDER = icu, LOCALE = 'he');
```

### 8. Tenant ID Composite Indexes (all tenant-scoped tables)
**Source:** `db/migrations/0001_init.sql` lines 23, 38–39 (index pattern); PERF-04
**Apply to:** Every domain table with `tenant_id` in migrations 0002–0007
```sql
CREATE INDEX idx_<table>_tenant ON <table>(tenant_id);
-- For hot query paths (e.g., assignment lookup by tenant + state):
CREATE INDEX idx_assignment_tenant_state ON assignment(tenant_id, state);
```

---

## No Analog Found

Files with no close match in the codebase — planner should use RESEARCH.md patterns or external references:

| File | Role | Data Flow | Pattern Source |
|------|------|-----------|----------------|
| `app/pnpm-workspace.yaml` | config | build-time | RESEARCH.md Pitfall 3 (exact content) |
| `playwright.config.ts` | config | test | VALIDATION.md §Test Infrastructure + Playwright docs |
| `tests/e2e/_fixtures/seed-tenants.ts` | test fixture | write | RESEARCH.md Pattern 10 (shape reference); use `pg` npm package directly |
| `tests/e2e/_fixtures/teardown.ts` | test fixture | write | RESEARCH.md Pattern 10; TRUNCATE in reverse FK order |
| All `tests/e2e/*.spec.ts` (10 files) | test | varies | RESEARCH.md Pattern 10; VALIDATION.md §Per-Task Verification Map |
| `tools/test/invite-code.test.mjs` | test | read | Node `node:test` built-in; alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` |
| `tools/backup/backup-postgres.ps1` | utility | file-I/O | RESEARCH.md Pattern 13 (complete script) |
| `tools/backup/restore-test.ps1` | utility | file-I/O | Derived from Pattern 13; `pg_restore --list` |
| `docs/OPERATIONS.md` | docs | — | CONTEXT.md D-09 section outline |

---

## Metadata

**Analog search scope:** `app/`, `db/migrations/`, `docker-compose.yml`, `.claude/skills/lowdefy/reference/`
**Files read:** `0001_init.sql`, `app/lowdefy.yaml`, `app/Dockerfile`, `app/package.json`, `docker-compose.yml`, `08-auth.md`, `09-plugins.md`, `01-RESEARCH.md` (all sections), `01-CONTEXT.md`, `01-VALIDATION.md`
**Pattern extraction date:** 2026-05-12
