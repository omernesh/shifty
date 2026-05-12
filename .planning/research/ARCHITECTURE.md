# Architecture Research

**Domain:** Multi-tenant Hebrew-first workforce scheduling SaaS on single-host Docker Compose (Lowdefy 5.3 + FastAPI/OR-Tools + Postgres 16 + node-cron + WAHA)
**Researched:** 2026-05-12
**Confidence:** HIGH on PRD-locked decisions; MEDIUM on Lowdefy-specific patterns (limited authoritative docs; verified via GitHub discussions); HIGH on Postgres/cron/audit patterns.

## Standard Architecture

### System Overview

The PRD §11 architecture is **locked**. This research validates it and fills in the implementation patterns.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  Public boundary (Cloudflare Tunnel)                      │
│                       https://apps.nesher.co                              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ TLS terminates at Cloudflare; HTTP inside
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                hpg5 (Windows 11, Docker Desktop)                          │
│                Compose network: shifty_default                            │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────┐           │
│  │  lowdefy  (8080:3000)                                       │           │
│  │   - Next.js SSR                                              │           │
│  │   - Auth.js (NextAuth EmailProvider via Resend magic links) │           │
│  │   - Pages + Requests defined in app/*.yaml                  │           │
│  │   - Server-side notification dispatch (synchronous v1)      │           │
│  │   - Export generation (iCal/CSV/PDF via Puppeteer)          │           │
│  │   - Webhook receivers: /api/webhook/{resend,waha}           │           │
│  │   - Internal: /api/internal/cron/<job>                      │           │
│  └────────┬─────────┬────────────┬────────────┬────────────────┘           │
│           │         │            │            │                            │
│  Postgres │   Solver│      WAHA  │       Cron │     (internal services    │
│  internal │ internal│   internal │   internal │      — no host ports)     │
│  ┌────────▼──┐ ┌────▼──────┐ ┌──▼──────┐ ┌──▼─────┐                       │
│  │ postgres  │ │ solver    │ │ waha    │ │ cron   │                       │
│  │ 16        │ │ FastAPI + │ │ self-   │ │ node-  │                       │
│  │           │ │ OR-Tools  │ │ hosted  │ │ cron   │                       │
│  │ stores:   │ │ stateless │ │ WhatsApp│ │ alpine │                       │
│  │ all data  │ │ (no DB)   │ │ gateway │ │        │                       │
│  └───────────┘ └───────────┘ └─────────┘ └────────┘                       │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS only
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
          ┌──────────┐      ┌──────────┐      ┌──────────┐
          │ Resend   │      │ Web Push │      │ (no other│
          │ /emails  │      │ VAPID    │      │ outbound)│
          └──────────┘      └──────────┘      └──────────┘
```

### Component Responsibilities

| Component | Owns | Calls | Called by |
|-----------|------|-------|-----------|
| `lowdefy` (Next.js SSR) | UI, auth, request validation, persistence orchestration, notification dispatch, exports, audit writes, webhook receipt | Postgres (Knex), Solver (`/solve`), WAHA (`/api/sendText`), Resend (`/emails`), Web Push (VAPID) | Browser (public via Cloudflare Tunnel), Cron (internal HTTP), Resend webhook (public), WAHA webhook (internal) |
| `solver` (FastAPI + OR-Tools) | CP-SAT solve, fairness objective, infeasibility report | None (stateless; doesn't know Postgres exists) | Lowdefy only (`SOLVER_SHARED_SECRET` bearer) |
| `postgres` (16) | Single source of truth; tenant data, audit logs, NextAuth tables | Nothing (sink) | Lowdefy (only client) |
| `cron` (node-cron alpine) | Wall-clock triggers (daily reports 07:00, weekly Monday 08:00, lock reminders 24h pre-lock) | Lowdefy `/api/internal/cron/<job>` (HTTP POST + `CRON_SHARED_SECRET` header) | Nothing (only fires outward) |
| `waha` (self-hosted) | WhatsApp message send, session keep-alive | Meta WhatsApp servers (unofficial) | Lowdefy (send); Lowdefy receives `waha.session-down` webhook |

**Direction-of-calls invariant (locked, PRD §11):** Browser → Lowdefy → {Postgres, Solver, WAHA, Resend, Web Push}. Cron → Lowdefy. Nothing else. Solver never calls Lowdefy back. Cron never touches Postgres or Solver directly. **No cycles.**

## Recommended Project Structure

The PRD repo layout is the source of truth. This research extends it with the modules that will materialize in implementation phases.

```
app/                              # Lowdefy app — Next.js SSR by build
  lowdefy.yaml                    # root config (connections, auth, plugins)
  pages/                          # page YAML, factored by feature
    auth/{login,signup}.yaml
    dashboard/{soldier,manager,admin}.yaml
    schedule/{draft,publish,override}.yaml
    swap/{propose,review_queue}.yaml
    roster/{list,import}.yaml
    availability/{declare,manager_view}.yaml
    settings/{rules,recipients,profile}.yaml
  requests/                       # shared request fragments (KnexRaw .sql files)
    queries/
      list_team_members.sql       # tenant_id derived from session — see §Pattern 2
      planning_window_assignments.sql
      ...
  connections/                    # connection YAML, if factored out
  plugins/                        # local plugins (workspace:*)
    shifty-notification-dispatcher/  # custom Lowdefy request plugin — see §Cross-cutting
    shifty-audit-writer/             # custom Lowdefy request plugin — see §Cross-cutting
  templates/                      # email + WhatsApp templates (he + en)
    notifications/
      schedule_published.he.html
      schedule_published.en.html
      ...
    reports/
      daily.he.html
      weekly_digest.he.html
  locales/{he,en}.json
  public/sw.js                    # Web Push service worker
  Dockerfile                      # multi-stage (already in repo)
  package.json
db/
  migrations/                     # numbered SQL; FK-ordered
    0001_init.sql                 # bootstrap (shipped) — superseded by 0008
    0002_tenancy_and_org.sql      # tenant, org_unit, app_user, soldier, membership
    0003_shifts_and_windows.sql   # shift_slot, planning_window, shift_instance, assignment
    0004_availability_rules_swaps.sql
    0005_auth_and_notifications.sql
    0006_audit_and_solver_runs.sql
    0007_imports_and_exports.sql
    0008_assignment_state_and_legacy_drop.sql  # adds assignment.state; drops employees, shifts, assignments
    0009_rls_policies.sql         # optional defense-in-depth (see §Pattern 1)
    0010_audit_revokes.sql        # REVOKE UPDATE/DELETE on *_audit tables for app role
  fixtures/
    kibbutz.sql                   # 12-soldier dataset with smart-quoted name (PRD test rule)
solver/                           # arrives in phase 4
  app/
    main.py                       # FastAPI app, /solve + /health
    auth.py                       # Bearer token middleware
    schemas.py                    # Pydantic request/response (matches PRD §7.8 draft-07)
    solve.py                      # CP-SAT model encoding + solve loop
    fairness.py                   # objective function
    infeasibility.py              # offending-rules detection
  tests/
    test_solve_e2e.py             # black-box; kibbutz fixture
    test_determinism.py           # same input + seed = same output
    test_infeasibility.py
  Dockerfile
  pyproject.toml
cron/                             # arrives in phase 6
  src/
    index.js                      # node-cron schedule + HTTP POST to Lowdefy
    jobs.js                       # {daily_report, weekly_digest, lock_reminder, archive_windows}
  Dockerfile                      # alpine + node 20 + node-cron
  package.json
tools/
  migrate-from-sheet/             # tenant #1 one-shot, Python
  fixtures/                       # seed data builders
  check-locales.mjs               # CI parity check between he.json and en.json
docker-compose.yml                # all services
.env.example
docs/
  PRD.md                          # authoritative product spec
```

### Structure Rationale

- **`app/plugins/shifty-*/`**: Lowdefy's request system has a known limitation — it does **not validate request data payloads server-side** (confirmed by maintainer in [discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409)). For dispatcher logic that must touch external HTTP APIs (Resend, WAHA, Web Push) with per-user preference lookups, retry, and `notification_log` writes — a custom Lowdefy request plugin is the right primitive. See cross-cutting §Notification Dispatch.
- **`db/migrations/` is FK-ordered, numbered, never edited after merge.** Migration `0009_rls_policies.sql` is **optional** defense-in-depth (see Pattern 1); ship without it for v1 if YAML complexity outweighs the marginal gain.
- **`solver/` is wholly independent.** Its Dockerfile builds a Python image; nothing in `solver/` ever imports from `app/`. Its only contract is the JSON request/response schema in PRD §7.8.
- **`cron/` is a 20-line wrapper around `node-cron`.** It does not import any shared code; it does not touch Postgres directly. Its job list is read from env vars; every job is "POST `/api/internal/cron/<name>` with shared-secret header, log non-2xx to stderr".

## Architectural Patterns

### Pattern 1: Tenant Isolation — Four-Layer Defense

The PRD §8.3 mandates a four-layer defense. This research validates each layer against actual Lowdefy primitives and flags one structural gap.

#### Layer 1: Session carries `tenant_id`

NextAuth's `session` callback enriches the session with `tenant_id` derived from the user's `app_user` row. This is the foundation; every other layer reads `tenant_id` from here.

```yaml
# app/lowdefy.yaml — auth section
auth:
  providers:
    - id: email
      type: EmailProvider
      properties:
        server: { ... }
        from: { _secret: RESEND_FROM_EMAIL }
  adapter:
    type: KnexAdapter
    properties:
      connectionId: shifts_db
  session:
    strategy: database          # required for EmailProvider (magic links)
    maxAge: 2592000             # 30 days
  callbacks:
    - id: session_enrichment
      type: SessionCallback
      properties:
        _function:
          __args: 0             # NextAuth passes { session, user, token }
          __return:
            session:
              user:
                id:         { __args: 0.user.id }
                email:      { __args: 0.user.email }
                # CRITICAL: tenant_id and role come from app_user joined via membership
                tenant_id:  { __args: 0.user.tenant_id }
                role:       { __args: 0.user.role }
                locale:     { __args: 0.user.locale }
```

The actual lookup happens in a plugin (see §09-plugins) — the YAML `_function` snippet is illustrative. Implementation reads `app_user.tenant_id` and the user's highest-priority `membership.role` on signin.

**Why this works:** NextAuth tokens are JWT-signed; users cannot forge their `tenant_id`. Every server-side request that uses `_user: tenant_id` is reading from the signed claim, not request input.

#### Layer 2: Every query filters by `tenant_id` derived from session

```yaml
# app/pages/roster/list.yaml
- id: list_team_members
  type: KnexRaw
  connectionId: shifts_db
  payload:
    # NOTE: tenant_id MUST come from _user (server-side), never _state or _input.
    tenant_id: { _user: tenant_id }
    team_id:   { _state: selected_team_id }   # user-controllable; will also be filtered server-side
  properties:
    query: |
      SELECT s.id, s.display_name, s.role_tags, s.seniority, s.color
      FROM soldier s
      JOIN membership m ON m.soldier_id = s.id
      WHERE s.tenant_id = :tenant_id           -- session-derived; non-forgeable
        AND m.tenant_id = :tenant_id           -- defensive double-check
        AND m.org_unit_id = :team_id           -- additionally constrained to the team
        AND s.status = 'active';
    parameters:
      tenant_id: { _payload: tenant_id }
      team_id:   { _payload: team_id }
```

**Rules for every query in the codebase:**
1. **`tenant_id` is in WHERE, derived from `_user: tenant_id` via payload.** Never `_state`, never `_input`, never absent.
2. **For JOINs, every joined table also filters by `tenant_id`** (defense-in-depth — protects against future migrations that miss a column).
3. **For `KnexInsertOne`/`KnexUpdateOne`**, `tenant_id` is set in `data:` from `_user: tenant_id` and is part of the WHERE clause for updates.
4. **The team_id parameter (`_state`) is user-controllable, so the query MUST also constrain to teams the user has membership in.** Convention: every team-scoped query JOINs through `membership WHERE user_id = :user_id` to confirm the team is the caller's.

#### Layer 3: Page has an `auth` block declaring the minimum role

```yaml
# app/lowdefy.yaml — top-level auth.pages
auth:
  pages:
    protected: true            # default: every page requires login
    public:
      - login
      - signup
      - '404'
    roles:
      tenant_admin:
        - admin_dashboard
        - org_settings
        - invite_codes
      team_manager:
        - manager_dashboard
        - schedule_draft
        - schedule_publish
        - swap_queue
        - roster_list
        - roster_import
      member:                  # = soldier in our domain
        - soldier_dashboard
        - availability_declare
        - swap_propose
        - my_assignments
        - time_clock
  api:                         # protect API endpoints similarly
    protected: true
    public:
      - webhook_resend         # auth via Resend signature inside the handler
      - webhook_waha           # auth via shared secret inside the handler
    roles:
      tenant_admin: [admin_api]
```

For pages with mixed-role visibility (e.g., a "team calendar" that managers and soldiers both read but only managers can edit), the page is gated to the **least-privileged role** and individual controls are hidden via `visible: { _eq: [{ _user: role }, team_manager] }`.

#### Layer 4: Server-side role check on every mutating request — **HAS A GAP**

**Critical finding (MEDIUM confidence; verified via [Lowdefy discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409)):** Lowdefy does **not** offer per-request role-gating in YAML. Server-side authorization is enforced **page-bound**: "When pages are protected by roles, a user can trigger the requests on the page granted that they pass auth and that they have the applied role in the token claim." Maintainer quote: *"We just do not validate the request data payload on the server."*

**Consequence:** PRD §8.3 layer 4 ("every request re-checks the role on the server") is **not implementable in pure YAML** for two scenarios:

1. **Cross-role pages**: A page gated to `member` and `team_manager` that contains a manager-only `KnexUpdateOne` (e.g., "cancel assignment"). The page-level gate admits both roles; the request fires for either.
2. **Payload-conditional authorization**: A `KnexUpdateOne` on `soldier.role_tags` should be allowed only when the actor is `team_manager` for the soldier's team. Lowdefy doesn't evaluate this.

**Recommended mitigation (this is the architectural decision):**

- **For 95% of cases**: put mutating requests on **role-pure pages** (the page itself is gated to the privileged role). Manager actions live on `/schedule/publish` (gated to `team_manager`); soldier actions live on `/availability/declare` (gated to `member`). Mixed-role pages contain reads only.
- **For the remaining 5% (irreducibly mixed-role pages)**: wrap the dangerous request in a **custom Lowdefy request plugin** (see `09-plugins.md`) that re-checks the role server-side from the session before executing. This is the same primitive used for the notification dispatcher and is documented as the official escape hatch.
- **Define a layer-4 audit test**: a Playwright RBAC test that logs in as each role and attempts every mutating request on every page; assert the unauthorized ones 403.

**Conclusion on Postgres RLS as a 5th layer (the original question):**

- **Marginal value: HIGH.** RLS catches the bug class "developer forgot the `tenant_id` filter in a new query". This is exactly the v1 critical risk R4 ("Tenant-isolation bug in a Lowdefy YAML query (forgot tenant_id filter) leaks data").
- **YAML complexity: LOW.** RLS requires (a) one migration to enable on all tenant tables and write policies, (b) a session-variable setter that fires on every Lowdefy request. The setter has one wrinkle: Lowdefy's Knex connection is a pool, so `SET LOCAL` must run inside the same transaction as the query, OR the connection must be acquired with `current_setting('app.current_tenant')` already in place. Standard pattern: define a Knex `afterCreate` hook that runs `SET app.current_tenant = ...` per checkout. (Custom plugin work, ~30 lines.)
- **Performance: MINIMAL** if composite indexes lead on `tenant_id`. PRD's schema already does this on every domain table.
- **Recommendation: ship RLS as migration `0009_rls_policies.sql` in v1 Foundations phase, but as a defense-in-depth — NOT as a replacement for the four-layer defense.** Test that RLS rejects queries that omit `tenant_id` (red-team test).

Per [AWS multi-tenant RLS guide](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/) and [Crunchy Data RLS for tenants](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres/), the session-variable pattern is the standard:

```sql
-- 0009_rls_policies.sql
-- Create a dedicated app role; never use a superuser.
-- (Already implicit: docker-compose's POSTGRES_USER=shifts is non-superuser within Docker.
--  Verify with: SELECT rolsuper FROM pg_roles WHERE rolname='shifts'; -- must be false.)

-- For every domain table with tenant_id:
ALTER TABLE tenant            ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user          ENABLE ROW LEVEL SECURITY;
ALTER TABLE soldier           ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_slot        ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_window   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_instance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment        ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_override     ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_request      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_code       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_pref ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_recipient  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_audit    ENABLE ROW LEVEL SECURITY;
ALTER TABLE solver_run        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_import_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ical_subscription_token ENABLE ROW LEVEL SECURITY;

-- One policy template per table (tenant_id check):
CREATE POLICY tenant_isolation_soldier ON soldier
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
-- (repeat for every table above)

-- Set the session variable on every connection checkout.
-- Lowdefy/Knex hook: connection.afterCreate raw query
--   SET app.current_tenant = ${tenant_id_from_session};
-- This is implemented in a small Lowdefy connection-knex configuration shim
-- (custom plugin or wrapper request).
```

**Testing RLS effectiveness:** the kibbutz fixture (PRD test) seeds two tenants. Integration test attempts to SELECT tenant A's data while connected as tenant B's session — must return zero rows. This becomes a CI gate.

### Pattern 2: Solver Service HTTP Contract

The PRD §7.8 has the request/response schemas; this section pins down the operational details (auth, idempotency, timeouts).

#### Bearer auth

```yaml
# Lowdefy side — connection YAML for the solver
- id: solver
  type: AxiosHttp
  properties:
    baseURL: { _secret: SOLVER_BASE_URL }    # http://solver:8000 (internal)
    timeout: 15000                            # 15s — solver max_seconds=10 + 5s slack
    headers:
      Content-Type: application/json
      Authorization:
        _string.concat:
          - 'Bearer '
          - { _secret: SOLVER_SHARED_SECRET }
```

```python
# solver/app/auth.py
from fastapi import Header, HTTPException
import os, hmac

SECRET = os.environ["SOLVER_SHARED_SECRET"]

async def require_bearer(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401)
    token = authorization[7:]
    # Constant-time compare to avoid timing oracle.
    if not hmac.compare_digest(token, SECRET):
        raise HTTPException(401)
    return True
```

#### Timeout coordination

| Layer | Setting | Value |
|-------|---------|-------|
| `SolveRequest.max_seconds` (in request body) | CP-SAT solver wall-clock budget | 10 (default, configurable per call) |
| FastAPI route handler | server-side timeout (wraps solve loop) | 12s (2s slack for serialization) |
| Lowdefy `AxiosHttp.timeout` | HTTP client timeout | 15000ms (3s slack for network + serialize) |
| Lowdefy UI (`Loading` spinner) | UX timeout | 20s before "this is taking longer than usual" message |

**Rule:** every outer layer must exceed every inner layer by at least 2s. This guarantees the user-visible error is always the inner-most (most informative) one — `TIMEOUT` from solver, not `ECONNABORTED` from axios.

#### Idempotency: `solver_run_id` semantics

PRD §7.8 includes `solver_run_id` in `SolveRequest`. The implementation pattern:

1. **Lowdefy generates `solver_run_id = uuid_generate_v4()` BEFORE calling the solver** and INSERTS a `solver_run` row with `status='running'` and `request_payload`.
2. **Lowdefy calls `POST /solve` with `solver_run_id` in the body.**
3. **Solver is stateless — it does not persist anything keyed on `solver_run_id`.** It just echoes the id in the response.
4. **On response, Lowdefy UPDATEs the `solver_run` row with `status`, `response_payload`, `solve_time_seconds`, `completed_at`.**

This means: **the idempotency key lives in Postgres, not in the solver.** If the same `solver_run_id` is POSTed twice (e.g., user double-clicks the "Solve" button), the second call simply produces the same solver output and the Lowdefy-side UPDATE is idempotent (last write wins on the same row, with deterministic content given the same `random_seed`).

**Why this is sufficient for v1:** there's no risk of "solver charged twice" — the solver is internal and free. The only concern is "Lowdefy displays a stale draft because a retry overwrote a newer optimum." This is mitigated by: (a) the user-facing button is disabled during `status='running'`, (b) the UI polls `solver_run.status` via a refresh request, (c) determinism (same seed → same output) means retries don't surprise the user.

**Idempotency at the solver itself is intentionally NOT implemented.** A Redis-backed idempotency cache (per [Stripe-style guides](https://zuplo.com/learning-center/implementing-idempotency-keys-in-rest-apis-a-complete-guide)) would be over-engineered: it adds a stateful dependency to a service whose entire value proposition is "stateless and restartable".

#### `random_seed` and determinism

- Lowdefy generates the seed (e.g., `floor(epoch_ms / 1000)`) and stores it on `solver_run.request_payload`.
- Solver passes it to CP-SAT (`model.add_decision_strategy(..., random_seed=seed)`).
- Same `request_payload` (including seed) MUST produce the same `response_payload`. CI black-box test asserts this with the kibbutz fixture.

### Pattern 3: Cron Triggering

PRD §11 decided: separate `cron` compose service. node-cron container POSTs to Lowdefy `/api/internal/cron/<job>` with `CRON_SHARED_SECRET` header.

#### Implementation skeleton

```javascript
// cron/src/index.js
import cron from 'node-cron';
import fetch from 'node-fetch';

const LOWDEFY = process.env.LOWDEFY_INTERNAL_URL;  // http://lowdefy:3000
const SECRET = process.env.CRON_SHARED_SECRET;

async function trigger(job, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${LOWDEFY}/api/internal/cron/${job}`, {
        method: 'POST',
        headers: { 'X-Cron-Secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_at: new Date().toISOString() }),
        // 4-minute timeout — daily/weekly reports may take a while
        signal: AbortSignal.timeout(4 * 60 * 1000),
      });
      if (res.ok) {
        console.log(`[cron] ${job} ok (status=${res.status}, attempt=${i + 1})`);
        return;
      }
      console.warn(`[cron] ${job} non-2xx (status=${res.status}, attempt=${i + 1})`);
    } catch (e) {
      console.error(`[cron] ${job} threw (attempt=${i + 1}):`, e.message);
    }
    // Exponential backoff: 5s, 30s, 180s (3 attempts).
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 5000 * Math.pow(6, i)));
  }
  // After 3 failures: write a sentinel file that an Uptime Kuma probe checks.
  await fs.promises.appendFile('/var/log/cron-failures.log',
    `${new Date().toISOString()} ${job} FAILED after ${attempts} attempts\n`);
}

// Israel timezone for all schedules.
const TZ = 'Asia/Jerusalem';

cron.schedule(`0 ${process.env.CRON_DAILY_REPORT_HOUR || 7} * * *`,
              () => trigger('daily_report'), { timezone: TZ });
cron.schedule(`0 ${process.env.CRON_WEEKLY_DIGEST_HOUR || 8} * * 1`,  // Monday
              () => trigger('weekly_digest'), { timezone: TZ });
cron.schedule('0 * * * *',                                            // hourly
              () => trigger('lock_reminders'), { timezone: TZ });     // checks 24h-pre-lock windows
cron.schedule('5 0 * * *',                                            // 00:05 daily
              () => trigger('archive_windows'), { timezone: TZ });    // closes windows past end_date
```

#### Delivery semantics

- **At-most-once vs at-least-once for daily report:** **At-most-once is wrong** (a missed daily report is a silent failure that erodes trust). **Exactly-once is impractical** without a transactional outbox. **At-least-once with idempotency on the Lowdefy side is correct.**
- **Idempotency primitive:** `/api/internal/cron/daily_report` must be idempotent — it queries the most recent `notification_log` for `event_type='report.daily_briefing'` and `created_at >= today_local_midnight`. If a recipient already received today's report, skip them. This makes "double-firing" (e.g., cron container restart causes re-trigger) safe.

#### Failure modes

| Scenario | Effect | Mitigation |
|----------|--------|------------|
| Cron fires but Lowdefy is restarting | HTTP `503`, retry succeeds on attempt 2 or 3 | Retry-with-backoff in cron client (5s, 30s, 180s) |
| Lowdefy receives but Postgres is down | 500; eventually retry fails all 3 attempts | Sentinel file `/var/log/cron-failures.log`; Uptime Kuma alerts |
| Cron container itself crashes | Misses today's run | Docker `restart: unless-stopped`; container starts back; **today's report is lost** unless a backfill check at startup runs once. **Recommended: backfill-on-start.** Cron container queries Lowdefy `/api/internal/cron/catch_up` on every boot, which checks `notification_log` for missing report deliveries within the last 25h and dispatches them. |
| Daylight Saving boundary | node-cron with `timezone` setting handles this correctly (verified in node-cron 3.0+) | Lock to `node-cron` ≥3.0 in package.json |
| Drift between cron container clock and Lowdefy clock | Hours-late reports | All containers share host clock (Docker default); no NTP needed inside containers |

#### Observability

- **Where do failed cron runs surface?**
  1. **stdout/stderr of the cron container** → `docker logs -f shifty-cron` (manual)
  2. **`/var/log/cron-failures.log`** inside the container → mounted to host as `C:\shifts-manager\logs\cron-failures.log` (manual)
  3. **`notification_log` row with `status='failed'` and `event_type='cron.failure'`** — Lowdefy writes this when its `/api/internal/cron/*` handler throws.
  4. **In-app notification to tenant admin** (PRD §7.11 event `cron.failure`) — closes the loop, admin sees a banner.
  5. **Uptime Kuma "Push monitor"** — recommended: each cron job, on success, POSTs to a Kuma push URL. If Kuma doesn't see a push within the expected window, it alerts.

### Pattern 4: Notification Dispatcher

PRD §7.11 lists four channels (Email/Resend, WhatsApp/WAHA, Web Push, in-app). PRD §8.7 flags synchronous dispatch as a known v1 bottleneck.

#### Where the dispatcher lives — Recommendation: **Custom Lowdefy request plugin** (`app/plugins/shifty-notification-dispatcher/`)

**Why not Lowdefy operators (server or otherwise):**
- Operators are pure functions, not allowed to perform I/O for retry loops or `notification_log` writes.
- A multi-channel dispatcher needs to coordinate up to 4 HTTP calls + 1 DB write per recipient — operator semantics break here.

**Why not a sidecar Node service (separate container):**
- Adds a 5th container to manage; same docker network anyway.
- More importantly, the **synchronous dispatch model from PRD §7.11 means the event-firing Lowdefy request needs to know the dispatch outcome** (was the email queued? did push fail?). A sidecar would require an HTTP round-trip from Lowdefy → sidecar, which is no simpler than Lowdefy doing it inline via a plugin.

**Why a custom request plugin is the right primitive:**
- Lowdefy plugins run in the SAME Node process as the SSR. They have full Node API access (axios, web-push lib, knex pool).
- The plugin exports a request type like `DispatchNotification`. Pages call it via `type: DispatchNotification` in their `requests:` block, with `payload` carrying `{ event_type, recipient_id, template_vars }`.
- The plugin has direct access to the connection's Knex pool, so `notification_log` writes happen in the same DB context as the request.
- This is the official Lowdefy escape hatch — per maintainer ([discussion #1409](https://github.com/lowdefy/lowdefy/discussions/1409)): *"this is something you can build into the request method on v4 by writing a custom request plugin"*.

#### Sketch

```javascript
// app/plugins/shifty-notification-dispatcher/src/requests/DispatchNotification.js
async function DispatchNotification({ request, connection }) {
  const { event_type, recipient_id, template_vars, tenant_id } = request.payload;
  const knex = connection.client;  // the Knex instance from connection-knex

  // 1. Load recipient's notification_pref for this event_type.
  const pref = await knex('notification_pref')
    .where({ tenant_id, user_id: recipient_id, event_type })
    .first();
  const channels = pref?.channels ?? DEFAULT_CHANNELS[event_type];

  // 2. Load recipient's locale.
  const user = await knex('app_user').where({ id: recipient_id, tenant_id }).first();
  const locale = user.locale ?? 'he';

  // 3. Per channel: render template, dispatch, write notification_log row.
  const outcomes = {};
  for (const channel of channels) {
    const logId = await insertLog(knex, { tenant_id, recipient_id, event_type, channel, status: 'queued' });
    try {
      await dispatchToChannel(channel, event_type, template_vars, locale, user);
      await updateLog(knex, logId, { status: 'sent' });
      outcomes[channel] = 'sent';
    } catch (err) {
      await updateLog(knex, logId, { status: 'failed', provider_response: err.message });
      outcomes[channel] = 'failed';
    }
  }
  return { outcomes };
}

async function dispatchToChannel(channel, event_type, vars, locale, user) {
  const tmpl = await loadTemplate(event_type, locale);
  const body = render(tmpl, vars);

  switch (channel) {
    case 'email':    return await sendEmailWithRetry(user.email, body);
    case 'whatsapp': return await sendWhatsAppWithRetry(user.phone_e164, body);
    case 'push':     return await sendPushWithRetry(user.id, body);
    case 'in_app':   return await insertInAppRow(user.id, body);
  }
}

// Standard 3-retry exponential backoff. Per PRD §7.11 and Resend §9.
async function sendEmailWithRetry(to, body, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await resendClient.send({ to, ...body });
      return res;
    } catch (err) {
      if (err.status >= 400 && err.status < 500) throw err;  // don't retry 4xx (template bug)
      if (i === attempts - 1) throw err;
      await sleep([1000, 4000, 16000][i]);
    }
  }
}
```

#### Webhook delivery confirmation (queued → sent → delivered)

`notification_log.status` lifecycle:
1. **`queued`** — row inserted by dispatcher before the HTTP call.
2. **`sent`** — dispatcher's HTTP call succeeded (Resend returned 200, WAHA returned 200, etc.). Channel-level "we handed it off".
3. **`delivered`** — webhook receipt (`POST /api/webhook/resend` with `email.delivered` event) updates the row.
4. **`failed`** — all retries exhausted, OR webhook reports permanent failure.
5. **`bounced`** — webhook reports bounce (Resend `email.bounced`).

The webhook handlers (`/api/webhook/resend`, `/api/webhook/waha`) are Lowdefy public API endpoints (in `auth.api.public`) with signature/secret verification inside the handler. They UPDATE `notification_log` matching on `provider_response->>'message_id'`.

#### v1.1 escape hatch

If synchronous dispatch creates user-visible latency (e.g., the "Publish schedule" button takes >5s because it dispatches to 30 soldiers × 3 channels = 90 HTTP calls), the migration path is:

1. Dispatcher plugin starts INSERTing rows into a new `notification_outbox` table with `status='pending'`.
2. The plugin returns immediately to the caller.
3. A background worker (separate compose service, BullMQ on Redis, or a simple polling cron) processes the outbox.

PRD §13 puts this in v1.1; the architectural choice in v1 is to keep dispatch in-process via the plugin and accept the latency. If the bottleneck materializes earlier, the cron-service primitive already exists — a cron-driven outbox poller is a 100-LoC addition.

### Pattern 5: Audit Log Enforcement (append-only)

PRD §8.2 mandates audit tables are append-only. The `schedule_audit`, `roster_import_log`, `notification_log` tables.

#### Database-level enforcement

```sql
-- 0010_audit_revokes.sql
-- The app role (the 'shifts' user that Lowdefy connects as) gets only INSERT + SELECT.
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_audit FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON notification_log FROM shifts;
REVOKE UPDATE, DELETE, TRUNCATE ON roster_import_log FROM shifts;

-- Wait — notification_log NEEDS UPDATE for the queued→sent→delivered status lifecycle.
-- Carve-out: revoke DELETE only, allow UPDATE only on specific columns.
REVOKE DELETE, TRUNCATE ON notification_log FROM shifts;
-- (Postgres doesn't have column-level REVOKE for UPDATE in a single statement;
--  alternative is a trigger that rejects UPDATEs to immutable columns like event_type and created_at.)

CREATE OR REPLACE FUNCTION enforce_immutable_log() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type IS DISTINCT FROM OLD.event_type THEN
    RAISE EXCEPTION 'notification_log.event_type is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notification_log.created_at is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'notification_log.tenant_id is immutable';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'notification_log.user_id is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notification_log_immutable
  BEFORE UPDATE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_log();
```

This is the [standard Postgres audit pattern](https://wiki.postgresql.org/wiki/Audit_trigger): app role has only INSERT + SELECT (+ controlled UPDATE for status-lifecycle tables), and triggers protect immutable columns. Note the [Vlad Mihalcea guide on audit logging](https://vladmihalcea.com/postgresql-audit-logging-triggers/) and Supabase's [Postgres Auditing in 150 lines of SQL](https://supabase.com/blog/postgres-audit) for richer patterns if needed.

#### Reading audit without bloating live-query latency

The PRD dashboard surfaces audit data (e.g., "who changed this schedule"). To avoid full-table scans of `schedule_audit` from a high-traffic dashboard:

- **Index `schedule_audit(planning_window_id, created_at DESC)`** — already in migration 0006.
- **For aggregated dashboard counts**, use a materialized view refreshed nightly (e.g., `mv_schedule_audit_summary` per tenant × week with override counts). Cron service triggers `REFRESH MATERIALIZED VIEW CONCURRENTLY` daily.
- **Cap audit queries with LIMIT in the YAML** — every audit-list query specifies `LIMIT 50` with pagination.

### Pattern 6: Migration Runner

PRD §10 has migrations 0002–0007 sketched as plain SQL. The question: how do we *run* them against the compose Postgres?

#### Options reviewed

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Manual `docker compose exec psql` (current) | No new tooling; trivial | Easy to forget; no record of "what's applied"; no rollback | Suitable for solo dev pre-launch; **not durable beyond v1** |
| Flyway sidecar container | Industry standard; clear migration history table; broad community | Java JVM in compose (~150MB image); SQL-only without paid tier limits | **Heavy for a single-host home stack** |
| Sqitch | Pure SQL; no app-language coupling; explicit plan-based ordering | Perl runtime; smaller community; learning curve | Overkill |
| Atlas | Modern declarative; supports HCL or SQL | Go binary; less mature for plain SQL migrations | Promising but new |
| **`pgmigrate` / `golang-migrate` sidecar** | Tiny Go binary; reads `db/migrations/*.sql` in order; writes a `schema_migrations` table | Modest learning curve | **RECOMMENDED** |
| Lowdefy-side migration runner | Custom plugin runs migrations on boot | Coupling; doesn't run if Lowdefy crashes; build complexity | Not recommended |

**Recommendation: `migrate/migrate` (golang-migrate) as a one-shot compose service.**

Per [Bytebase's 2026 review of schema migration tools](https://www.bytebase.com/blog/top-database-schema-change-tool-evolution/), `golang-migrate/migrate` is the standard for Postgres-only Docker stacks: 10MB binary, reads numbered SQL files, writes `schema_migrations(version, dirty)`, supports `up`/`down`/`force`.

```yaml
# docker-compose.yml — new service
services:
  migrate:
    image: migrate/migrate:v4.17.0
    volumes:
      - ./db/migrations:/migrations:ro
    command: |
      -path /migrations
      -database postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable
      up
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"     # one-shot
```

Run manually: `docker compose run --rm migrate up`. Add to deploy script. The `schema_migrations` table tracks applied versions; re-runs are idempotent. PRD's "never edit a committed migration" rule maps directly onto golang-migrate's version-pinning model.

**v1 transition**: until `migrate` is wired in, continue using the manual `psql` approach (already documented in CLAUDE.md "Common ops"). Add `migrate` in the Foundations phase alongside migrations 0002+.

#### Migration ordering (FK-dependency tree)

Confirmed against the PRD §10 schemas:

```
0001_init.sql                            (existing: employees, shifts, assignments, availability, time_clock_entries)
   ↓ (legacy; superseded later)
0002_tenancy_and_org.sql                 tenant, org_unit, app_user, soldier, membership
   ↓ (everything below depends on tenant/org_unit/soldier)
0003_shifts_and_windows.sql              shift_slot, planning_window, shift_instance, assignment
                                          (drops old `assignments`; replaces with `assignment` tied to shift_instance)
   ↓ (FK: assignment, shift_instance)
0004_availability_rules_swaps.sql        availability (recreated), rule, rule_override, swap_request
   ↓ (FK: app_user)
0005_auth_and_notifications.sql          invite_code, invite_code_redemption, notification_pref,
                                          notification_log, push_subscription, report_recipient
   ↓ (FK: app_user, planning_window)
0006_audit_and_solver_runs.sql           schedule_audit, solver_run; ALTERs to time_clock_entries
   ↓
0007_imports_and_exports.sql             roster_import_log, ical_subscription_token
   ↓
0008_assignment_state_and_legacy_drop.sql adds assignment.state column; drops legacy employees, shifts, assignments
   ↓ (RLS depends on all tenant_id columns existing)
0009_rls_policies.sql                    ENABLE ROW LEVEL SECURITY on all 22 domain tables; CREATE POLICY
   ↓
0010_audit_revokes.sql                   REVOKE UPDATE/DELETE on audit tables; immutability triggers
```

**All migrations 0002–0010 can be applied in a single `docker compose run migrate up` pass.** The numeric ordering matches FK dependency exactly — no circular dependencies, no skipped layers.

## Data Flow

### Request Flow (Tenant-Isolated Query)

```
Browser                Lowdefy SSR              Postgres
   │                        │                       │
   │ GET /roster/list       │                       │
   ├───────────────────────▶│                       │
   │                        │                       │
   │           NextAuth middleware                  │
   │           extracts JWT → session.user.tenant_id│
   │                        │                       │
   │           Page auth check (Layer 3)            │
   │           "Is role in [team_manager, member]?" │
   │                        │                       │
   │           Render page YAML                     │
   │           Page renders requests block          │
   │                        │                       │
   │           Request `list_team_members`          │
   │           payload built (client-evaluated):    │
   │             tenant_id = _user.tenant_id        │
   │             team_id   = _state.selected_team   │
   │                        │                       │
   │           Server-side execution:               │
   │           - properties.parameters substitute   │
   │             from payload                       │
   │           - SET app.current_tenant = tenant_id │
   │             (if RLS pattern adopted)           │
   │           - SQL runs with WHERE tenant_id=...  │
   │                        ├──────────────────────▶│
   │                        │   parameterized SQL   │
   │                        │◀──────────────────────┤
   │                        │   rows (tenant-scoped)│
   │                        │                       │
   │           Response shaped into block tree     │
   │◀───────────────────────┤                       │
   │   HTML + initial state │                       │
```

### Solve Flow

```
Browser              Lowdefy                   Solver (FastAPI)         Postgres
   │                    │                            │                       │
   │ Click "Generate"   │                            │                       │
   ├───────────────────▶│                            │                       │
   │                    │ INSERT solver_run          │                       │
   │                    │   id, tenant_id, planning_window_id,               │
   │                    │   status='running', request_payload,│              │
   │                    │   random_seed                                      │
   │                    ├───────────────────────────────────────────────────▶│
   │                    │                                                    │
   │                    │ POST http://solver:8000/solve                      │
   │                    │ Authorization: Bearer ${SOLVER_SHARED_SECRET}      │
   │                    │ { tenant_id, team_id, solver_run_id,               │
   │                    │   window, shift_slots, soldiers, availability,     │
   │                    │   rules, rule_overrides,                           │
   │                    │   max_seconds=10, random_seed }                    │
   │                    ├───────────────────────────▶│                       │
   │                    │                            │ CP-SAT solve          │
   │                    │                            │ (≤10s wall-clock)     │
   │                    │                            │                       │
   │                    │                            │ Response:             │
   │                    │                            │ { status, solver_run_id,│
   │                    │                            │   assignments, ...   │
   │                    │                            │   solve_time_seconds }│
   │                    │◀───────────────────────────┤                       │
   │                    │                                                    │
   │                    │ UPDATE solver_run SET status, response_payload,    │
   │                    │   completed_at WHERE id = solver_run_id            │
   │                    ├───────────────────────────────────────────────────▶│
   │                    │                                                    │
   │                    │ INSERT proposed assignments (state='proposed')     │
   │                    │   per the response.assignments array               │
   │                    ├───────────────────────────────────────────────────▶│
   │                    │                                                    │
   │                    │ INSERT schedule_audit                              │
   │                    │   from_state=null, to_state='draft',               │
   │                    │   actor_kind='solver'                              │
   │                    ├───────────────────────────────────────────────────▶│
   │                    │                                                    │
   │ Draft view renders │                                                    │
   │◀───────────────────┤                                                    │
```

### Cron-Triggered Daily Report Flow

```
Cron container              Lowdefy                              Postgres                  Resend
   │                            │                                     │                       │
   │ 07:00 Asia/Jerusalem fires │                                     │                       │
   │ POST /api/internal/cron/daily_report                             │                       │
   │ X-Cron-Secret: ***                                               │                       │
   ├───────────────────────────▶│                                     │                       │
   │                            │                                     │                       │
   │                            │ Verify shared secret                │                       │
   │                            │ Query report_recipient WHERE subscriptions->>'daily'='true'  │
   │                            ├────────────────────────────────────▶│                       │
   │                            │                                     │                       │
   │                            │ For each tenant:                    │                       │
   │                            │  Query today's assignments,         │                       │
   │                            │  unscheduled-with-constraints       │                       │
   │                            ├────────────────────────────────────▶│                       │
   │                            │                                     │                       │
   │                            │ For each recipient (idempotency check first):               │
   │                            │  SELECT FROM notification_log WHERE                          │
   │                            │   event_type='report.daily_briefing' AND                    │
   │                            │   user_id/recipient_id=... AND                              │
   │                            │   created_at >= today_local_midnight                        │
   │                            │  If exists: skip                                            │
   │                            │                                     │                       │
   │                            │  Render template in recipient locale                        │
   │                            │  DispatchNotification request plugin:                        │
   │                            │    INSERT notification_log (queued)                         │
   │                            ├────────────────────────────────────▶│                       │
   │                            │                                                              │
   │                            │    POST https://api.resend.com/emails                       │
   │                            ├──────────────────────────────────────────────────────────────▶│
   │                            │                                                              │
   │                            │    UPDATE notification_log (sent)                            │
   │                            ├────────────────────────────────────▶│                       │
   │                            │                                                              │
   │ 200 OK with summary        │                                                              │
   │◀───────────────────────────┤                                                              │
   │                            │                                                              │
   │ Later: Resend webhook                                                                     │
   │ POST /api/webhook/resend                                                                  │
   │ { type: email.delivered, message_id: ... }                                                │
   │                            │ UPDATE notification_log (delivered)                          │
   │                            ├────────────────────────────────────▶│                       │
```

## Component Build Order — Validated Phase Structure

This validates and amends PRD §13.1.

### Validation of PRD §13.1

| PRD Phase | Components | Validates? | Notes |
|-----------|-----------|------------|-------|
| Foundations | migrations 0001–0007, auth + tenancy + RBAC | ✅ Yes, AMEND | Extend to migrations 0001–0010 (add 0008 legacy-drop, 0009 RLS, 0010 audit-revokes). Also include: **resolve active Lowdefy `ERR_MODULE_NOT_FOUND` runtime issue** (CLAUDE.md open question — non-negotiable blocker for everything downstream). Also add **`migrate` compose service** scaffolding. |
| Org & people | units, platoons, teams CRUD; soldier CRUD; CSV import | ✅ Yes | No changes |
| Availability & rules | availability UI; rules engine config; constraint lock | ✅ Yes | No changes |
| Solver & schedule | solver service; draft; manager edit; publish | ✅ Yes, REORDER | Solver service deployment is a 2-step: (a) deploy stateless `/solve` with no integration → black-box test against kibbutz fixture; (b) wire Lowdefy → Solver and write `solver_run` audit. **These are sequential, not parallel.** |
| Lifecycle features | swap; manager override; time clock | ✅ Yes | These three CAN run in parallel (validated below) |
| Notifications & reports | dispatcher across 4 channels; cron service; daily/weekly reports | ✅ Yes, AMEND | The dispatcher plugin (custom Lowdefy request plugin) is on the critical path BEFORE cron-driven reports, because the cron handler calls the dispatcher. **Order within phase**: (1) `shifty-notification-dispatcher` plugin scaffold + Email channel; (2) WhatsApp + Push + in-app channels in parallel; (3) cron service + daily/weekly endpoints. |
| Polish & exports | dashboard charts; iCal/CSV/PDF exports; English locale parity | ✅ Yes | These four CAN run in parallel; all depend only on the published schedule data being present |

### Hidden dependencies surfaced by this research

1. **Lowdefy runtime ERR_MODULE_NOT_FOUND must be resolved before any user-visible work.** CLAUDE.md flags this; it blocks even rendering a page. Foundations phase **must** start here, before any new YAML is added.
2. **Custom request plugin scaffold is a Foundations-phase prerequisite for layer-4 RBAC.** Without it, the four-layer defense's layer 4 ("server-side role check on every mutating request") is structurally incomplete. Adding plugin tooling in Foundations also unblocks the dispatcher in phase 6 (no migration cost).
3. **NextAuth `KnexAdapter` requires its own schema migration** (NextAuth tables: `users`, `accounts`, `sessions`, `verification_tokens`). This is implicit in PRD migrations but not numbered. **Recommend: add to migration 0002** alongside `app_user` (they coexist; `app_user` is the tenant-aware shadow of NextAuth's `users`).
4. **RLS migration depends on every domain table being created.** Migration 0009 must come last among schema migrations.
5. **The kibbutz fixture must exist before solver tests can be written.** Move fixture creation into Foundations phase (currently implicit).

### Explicit parallelism markers

Phases 1–3 are **sequential**. Phases 4 onwards have parallelism opportunities:

```
Phase 1 (Foundations) — SEQUENTIAL within phase, blocks all downstream
  ├─ unstick Lowdefy ERR_MODULE_NOT_FOUND       ┐
  ├─ migrate compose service + run 0002-0010    │  THIS ORDER
  ├─ NextAuth + Auth.js EmailProvider           │  REQUIRED
  ├─ session callback → tenant_id, role         │
  ├─ shifty-audit-writer plugin scaffold        ┘
  └─ kibbutz fixture seed

Phase 2 (Org & people) — MOSTLY SEQUENTIAL (FK chain)
  ├─ units/platoons/teams CRUD (units before platoons before teams)
  ├─ soldier CRUD
  └─ CSV roster import (DEPENDS on soldier CRUD; can be parallel to phase 3 if soldier CRUD done)

Phase 3 (Availability & rules) — SEQUENTIAL within
  ├─ shift_slot CRUD
  ├─ planning_window + shift_instance generation
  ├─ availability UI (hybrid)
  ├─ rules engine config
  └─ constraint_lock cron-fired event

Phase 4 (Solver & schedule) — SEQUENTIAL
  ├─ Deploy stateless solver `/solve` (no Lowdefy integration)
  │   └─ Black-box test against kibbutz fixture (CI)
  ├─ Wire Lowdefy → solver, persist solver_run
  ├─ Draft generation page
  ├─ Manager edit / hand-tweak
  └─ Publish state transition

Phase 5 (Lifecycle features) — PARALLEL (all three start after Phase 4 ends)
  ├─ Swap workflow                          ─┐
  ├─ Manager manual override                 ├─ parallel sub-agents
  └─ Time clock                              ─┘

Phase 6 (Notifications & reports) — INTERNALLY SEQUENTIAL, externally parallel with Phase 5
  ├─ shifty-notification-dispatcher plugin (Email channel first)
  ├─ WhatsApp + Push + in-app channels (parallel within)
  ├─ Webhook receivers (Resend + WAHA)
  ├─ cron compose service
  └─ Daily report + weekly digest + lock reminders + window archiver

Phase 7 (Polish & exports) — PARALLEL (all four)
  ├─ Dashboard charts (Unit / Team / Per-soldier / Leaderboard)  ─┐
  ├─ iCal export + signed-token subscription                      ├─ parallel sub-agents
  ├─ CSV export (with BOM)                                        │
  ├─ PDF export (Puppeteer)                                       │
  └─ English locale completeness + CI parity check                ┘
```

**Parallelizable units (after dependencies met):**
- Phase 5: 3 sub-agents (swap | override | time clock)
- Phase 6 sub-step 2: 3 sub-agents (WhatsApp | Push | in-app)
- Phase 7: 4 sub-agents (charts | iCal | CSV | PDF) + English locale completeness

## Failure Modes (Single-Host hpg5)

PRD risks R6, R7, R2 catalogue these. This section makes them concrete and proposes the ops observability layer.

| Failure | Trigger | Detection lag | Recovery | Mitigation |
|---------|---------|---------------|----------|------------|
| Power outage | Physical | Until user notices apps.nesher.co is down | Power restored → Windows auto-login (Autologon) → Docker Desktop autostart → compose `restart: unless-stopped` brings stack up. ~3-5 min from power-on. | **External uptime monitor (Uptime Kuma on neshernas at 192.168.1.121)** pings `https://apps.nesher.co/api/health` every 60s; alerts to email + Telegram on 2 consecutive failures. |
| Docker Desktop crash | DD bug, OOM | Until uptime monitor alerts | DD has a "restart engine" autoreload; if engine is fully dead, manual: RDP into hpg5, restart DD via tray. | Same uptime monitor; secondary check: from neshernas, `docker -H ssh://claude@hpg5 ps` periodically. |
| `claude` user logged out (R7) | RDP issued by another admin user; Windows update | Until next `docker pull` / `docker compose build` is attempted → fails with credential-helper error | RDP back in as claude, accept the Autologon. | Daily push from cron container at 03:00 hits a Kuma push URL. If Kuma doesn't see it, alert. (This catches the case where Docker Desktop is up but `claude` interactive session is gone, since cron would have failed.) |
| WAHA session drop (R2) | WhatsApp logs out the WAHA gateway (e.g., user opened WhatsApp Web on another device) | Until soldier reports "I'm not getting WhatsApp" | Manual: admin opens `http://hpg5:3000/dashboard` (WAHA admin), re-scans QR code. | WAHA exposes a `/api/sessions/default/status` endpoint; cron container polls it every 5 min. On `status != 'WORKING'`, fires `waha.session_down` event → notifies tenant admin via email + in-app. |
| Postgres disk fills | Excess pg_wal, bloated indexes | Until INSERTs start failing | `docker compose exec postgres vacuumdb -U shifts -d shifts --analyze`; investigate which table. | Daily backup script (already planned, PRD §8.8) also runs `SELECT pg_database_size('shifts');` and writes to a log; threshold alert at 50% of disk (host alert). |
| Cloudflare Tunnel down | Cloudflared crash, tunnel credentials expired | Until external monitor (Kuma) alerts | Cloudflared runs in a separate user account; admin RDPs and restarts. | Internal LAN check from neshernas: `curl -fsS http://hpg5:8080/api/health`. If LAN works but tunnel doesn't, problem is isolated to cloudflared. |
| Postgres data corruption | Disk failure, OS power-cut | Detected on startup (FATAL) | Restore from last `pg_dump` (PRD §8.8 RPO 24h). | Off-host nightly backup to neshernas (PRD §8.8); test quarterly restore drill. |

### Daily ops checklist (recommended)

A 2-minute Monday checklist for the user, runnable from a laptop on Tailscale:

```
1. https://apps.nesher.co loads, login works                          (Kuma + manual)
2. `docker -H ssh://claude@hpg5 compose ps` — all 5 services healthy  (manual)
3. `docker logs --tail 20 shifty-lowdefy` — no ERROR lines             (manual)
4. `docker logs --tail 20 shifty-cron` — last 24h triggers all 2xx     (manual)
5. WAHA dashboard at http://hpg5:3000 — session WORKING                (manual)
6. notification_log: 24h failed-count < 1% of sent                     (SQL query)
7. solver_run: last 24h status='timeout' or 'error' count == 0         (SQL query)
8. Backup file from last night exists at C:\shifts-manager\backups\pg\YYYY-MM-DD.dump (Kuma file-age monitor)
```

### Observability stack recommendation

Per [Uptime Kuma homelab guides](https://www.homelabstarter.com/homelab-uptime-monitoring/) and [Coroot's docker-homelab monitoring write-up](https://coroot.com/blog/monitoring-a-docker-homelab-with-coroot/):

- **Uptime Kuma on neshernas (192.168.1.121)** — separate host, watches hpg5 from outside.
  - HTTP monitors: `https://apps.nesher.co/api/health` (60s), `http://hpg5:8080/api/health` (60s, internal)
  - Push monitors: `/healthz/cron_daily` (window 25h), `/healthz/backup_dump` (window 25h)
  - TCP monitors: `192.168.1.133:8080` (LAN reachability)
- **Dozzle on hpg5** (optional) — browser-based log viewer; cheaper than running ELK
- **No Prometheus/Grafana for v1** — overkill for a 5-container stack with 1-10 tenants

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **v1 target: 100 tenants × 200 soldiers** | Single Postgres on hpg5; single Lowdefy SSR; single Solver pod. Composite tenant_id indexes hold. Synchronous notification dispatch acceptable. RLS overhead < 5%. **No changes needed.** |
| **1K tenants** | Notification dispatcher to async (BullMQ + Redis sidecar); cron to BullMQ repeatables. Solver may need 2-3 pods behind nginx (round-robin). Postgres still single instance; pg_dump backups grow to ~5GB. RLS overhead more pronounced — verify with EXPLAIN ANALYZE on top-3 queries. |
| **10K tenants** | Postgres logical partitioning by tenant_id (declarative partitioning); pgBouncer in transaction-pooling mode. Lowdefy horizontally scaled behind a load balancer (NextAuth requires sticky sessions OR JWT strategy without DB sessions). Solver to a job queue with 5+ workers. Backups via WAL-G to S3. **Move off hpg5 by here**. |

### Scaling Priorities (what breaks first)

1. **First bottleneck: synchronous notification dispatch.** When a "Publish schedule" affects 30+ soldiers with 3+ channels each, the request blocks for 5-15s. Mitigation: async dispatcher (planned v1.1).
2. **Second bottleneck: solver concurrency.** If two managers run `/solve` simultaneously, the single FastAPI worker serializes. Mitigation: gunicorn with 2-4 workers; tune for ~10s solver runs.
3. **Third bottleneck: PDF rendering.** Puppeteer is ~500ms-2s per page; concurrent exports may queue. Mitigation: a rate-limit (max 3 concurrent renders) per Lowdefy instance.
4. **Fourth bottleneck: Postgres connection pool.** Default Knex pool is 10; at high read concurrency the pool can saturate. Mitigation: increase to 20-30 in the connection config; verify pool stats in logs.

## Anti-Patterns

### Anti-Pattern 1: Trusting client-supplied `tenant_id`

**What people do:** Have the page pass `tenant_id` via `_state` or `_input` because "it's just a UUID".
**Why it's wrong:** Trivial cross-tenant data access by anyone who edits the request payload in DevTools.
**Do instead:** Every `tenant_id` parameter in `payload:` comes from `_user: tenant_id`. Code-review checklist enforces this. RLS is the database-side seatbelt.

### Anti-Pattern 2: Putting business logic in operators

**What people do:** Write a complex `_function`-based operator to do "if soldier has tag X and rule Y enabled, apply override Z".
**Why it's wrong:** Operators run client-side (or in a context where they can't reach the DB consistently). Logic in operators bypasses audit, retry, and the dispatcher pattern.
**Do instead:** Push business logic into custom request plugins. Operators do formatting and light transformation only.

### Anti-Pattern 3: Solver calling Postgres

**What people do:** "Let the solver read availability directly from the DB to skip Lowdefy serialization overhead."
**Why it's wrong:** Breaks statelessness; solver now needs DB credentials and tenant context; solver restarts are no longer trivial; PRD §11 direction-of-calls is violated.
**Do instead:** Lowdefy assembles the SolveRequest from DB and passes it whole. The serialization overhead is <100ms for 30-soldier × 30-day inputs; not the bottleneck.

### Anti-Pattern 4: Cron container holding tenant state

**What people do:** "Cron should query the DB to find which tenants have a daily report subscription."
**Why it's wrong:** Adds DB access from cron; couples cron to the schema; cron failures (DB credential rotation) now affect reports.
**Do instead:** Cron is dumb. It fires HTTP requests at fixed times. Lowdefy handles the "which tenants" logic. The cron container has zero DB credentials, zero schema knowledge.

### Anti-Pattern 5: Mutating `notification_log` to "fix" delivery status

**What people do:** Admin sees a stuck `queued` row; runs `UPDATE notification_log SET status='delivered' WHERE ...` to clean it up.
**Why it's wrong:** Defeats the audit guarantee; the immutability invariant is violated.
**Do instead:** Insert a compensating row (`event_type='admin.manual_status_correction'`, references the original log row's id). Audit shows the truth.

### Anti-Pattern 6: Mixing Lowdefy plugin loading and pnpm symlinks

**What people do:** Add a new plugin dependency, run `pnpm install`, expect it to work.
**Why it's wrong:** This is the active blocker (CLAUDE.md open question). pnpm's symlinked node_modules layout doesn't survive the multi-stage Dockerfile COPY. The Next.js standalone build at runtime can't resolve `@lowdefy/helpers-<hash>`.
**Do instead:** Follow Lowdefy's published Dockerfile exactly; use `--preserve-symlinks --preserve-symlinks-main` on the Node start command; OR switch to npm for the build stage. Resolve before adding any new plugins.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Resend | HTTPS, bearer token in `AxiosHttp` connection; retries inline via dispatcher plugin; webhook receipt updates `notification_log.status` | Domain `nesher.co` must be verified once; bounce/complaint rate monitored via webhook payload |
| WAHA | Internal HTTP (`http://waha:3000`), shared secret in header; session keep-alive monitored by cron poll | Self-hosted unofficial WhatsApp gateway; session can drop; no SLA |
| Web Push (VAPID) | HTTPS to push services (Mozilla autopush, Google FCM, Apple Push); VAPID keys in env; subscription stored in `push_subscription` | Per-browser subscription; 410 Gone → delete subscription row |
| Cloudflare Tunnel | Operationally separate; out-of-scope for Lowdefy config | Runs in a separate Windows user account; doesn't depend on Docker |
| (Solver via internal HTTP — counts as integration boundary) | Internal HTTP `http://solver:8000/solve`; bearer token | Same compose network; not externally reachable |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Lowdefy ↔ Postgres | Knex (pg client) over internal docker network; `postgres:5432` | Connection pool size: 20 (recommended); set `app.current_tenant` per request via `afterCreate` hook if RLS adopted |
| Lowdefy ↔ Solver | `AxiosHttp` with bearer; `http://solver:8000/solve` | 15s client timeout; solver internal max_seconds=10 |
| Lowdefy ↔ WAHA | `AxiosHttp` with API key; `http://waha:3000/api/sendText` | Best-effort; logs `failed` on non-2xx; in-app fallback always fires |
| Cron ↔ Lowdefy | `node-fetch` to `http://lowdefy:3000/api/internal/cron/<job>`; `X-Cron-Secret` header | 3 retries (5s/30s/180s); failures append to mounted log file |
| Resend ↔ Lowdefy (webhooks) | Resend POSTs to public `/api/webhook/resend`; signature in `Svix-Signature` header verified before processing | Lowdefy treats this as `auth.api.public` (signature is the auth) |
| WAHA ↔ Lowdefy (webhooks) | WAHA POSTs to internal `/api/webhook/waha`; shared secret in `X-Webhook-Secret` header | Reports session-down events |

## Sources

### Authoritative (HIGH confidence)
- [PRD §7.8 — Solver service API contract](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 342–523)
- [PRD §7.11 — Notifications](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 566–614)
- [PRD §8.2/§8.3 — Security + RBAC](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 719–770)
- [PRD §10 — Data model + migrations 0002-0007](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 851–1196)
- [PRD §11 — Architecture + endpoint catalog](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 1264–1347)
- [PRD §13.1 — v1 build dependency graph](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 1510–1556)
- [PRD §15 — Risks (R2, R4, R6, R7, R10)](file:///C:/Projects/shifts%20manager/docs/PRD.md) (lines 1598–1631)
- [Lowdefy skill: 02-connections.md, 03-requests.md, 06-operators.md, 08-auth.md, 09-plugins.md](file:///C:/Projects/shifts%20manager/.claude/skills/lowdefy/)

### Architecture / Patterns (MEDIUM confidence, verified across multiple sources)
- [Lowdefy GitHub discussion #1409: server-side validation, custom request plugins](https://github.com/lowdefy/lowdefy/discussions/1409) — load-bearing finding for layer-4 RBAC gap
- [Lowdefy GitHub discussion #666: role metadata in tokens](https://github.com/lowdefy/lowdefy/discussions/666)
- [Lowdefy OpenID example](https://github.com/lowdefy/lowdefy-example-openid-connect)
- [AWS: Multi-tenant data isolation with PostgreSQL Row Level Security](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Crunchy Data: Row Level Security for Tenants in Postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres/)
- [Nile: Shipping multi-tenant SaaS using Postgres RLS](https://www.thenile.dev/blog/multi-tenant-rls)
- [Permit.io: Postgres RLS Implementation Guide](https://www.permit.io/blog/postgres-rls-implementation-guide)
- [PostgreSQL Wiki: Audit trigger](https://wiki.postgresql.org/wiki/Audit_trigger) and [Audit trigger 91plus](https://wiki.postgresql.org/wiki/Audit_trigger_91plus)
- [Vlad Mihalcea: PostgreSQL audit logging using triggers](https://vladmihalcea.com/postgresql-audit-logging-triggers/)
- [Supabase: Postgres Auditing in 150 lines of SQL](https://supabase.com/blog/postgres-audit)
- [Bytebase: Top Database Schema Migration Tools 2026](https://www.bytebase.com/blog/top-database-schema-change-tool-evolution/)
- [Auth.js: Role Based Access Control](https://authjs.dev/guides/role-based-access-control)
- [NextAuth multi-tenant session discussion #9785](https://github.com/nextauthjs/next-auth/discussions/9785)
- [BullMQ Repeatable Jobs](https://docs.bullmq.io/guide/jobs/repeatable) (for v1.1 outbox planning)
- [Zuplo: Implementing Idempotency Keys in REST APIs](https://zuplo.com/learning-center/implementing-idempotency-keys-in-rest-apis-a-complete-guide)
- [Distr: Adding Cron Jobs to a Docker Compose application](https://distr.sh/blog/docker-compose-cron-jobs/)
- [Cronitor: How to run a cron job inside a docker container](https://cronitor.io/guides/running-cron-jobs-inside-a-docker-container)
- [OneUptime: Docker Cron Jobs (2026)](https://oneuptime.com/blog/post/2026-01-06-docker-cron-jobs/view)

### Observability (HIGH confidence for homelab tooling)
- [HomeLab Starter: Uptime Monitoring](https://www.homelabstarter.com/homelab-uptime-monitoring/)
- [Uptime Kuma](https://github.com/louislam/uptime-kuma)
- [Coroot: Monitoring a Docker Homelab](https://coroot.com/blog/monitoring-a-docker-homelab-with-coroot/)

---
*Architecture research for: Hebrew-first multi-tenant workforce scheduling SaaS (Lowdefy + FastAPI/OR-Tools + Postgres on single-host Docker Compose)*
*Researched: 2026-05-12*
