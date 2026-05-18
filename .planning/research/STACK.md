> **⚠️ HISTORICAL — superseded 2026-05-18.**
> This file was written during the Lowdefy and Budibase era and references stacks that have since been pivoted away from.
> Current stack: Next.js 15 + shadcn/ui + Auth.js + Drizzle + Postgres 16.
> See `.planning/deliberations/2026-05-18-budibase-to-nextjs-pivot.md` for the pivot ADR.
> Content below is preserved for historical context only. Do not use as a source of truth.

# Technology Stack — Shifty (v1, locked-stack patterns)

**Project:** Shifty — Miluim Shift Planning SaaS
**Researched:** 2026-05-12
**Scope:** Patterns, version pins, and recipes INSIDE the locked stack (Lowdefy 5.3 + Postgres 16 + FastAPI/OR-Tools + WAHA + Resend + Web Push + Puppeteer + node-cron + Cloudflare Tunnel on hpg5). The stack itself is NOT under review (PRD §1, PROJECT.md "Constraints"). This file pins versions and provides recipes for execution.

**Overall confidence:** HIGH on all version pins (Context7 + npm registry as of 2026-05-12); HIGH on the Lowdefy Docker fix (already proven in repo at commit b8afba1); MEDIUM on ECharts RTL strategy because ECharts has no native RTL support — requires CSS-level workaround discussed in §8; HIGH on OR-Tools patterns (canonical Google example exists for nurse scheduling and shift_scheduling_sat).

---

## Recommended Stack — version pins (HIGH confidence)

These are the exact versions to pin. Bumping a pin must follow the working-conventions rule (commit-and-rebuild, never silent upgrade).

### App layer

| Technology | Version | Purpose | Why this pin |
|------------|---------|---------|--------------|
| Lowdefy | `5.3.0` | UI + thin business logic, Auth.js wrapper, Next.js SSR runtime | Latest stable as of 2026-05-11; introduces AgentChat + MCP but those are opt-in; backward-compatible with the repo's current `app/package.json` ([Lowdefy release v5.3.0](https://github.com/lowdefy/lowdefy/releases)). PRD §1 locks `5.3`. |
| `@lowdefy/connection-knex` | `5.3.0` | PostgreSQL driver (uses Knex + `pg`) | Already pinned in `app/package.json`; matches engine pin. |
| `@lowdefy/blocks-aggrid` | `5.3.0` | Data tables (team calendar, leaderboard, audit log) | Already pinned. v5.3.0 upgrades to ag-grid 32.3.9 with button cell renderers and array-aware tag cells — useful for the roster screen and audit log. |
| `@lowdefy/blocks-echarts` | `5.3.0` | Charts (PRD §7.13 "Graphs and statistics views") | Latest matching engine. Wraps Apache ECharts 6.0.0 + echarts-for-react 3.0.5. **WARNING: ECharts has no native RTL support — see §8 RTL strategy below.** |
| `@lowdefy/blocks-tiptap` | `5.3.0` (only if rich-text needed) | Rich-text in notes/free-text fields | Optional; not required by v1 PRD. Skip unless a use case shows up. |
| Node.js (Lowdefy container) | `node:22-bookworm` | Runtime base image | Pinned in `app/Dockerfile`. Do **NOT** switch to `node:22-alpine` (musl breaks sharp; documented in the project's Lowdefy skill `reference/10-deployment.md`). |
| pnpm (build tooling) | `9.15.5` (NOT 11.x) | Package manager during build | Pinned via `corepack prepare pnpm@9.15.5 --activate`. pnpm 11 refuses to run build scripts for `@sentry/cli` and `sharp` which Lowdefy's `@lowdefy/server` pulls; the install exits non-zero and Lowdefy treats the whole install as failed. Documented in skill `reference/10-deployment.md`. |
| Auth.js / NextAuth | bundled with Lowdefy 5.3 | Auth provider runtime | Comes with the Lowdefy engine; not a separate pin. Confirmed via `reference/08-auth.md`. |
| Knex + `pg` driver | bundled with `@lowdefy/connection-knex` | DB layer | Not separately installed; comes with the connection plugin. |

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Postgres | `16` (image `postgres:16`) | Source of truth | Already pinned in `docker-compose.yml`; PRD §1 locks 16. The migrations in `db/migrations/` use Postgres-16-specific features (e.g., `gen_random_uuid()` directly available without extension). |
| Postgres extensions | `citext` (used in `app_user.email`), `uuid-ossp` not needed (use builtin `gen_random_uuid()`) | Case-insensitive email + UUID PKs | PRD §10 migration `0002` uses `CITEXT`; ensure `CREATE EXTENSION IF NOT EXISTS citext;` is in `0002_tenancy_and_org.sql`. UUID generation is built-in in PG 13+. |

### Solver service

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Python | `3.12` (image `python:3.12-slim-bookworm`) | Solver runtime | PRD §7.8 locks 3.12. Stay on slim-bookworm — OR-Tools wheels are glibc-based, not musl. **Do not use Alpine.** |
| `ortools` | `9.15.6755` | Constraint solver (CP-SAT) | Latest stable on PyPI as of 2026-01-14 ([ortools on PyPI](https://pypi.org/project/ortools/)); supports CPython 3.9–3.14. Pin precisely — OR-Tools breaks API across versions occasionally. |
| `fastapi` | `^0.115` | HTTP framework | Latest stable line. Use `~=0.115.0` (compatible release). |
| `uvicorn[standard]` | `^0.32` | ASGI server | Pair with FastAPI. |
| `pydantic` | `^2.9` | Request/response validation (matches PRD §7.8 JSON schemas) | v2 line; FastAPI 0.115 expects pydantic-v2 only. |
| `httpx` | `^0.27` | Test client / outbound HTTP (none expected in v1) | For pytest async tests. |
| `pytest` | `^8.3` | Unit + integration tests | PRD §8.4. |
| `pytest-asyncio` | `^0.24` | Async test support | For FastAPI testing. |
| `testcontainers` | `^4.8` | Real-Postgres integration tests | PRD §8.4 lists `testcontainers`. |
| Solver container base | `python:3.12-slim-bookworm` | Docker image | Match the Lowdefy side's debian family; avoid Alpine. |

### Integrations (HTTP clients + protocol libs)

| Library | Version | Where it runs | Purpose |
|---------|---------|---------------|---------|
| `resend` (npm) | `6.12.3` | Lowdefy container (or a tiny notification helper service if extracted later) | Email API client; includes `webhooks.verify()` SDK method which wraps Svix HMAC verification ([Resend webhook verify docs](https://resend.com/docs/webhooks/verify-webhooks-requests)). Requires Node >=20 — fine since we're on Node 22. |
| `web-push` (npm) | `3.6.7` | Lowdefy container | VAPID-signed Web Push delivery. Node engine `>=16`; works on Node 22. Default content encoding for new subscriptions is `aes128gcm` ([web-push README](https://github.com/web-push-libs/web-push)). |
| `node-cron` (npm) | `4.2.1` | **Separate** cron container (PRD §11 architecture) | Cron scheduler. **v4 introduces `noOverlap`, `maxRandomDelay`, and the consolidated `Options` type** — use the v4 API ([node-cron migrating from v3](https://nodecron.com/migrating-from-v3)), do not follow stale v3 tutorials. Supports IANA timezone string (`Asia/Jerusalem`). |
| `axios` or built-in `fetch` | use Node 22 `fetch` (no dependency) | Cron container outbound calls into Lowdefy `/api/internal/cron/<job_name>` | Native fetch in Node 22 is stable; avoid an axios dep purely for this. |
| `puppeteer` | `^23.x` (latest stable line; verify at install) | Lowdefy container OR a separate `pdf-renderer` sidecar (decision flagged below in §7) | Server-side PDF rendering for Hebrew. PRD §7.14 leans Puppeteer; confirmed below. |
| WAHA Docker image | `devlikeapro/waha:2026.4.3` (or pin to `2026.4`-series tag for floating patch) | `waha` service in compose | Latest release as of 2026-05-07 ([WAHA releases](https://github.com/devlikeapro/waha/releases)). Apache-2.0. **Choose `NOWEB` engine** (see §6). |

### Reverse proxy / public ingress

| Technology | Version | Notes |
|------------|---------|-------|
| Cloudflare Tunnel (`cloudflared`) | latest from Cloudflare (auto-updates on hpg5) | Already running in a separate Windows user account. Out of scope for this stack — documented in `CLAUDE.md`. |

---

## Alternatives Considered — already locked, captured for completeness

The stack is locked. This table exists only so future readers understand why deviations have already been ruled out.

| Category | Locked choice | Considered alternative | Why not |
|----------|---------------|------------------------|---------|
| Low-code framework | Lowdefy 5.3 | Appsmith CE, Budibase, ToolJet | "Powered by X" branding paywall on the free tier of all three (CLAUDE.md "Why Lowdefy"). |
| Chart library (Lowdefy block) | `@lowdefy/blocks-echarts` | `@lowdefy/blocks-amcharts` (AmCharts 4) | AmCharts is commercial-licensed for SaaS use ("Free" tier requires attribution; we're a SaaS so paid tier kicks in). ECharts is Apache-2.0. `@lowdefy/blocks-amcharts` was also last touched in March 2021, signalling abandoned status. Cost > RTL hassle. |
| Solver | OR-Tools CP-SAT | Pyomo, Cbc, custom greedy | OR-Tools has best-in-class CP-SAT performance, Apache-2.0, well-supported Python bindings, canonical employee-scheduling example in `examples/notebook/examples/shift_scheduling_sat.ipynb`. |
| WhatsApp gateway | WAHA self-hosted | Twilio WhatsApp, Meta Cloud API | Cost (Twilio: $0.005/msg + Meta conversation fees) + Meta business verification overhead; WAHA is self-hosted, Apache-2.0, zero per-message cost. R2 in PRD §15 accepts the session-drop operational risk. |
| Email | Resend | SendGrid, Postmark, SES | Resend is developer-first, free tier 3k emails/month + 100/day, modern webhooks (Svix), Hebrew RTL works via standard HTML — see §5. |
| Cron | Separate `node-cron` container | In-Lowdefy interval task, system crontab on hpg5 | Decoupled from Lowdefy restarts (key decision in PROJECT.md). Stateless. Restart-safe. |
| PDF renderer | Puppeteer | wkhtmltopdf, weasyprint, Playwright | Puppeteer's CSS support is closest to web-truth; wkhtmltopdf is unmaintained (last release 2022); WeasyPrint's CSS3 coverage is incomplete (e.g., flexbox); Playwright works too but is heavier (multi-browser bundle). |

---

## Installation manifest

### `app/package.json` (Lowdefy container — already in place)

```json
{
  "name": "shifty",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "lowdefy build",
    "dev": "lowdefy dev",
    "start": "lowdefy start"
  },
  "dependencies": {
    "lowdefy": "5.3.0",
    "@lowdefy/connection-knex": "5.3.0",
    "@lowdefy/blocks-aggrid": "5.3.0",
    "@lowdefy/blocks-echarts": "5.3.0",
    "resend": "6.12.3",
    "web-push": "3.6.7",
    "puppeteer": "^23.0.0"
  }
}
```

Add `@lowdefy/blocks-echarts`, `resend`, `web-push`, and `puppeteer` as part of the Foundations phase. The Lowdefy CLI's plugin declaration block also needs entries — see §1 below.

### `solver/pyproject.toml`

```toml
[project]
name = "shifty-solver"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "ortools==9.15.6755",
  "fastapi~=0.115.0",
  "uvicorn[standard]~=0.32.0",
  "pydantic~=2.9.0",
]

[project.optional-dependencies]
dev = [
  "pytest~=8.3.0",
  "pytest-asyncio~=0.24.0",
  "httpx~=0.27.0",
  "testcontainers~=4.8.0",
]
```

### `cron/package.json` (new service in `cron/`)

```json
{
  "name": "shifty-cron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node index.js" },
  "dependencies": { "node-cron": "4.2.1" }
}
```

No axios — use Node 22's built-in `fetch`.

---

## 1. Lowdefy 5.3 best practices for multi-tenant apps

### 1a. Four-layer tenant defense (matches PRD §8.3 "Enforcement")

Lowdefy enforces tenant isolation through these primitives, used together. **Missing any layer is a release-blocking bug** (PROJECT.md "Constraints").

**Layer 1 — Session carries `tenant_id` and `role`.** Use `auth.userFields` to map Postgres-derived custom fields onto the Lowdefy user object after NextAuth signin (HIGH confidence, [Lowdefy roles docs](https://docs.lowdefy.com/roles)):

```yaml
auth:
  userFields:
    id: profile.id
    roles: profile.role        # 'unit_admin' | 'team_manager' | 'member' | 'viewer'
    tenant_id: profile.tenant_id
    team_ids: profile.team_ids  # array of UUIDs the user belongs to
    locale: profile.locale
```

For NextAuth EmailProvider (magic link), the `profile` shape is whatever the adapter populates. With the KnexAdapter against our schema, after the invite-redemption callback writes `app_user`, every subsequent signin hydrates the session from the `app_user` row. Use a `SignInCallback` (PRD §7.2) to look up `membership` rows and inject `tenant_id` + `team_ids` into the session token before `userFields` mapping.

**Layer 2 — `_user: tenant_id` filter on EVERY query.** Use the `_user` operator in request `properties` (HIGH confidence, `reference/06-operators.md`). `properties` evaluates **server-side** so the value is trusted:

```yaml
- id: list_team_soldiers
  type: KnexRaw
  connectionId: shifts_db
  properties:
    query: |
      SELECT s.id, s.display_name, s.color, s.seniority, s.role_tags
      FROM soldier s
      JOIN membership m ON m.soldier_id = s.id
      WHERE s.tenant_id = :tenant_id
        AND m.org_unit_id = ANY(:team_ids)
        AND s.status = 'active'
      ORDER BY s.display_name;
    parameters:
      tenant_id:
        _user: tenant_id        # server-evaluated, trusted
      team_ids:
        _user: team_ids
```

**Anti-pattern (DO NOT do this):**

```yaml
# DO NOT — tenant_id from client payload is forgeable
properties:
  query: SELECT ... WHERE tenant_id = :tenant_id
  parameters:
    tenant_id:
      _payload: tenant_id     # client-controlled — FORBIDDEN
```

**Layer 3 — `auth.pages.roles` page gate (HIGH confidence, `reference/08-auth.md`):**

```yaml
auth:
  pages:
    protected: true
    public: [login, '404']
    roles:
      unit_admin:
        - admin_dashboard
        - manage_invites
        - manage_teams
      team_manager:
        - manager_dashboard
        - swap_review
        - run_solver
      member:
        - my_dashboard
        - my_availability
        - propose_swap
  api:
    protected: true
    roles:
      unit_admin: [create_invite, generate_export_all]
      team_manager: [trigger_solver, approve_swap]
```

**Layer 4 — Per-request server-side role re-check.** Use `_user.hasSomeRoles` in request `properties.auth` (or as a top-level request gate when the API surface allows). The `_user.hasSomeRoles` operator was confirmed available in 5.x ([Lowdefy _user docs](https://docs.lowdefy.com/_user)):

```yaml
- id: hard_delete_team
  type: KnexRaw
  connectionId: shifts_db
  properties:
    query: DELETE FROM org_unit WHERE id = :team_id AND tenant_id = :tenant_id;
    parameters:
      team_id: { _payload: team_id }
      tenant_id: { _user: tenant_id }
  # Even though page is admin-only, re-check on the server before the query fires:
  auth:
    roles: [unit_admin]
```

**Confidence: HIGH** — patterns 1–3 directly verified in Lowdefy docs; pattern 4 (`request.auth.roles`) verified via `reference/08-auth.md` ("Each request supports the same `auth` shape").

### 1b. YAML repo organization at scale (20+ pages)

The repo will pass 20 pages quickly (PRD §13.1 dependency graph shows ~25 named pages). The recommended pattern from `reference/01-schema-and-app.md`:

```
app/
  lowdefy.yaml                 # root: lowdefy version, auth, plugins, connections, menus
  connections/
    shifts_db.yaml             # KnexAdapter for NextAuth + main DB connection
    resend.yaml                # if using AxiosHttp wrapper for Resend webhooks
    waha.yaml
  pages/
    auth/
      login.yaml
      signup_with_invite.yaml
    soldier/
      dashboard.yaml
      my_availability.yaml
      propose_swap.yaml
      my_profile.yaml
    manager/
      dashboard.yaml
      team_calendar.yaml
      run_solver.yaml
      swap_review.yaml
      manual_override.yaml
    admin/
      dashboard.yaml
      manage_invites.yaml
      manage_teams.yaml
      reports_settings.yaml
    shared/
      _audit_log_block.yaml    # reusable block fragment loaded via _ref
      _calendar_grid.yaml
  templates/
    email/he/<event>.html
    email/en/<event>.html
    pdf/schedule.html          # Puppeteer renders this
  locales/
    he.json
    en.json
```

In `lowdefy.yaml`:

```yaml
pages:
  - _ref: pages/auth/login.yaml
  - _ref: pages/auth/signup_with_invite.yaml
  - _ref: pages/soldier/dashboard.yaml
  - _ref: pages/soldier/my_availability.yaml
  # ... etc
```

**`_ref` is a build-time include**, NOT a runtime fetch (`reference/01-schema-and-app.md`). It splices the referenced YAML into the parent. Use `vars:` to parameterize reusable fragments — e.g., the same `_calendar_grid.yaml` reused for soldier-scope and team-scope:

```yaml
pages:
  - _ref:
      path: pages/shared/_calendar_grid.yaml
      vars:
        page_id: my_week
        scope: soldier
  - _ref:
      path: pages/shared/_calendar_grid.yaml
      vars:
        page_id: team_week
        scope: team
```

**Anti-pattern:** keeping all pages in `lowdefy.yaml`. By the time the file passes ~1500 lines it becomes unreadable and merge conflicts multiply.

### 1c. Plugin declaration discipline (cross-cutting gotcha #6 from skill)

For every plugin you `npm install`, you ALSO need to declare it under `plugins:` in `lowdefy.yaml`:

```yaml
plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
  - name: '@lowdefy/blocks-echarts'
    version: '5.3.0'
```

Either declaration alone is silent failure: install-without-declare → "Block type X not defined" at build; declare-without-install → install errors during `lowdefy build`.

**Confidence: HIGH** (Lowdefy skill `reference/09-plugins.md`).

---

## 2. Auth.js + Lowdefy integration

### 2a. EmailProvider + KnexAdapter for magic links

NextAuth's `EmailProvider` requires a database adapter to persist verification tokens. Lowdefy's `KnexAdapter` is the right choice — it reuses the existing `shifts_db` connection so we don't need a second DB pool. From `reference/08-auth.md`:

```yaml
auth:
  adapter:
    type: KnexAdapter
    properties:
      connectionId: shifts_db
  providers:
    - id: email
      type: EmailProvider
      properties:
        # Auth.js EmailProvider supports HTTP-based delivery in v5,
        # but Lowdefy 5.3 still uses the SMTP-shaped config.
        # For Resend, set server to Resend's SMTP relay:
        server:
          host: smtp.resend.com
          port: 465
          auth:
            user: resend
            pass: { _secret: RESEND_API_KEY }
        from: shifty@nesher.co
        maxAge: 1800       # magic link valid 30 minutes
  session:
    strategy: jwt          # JWT in cookies; simpler than database sessions
    maxAge: 2592000        # 30 days, matches PRD pattern
```

**Why Resend SMTP and not Resend HTTP for magic links:** Auth.js's bundled `EmailProvider` speaks SMTP. Resend exposes SMTP on `smtp.resend.com:465` (TLS). For all OTHER emails (notifications, reports), use the Resend HTTP SDK directly. Two paths is OK — the magic-link path is the only one Auth.js controls.

The KnexAdapter's tables (`users`, `accounts`, `sessions`, `verification_tokens`) need to be created in a migration. They are NextAuth-defined; add them as `db/migrations/0008_nextauth_adapter.sql` (or piggyback onto `0005_auth_and_notifications.sql` per PRD §10).

**Confidence: HIGH** for the adapter pattern; **MEDIUM** for the Resend-SMTP-via-NextAuth detail (Resend's SMTP endpoint is documented but Lowdefy 5.3's `EmailProvider` block has not been tested against it in our skill — verify at implementation time, fall back to a custom plugin if needed).

### 2b. Invite-code redemption flow

PRD §7.2 specifies invite codes as a separate flow that pre-creates `app_user`. The cleanest pattern in Lowdefy:

1. **Signup page (`/signup_with_invite`)**: user enters invite code + email. A `KnexRaw` request validates the code (`SELECT * FROM invite_code WHERE code = :code AND expires_at > now() AND redeemed_at IS NULL FOR UPDATE`). On success, INSERT a pending `app_user` with the locale and `tenant_id` and `membership` row pointing at the invite's team. Mark the invite redeemed.
2. **Trigger Auth.js magic link** for that email (using `Login` action with `providerId: email`).
3. **NextAuth callback fires** — the `app_user` row already exists, so the SessionCallback just hydrates the session.

```yaml
# pages/auth/signup_with_invite.yaml
id: signup_with_invite
type: PageHeaderMenu
properties:
  title: { _ref: locales/title_signup }
requests:
  - id: redeem_invite
    type: KnexRaw
    connectionId: shifts_db
    payload:
      code: { _state: invite_code_input }
      email: { _state: email_input }
    properties:
      query: |
        WITH inv AS (
          UPDATE invite_code
          SET redeemed_at = now(), redeemed_by_email = :email
          WHERE code = :code
            AND expires_at > now()
            AND redeemed_at IS NULL
          RETURNING tenant_id, team_id, role, locale_default
        ),
        new_user AS (
          INSERT INTO app_user (tenant_id, email, locale)
          SELECT tenant_id, :email, locale_default FROM inv
          ON CONFLICT (tenant_id, email) DO UPDATE SET email = EXCLUDED.email
          RETURNING id, tenant_id
        )
        INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
        SELECT nu.tenant_id, (SELECT id FROM soldier WHERE user_id = nu.id), inv.team_id, inv.role
        FROM new_user nu, inv
        RETURNING soldier_id, role;
      parameters:
        code: { _payload: code }
        email: { _payload: email }
```

This is intentionally one transaction in the SQL layer because rolling back partial writes across Lowdefy operators is harder than wrapping it server-side. Use a CTE chain (above) or wrap in `BEGIN ... COMMIT` via `KnexRaw` raw mode.

**Anti-pattern:** doing the redemption from a SessionCallback. The SessionCallback runs on EVERY session hydration; redemption is a one-shot. Keep them separate.

**Confidence: MEDIUM** — the CTE/transaction shape is standard SQL, but the exact "redeem on signup before NextAuth fires" sequencing needs care. If the magic-link click happens an hour later, by then the `app_user` is already there from step 1.

### 2c. Role + tenant propagation onto session

The cleanest path:

1. `auth.userFields` maps `roles` and `tenant_id` from the user-row JSON shape (see §1a).
2. For complex derivation (e.g., a user has multiple `membership` rows with different roles in different teams), write a custom auth callback plugin (`reference/09-plugins.md`). The plugin is JS and runs server-side in Lowdefy's NextAuth shell.

Typical session shape after callback:

```javascript
session.user = {
  id: "uuid-of-app_user",
  email: "ploni@example.com",
  tenant_id: "uuid-of-tenant",
  team_ids: ["uuid-1", "uuid-2"],
  roles: ["team_manager"],   // array; takes the highest per-team role
  locale: "he",
}
```

In Lowdefy YAML, this exposes as `_user.tenant_id`, `_user.team_ids`, `_user.roles`, `_user.locale`. The `_user.hasSomeRoles` helper checks `roles`.

**Confidence: HIGH** for the shape; **MEDIUM** for the callback plugin authoring (we have not actually written one yet in this repo, so a small spike during Foundations phase is prudent).

### 2d. Locale on session

Just add `locale: profile.locale` to `auth.userFields`. Then `_user.locale` is available everywhere — including in request `properties` server-side, where it picks the right template for outbound notifications (PRD §7.11 "Per-recipient locale" + §8.5).

---

## 3. OR-Tools CP-SAT — recipes for PRD §7.6 rules

The shift_scheduling_sat sample in the OR-Tools repo (`examples/notebook/examples/shift_scheduling_sat.ipynb`) is the closest match to our problem shape. We adapt it. Below are concrete encodings for the 8 PRD rules.

### Setup

```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# Indices
soldiers = list(range(num_soldiers))      # range based on len(request.soldiers)
days     = list(range(num_days))          # window length in days
slots    = list(range(num_slots))         # number of shift_slots per day

# Core decision variable: did soldier `s` work slot `k` on day `d`?
work = {}
for s in soldiers:
    for d in days:
        for k in slots:
            work[s, d, k] = model.new_bool_var(f"work_s{s}_d{d}_k{k}")

# Headcount: each (day, slot) must be filled by exactly headcount[k] soldiers
for d in days:
    for k in slots:
        model.add(sum(work[s, d, k] for s in soldiers) == shift_slots[k].headcount)

# Availability: where availability says NOT available, force the var to 0
for av in request.availability:
    if not av.available:
        s_idx = soldier_to_idx[av.soldier_id]
        d_idx = date_to_idx[av.date]
        if av.slot_id is None:   # day-blockout: 0 for all slots that day
            for k in slots:
                model.add(work[s_idx, d_idx, k] == 0)
        else:
            k_idx = slot_to_idx[av.slot_id]
            model.add(work[s_idx, d_idx, k_idx] == 0)

# Role-tag filtering: where required_role_tags is non-empty, only matching soldiers can be assigned
for k in slots:
    if shift_slots[k].required_role_tags:
        for s in soldiers:
            if not set(shift_slots[k].required_role_tags).issubset(set(soldiers[s].role_tags)):
                for d in days:
                    model.add(work[s, d, k] == 0)
```

### Rule 1: `no_same_day_double` (REQUIRED in PRD §7.6 example)

```python
if rules.no_same_day_double:
    for s in soldiers:
        for d in days:
            model.add_at_most_one(work[s, d, k] for k in slots)
```

`add_at_most_one` is the right primitive — translates to native SAT cardinality clauses, much faster than `sum(...) <= 1`. **Confidence: HIGH** ([OR-Tools nurse scheduling example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/nurses_sat.ipynb)).

### Rule 2: `no_consecutive_shift2_then_shift1` (REQUIRED)

PRD wording: "No night-shift assignment followed by a morning assignment on the next day". Assuming slot indices are sorted by `start_time` so `slots[-1]` is the latest start (night) and `slots[0]` is the earliest (morning):

```python
if rules.no_consecutive_shift2_then_shift1:
    night_slot = slots[-1]   # or look up by name
    morning_slot = slots[0]
    for s in soldiers:
        for d in days[:-1]:
            # forbid (worked night on d) AND (worked morning on d+1)
            model.add(work[s, d, night_slot] + work[s, d+1, morning_slot] <= 1)
```

### Rule 3: `max_consecutive_nights` (this is one of the 2 the quality gate asks for)

PRD: "A soldier cannot be assigned to more than N consecutive nights." Standard CP-SAT encoding:

```python
N = rules.max_consecutive_nights or 3
if N:
    for s in soldiers:
        # For each window of N+1 consecutive days, the sum of night-slot work is <= N
        for start_day in range(num_days - N):
            window = [work[s, d, night_slot] for d in range(start_day, start_day + N + 1)]
            model.add(sum(window) <= N)
```

This is the textbook "no more than N successes in a sliding window of size N+1" encoding. **Confidence: HIGH** (mirrored from the OR-Tools nurse_scheduling and shift_scheduling_sat soft-sequence helpers).

### Rule 4: `weekend_separation` (REQUIRED)

PRD: "If a soldier worked weekend N, they cannot work weekend N+1." Weekend = Friday + Saturday (Israeli, hardcoded). The clean encoding uses a per-(soldier, week) boolean for "worked some weekend slot":

```python
from datetime import date, timedelta

# Pre-compute: for each soldier and each ISO-week, the boolean "worked weekend"
worked_weekend = {}
for s in soldiers:
    for w_idx, week_days in enumerate(group_into_iso_weeks(days)):
        weekend_slots = [
            work[s, d, k]
            for d in week_days
            for k in slots
            if date_of(d).weekday() in (4, 5)   # Friday=4, Saturday=5 in Python
        ]
        if not weekend_slots:
            continue
        ww = model.new_bool_var(f"worked_weekend_s{s}_w{w_idx}")
        # ww = 1 iff at least one weekend slot was worked
        model.add_max_equality(ww, weekend_slots)   # or: model.add_bool_or with channeling
        worked_weekend[s, w_idx] = ww

# Enforce: no two consecutive weeks of worked-weekend
if rules.weekend_separation:
    for s in soldiers:
        for w in range(num_weeks - 1):
            if (s, w) in worked_weekend and (s, w + 1) in worked_weekend:
                model.add(worked_weekend[s, w] + worked_weekend[s, w + 1] <= 1)
```

`add_max_equality(ww, [list_of_bools])` is the CP-SAT idiom for "ww is the max (i.e., OR) of these booleans". **Confidence: HIGH**.

### Rule 5: `max_weekly_hours` (this is the 2nd one the quality gate asks for)

PRD: "Total assigned hours per ISO-week cannot exceed N." Compute slot duration in hours (integer hours work fine for v1; if 30-min slots show up later we'll multiply by 2):

```python
hours_per_slot = [shift_slots[k].duration_hours for k in slots]
H = rules.max_weekly_hours or 60

if H:
    for s in soldiers:
        for w_idx, week_days in enumerate(group_into_iso_weeks(days)):
            weekly_hours = sum(
                hours_per_slot[k] * work[s, d, k]
                for d in week_days
                for k in slots
            )
            model.add(weekly_hours <= H)
```

`sum(...)` on `BoolVar` mixed with int coefficients produces a `LinearExpr` that CP-SAT consumes natively. **Confidence: HIGH** — this is identical to the weekly-sum pattern in `shift_scheduling_sat.ipynb` (`add_soft_sum_constraint`).

### Rule 6: `min_rest_hours_between_shifts`

Express slot start/end as integer minutes from window epoch. Then for any two consecutive slot assignments for the same soldier, ensure the gap is >= the threshold. The compact encoding:

```python
R_min = (rules.min_rest_hours_between_shifts or 8) * 60   # minutes

# For each soldier and each pair of (day, slot) → (day', slot') with start_time(d', k') < end_time(d, k) + R_min,
# the two cannot both be 1.
for s in soldiers:
    for d in days:
        for k in slots:
            end_min = day_to_epoch_minutes(d) + slot_end_min(k)
            for d2 in days:
                for k2 in slots:
                    start_min = day_to_epoch_minutes(d2) + slot_start_min(k2)
                    if 0 < start_min - end_min < R_min:
                        model.add(work[s, d, k] + work[s, d2, k2] <= 1)
```

For 30 soldiers × 30 days × 4 slots = 3600 vars, pairs = O(3600²) ≈ 13M, but only a tiny subset trigger because `0 < gap < R_min` is narrow (e.g., only ~3 slot pairs per day boundary). Pre-filter to the actual relevant pairs (typically ~120 per soldier).

**Performance note:** Be careful — naively iterating all pairs is slow. Better: pre-compute, for each (d, k), the set of (d', k') whose start_time falls in [end_min, end_min + R_min); typically same-day later slots and next-day earliest slots.

### Rule 7: `max_shifts_per_period`

```python
M = rules.max_shifts_per_period
if M:
    for s in soldiers:
        total = sum(work[s, d, k] for d in days for k in slots)
        model.add(total <= M)
```

Trivial.

### Rule 8: `fairness_objective` (THE OBJECTIVE)

PRD: variance-minimization over (counts | hours | nights). CP-SAT does not natively minimize variance (which is quadratic). The standard trick is **minimize the range (max − min)** or **minimize the sum of absolute deviations from the average**, both of which are linear and produce near-equivalent fairness in practice. The OR-Tools community recommends range minimization for nurse scheduling.

```python
if rules.fairness_objective == "count_variance":
    counts = []
    for s in soldiers:
        c = model.new_int_var(0, num_days * num_slots, f"count_s{s}")
        model.add(c == sum(work[s, d, k] for d in days for k in slots))
        counts.append(c)
    c_min = model.new_int_var(0, num_days * num_slots, "count_min")
    c_max = model.new_int_var(0, num_days * num_slots, "count_max")
    model.add_min_equality(c_min, counts)
    model.add_max_equality(c_max, counts)
    model.minimize(c_max - c_min)

elif rules.fairness_objective == "hours_variance":
    # same shape with hours_per_slot weighting
    ...

elif rules.fairness_objective == "night_variance":
    # same shape but only count work[s, d, night_slot]
    ...

# rules.fairness_objective == "off"   → don't add a minimize() call; solver does feasibility-only
```

**Why range and not true variance:** True variance is `mean(x_s²) - mean(x_s)²` — quadratic in `x_s`. CP-SAT supports quadratic objectives only awkwardly (via auxiliary squared-variable encoding); range is linear and gives nearly identical "fair" solutions. **Confidence: HIGH** — this is the standard pattern in published nurse-scheduling OR-Tools examples.

### Performance tuning for the <10s SLO (30 soldiers × 30 days × 4 slots = 3,600 booleans)

```python
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = request.max_seconds or 10
solver.parameters.num_workers = 8                              # parallelism
solver.parameters.random_seed = request.random_seed or 42      # determinism (same seed -> same output)
solver.parameters.search_branching = cp_model.PORTFOLIO_SEARCH
solver.parameters.linearization_level = 1                      # default; bump to 2 for harder instances
solver.parameters.log_search_progress = False                  # noisy in production; toggle in debug
status = solver.solve(model)
```

For determinism (PRD §7.8 "same seed = same output"), set `num_workers = 1` if perfect determinism matters more than wall time — multi-worker portfolios are *seed-deterministic* in 9.x but not bit-for-bit identical across CPU loads. v1 acceptance criteria allow `num_workers=8` for the perf SLO; for the determinism unit test, use `num_workers=1` and assert.

**Infeasibility report (PRD §7.8):** when status is INFEASIBLE, run a second solve with the suspected hard constraints disabled, one at a time, to identify which constraint(s) cause the infeasibility. The simplest first pass: for each rule, do a feasibility-only solve with just that rule + headcount + availability, and report which one was infeasible. **Confidence: MEDIUM** — this is the practical pattern; OR-Tools also has `SufficientAssumptionsForInfeasibility` (with `add_assumption` markers) but it requires restructuring constraints around assumption literals.

---

## 4. WAHA — current version, session management, webhooks, retries

### Version & engine pin

- **Image:** `devlikeapro/waha:2026.4.3` (or float on `2026.4` for patch updates). Latest release 2026-05-07 ([WAHA releases](https://github.com/devlikeapro/waha/releases)).
- **License:** Apache-2.0.
- **Engine choice:** `NOWEB` (set `WHATSAPP_DEFAULT_ENGINE=NOWEB`). Rationale:
  - **WEBJS** runs a headless Chromium + whatsapp-web.js — heavy memory footprint (~500 MB), reliable, but resource-hungry on hpg5.
  - **NOWEB** is a Node WebSocket client speaking WhatsApp's protocol directly via `@whiskeysockets/baileys` — lower memory (~80 MB), and as of WAHA 2026.x is the recommended engine for new deployments.
  - **GOWS** is the Go-based engine using `whatsmeow` — even lighter, but younger and may have feature gaps. Acceptable fallback if NOWEB exhibits stability issues.

**Confidence: HIGH** on the engine recommendation ([WAHA 2026.3 release notes](https://waha.devlike.pro/blog/waha-2026-3/) explicitly call out NOWEB upgrades and "fresh builds, proto updates, phone-login fixes, and poll stability improvements").

### Compose snippet to add

```yaml
services:
  waha:
    image: devlikeapro/waha:2026.4
    container_name: shifty-waha
    environment:
      WAHA_API_KEY: ${WAHA_API_KEY:?missing}
      WAHA_DASHBOARD_USERNAME: ${WAHA_DASHBOARD_USERNAME:-admin}
      WAHA_DASHBOARD_PASSWORD: ${WAHA_DASHBOARD_PASSWORD:?missing}
      WHATSAPP_DEFAULT_ENGINE: NOWEB
      WHATSAPP_HOOK_URL: http://lowdefy:3000/api/webhook/waha
      WHATSAPP_HOOK_EVENTS: message,session.status
      WAHA_LOG_FORMAT: JSON
      WAHA_LOG_LEVEL: info
      # Session storage on a named volume so QR-pairing survives restarts
      WHATSAPP_SESSIONS_POSTGRESQL_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    volumes:
      - ./waha-data:/app/.sessions      # fallback if PostgreSQL session storage isn't used
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    # No host port — internal only; admin reaches the dashboard via Lowdefy's admin page proxying it,
    # or via `docker compose exec` port-forward when troubleshooting.
```

### Webhook signature verification (HMAC, configured per-session)

WAHA supports HMAC-SHA512 signing of outbound webhooks. Pattern (HIGH confidence, from devlikeapro/waha docs):

```bash
# Create the session with HMAC + retry policy
curl -X POST http://waha:3000/api/sessions \
  -H "X-Api-Key: $WAHA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "default",
    "start": true,
    "config": {
      "webhooks": [{
        "url": "http://lowdefy:3000/api/webhook/waha",
        "events": ["message", "session.status"],
        "hmac": {"key": "'"$WAHA_WEBHOOK_SECRET"'"},
        "retries": {"delaySeconds": 2, "attempts": 15, "policy": "exponential"}
      }]
    }
  }'
```

On the Lowdefy side, the `/api/webhook/waha` endpoint verifies the `X-Webhook-Hmac-SHA512` header against the raw body using `WAHA_WEBHOOK_SECRET`. Since Lowdefy is a Next.js app under the hood, this endpoint will be a custom plugin or a manual `next.config.js`-injected route — the cleanest path is a Lowdefy plugin (`reference/09-plugins.md`) that exposes a request type `WahaWebhookVerify`.

**Retry semantics:** WAHA's per-session `retries.attempts: 15` with `policy: exponential` and `delaySeconds: 2` means roughly 2s, 4s, 8s, 16s, ... — totalling a long tail (>9 hours if all retries used). Use a saner pin: `attempts: 5, delaySeconds: 2, policy: exponential` (caps at ~64s).

### Session-down handling

WAHA emits `session.status` events when the underlying WhatsApp session disconnects (mobile phone uninstalled, account banned, etc.). PRD §7.11 already wires this to the `waha.session_down` notification event → tenant admin gets emailed. The R2 risk (PRD §15) says admin manually re-pairs by hitting the WAHA dashboard QR endpoint. Operational doc — no code change.

---

## 5. Resend — Hebrew/RTL templates, webhooks, bounce monitoring

### SDK version: `resend@6.12.3` (Node >=20, fine on Node 22).

### Hebrew RTL email template — the canonical pattern

The two layers (HIGH confidence, [W3C dir/lang guidance](https://www.w3.org/International/questions/qa-html-dir), [CodeTwo RTL email guide](https://www.codetwo.com/kb/right-to-left-languages/)):

```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>שיפטי - לוח משמרות פורסם</title>
  <style>
    body { font-family: Arial, "Segoe UI", "Noto Sans Hebrew", system-ui, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px; direction: rtl; text-align: right; }
    .ltr-inline { unicode-bidi: embed; direction: ltr; display: inline-block; }
  </style>
</head>
<body dir="rtl" lang="he">
  <div class="container">
    <h1>שלום {{ recipient_name }},</h1>
    <p>לוח המשמרות לשבוע <span class="ltr-inline">{{ week_range }}</span> פורסם.</p>
    <a href="https://apps.nesher.co/today">צפייה בלוח המשמרות</a>
  </div>
</body>
</html>
```

Key rules:
- `<html dir="rtl" lang="he">` is the canonical pair (one attribute is not enough; some email clients honor `dir` and ignore `lang`, others the reverse).
- Set `direction: rtl; text-align: right` on the main container too — some Outlook variants drop `dir` on `<html>` and only respect inline CSS.
- For embedded LTR content (English app names, phone numbers, date ranges like `12/05/2026 - 18/05/2026`), wrap in `<span style="unicode-bidi: embed; direction: ltr">` to prevent the bidi algorithm from reshuffling them.
- Don't rely on Hebrew-specific webfonts — most clients block `<link rel=stylesheet>` and many block `@font-face`. Use a system-font stack and accept that Outlook desktop will render in its default Hebrew font.

### Resend SDK send pattern

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Shifty <shifty@nesher.co>',
  to: [recipient.email],
  subject: subject,           // already locale-resolved
  html: htmlBody,             // already rendered with the dir="rtl" template above
  headers: { 'List-Unsubscribe': '<mailto:unsubscribe@nesher.co>' },
  tags: [
    { name: 'tenant', value: tenant_id },
    { name: 'event', value: 'schedule.published' },
  ],
});
```

### Webhook verification (Svix-signed)

Resend uses Svix under the hood. The SDK ships a `webhooks.verify()` helper — DO NOT roll your own HMAC, the Svix protocol uses a specific timestamp-window scheme that's easy to get wrong. From [Resend webhook verify docs](https://resend.com/docs/webhooks/verify-webhooks-requests):

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

export async function handler(req) {
  const payload = await req.text();   // RAW text, not parsed JSON
  const event = resend.webhooks.verify({
    payload,
    headers: {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    secret: process.env.RESEND_WEBHOOK_SECRET,
  });

  // event.type: 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.opened' | 'email.clicked'
  switch (event.type) {
    case 'email.delivered':
      await markDelivered(event.data.email_id, event.data.created_at);
      break;
    case 'email.bounced':
      await markBounced(event.data.email_id, event.data.bounce);
      // event.data.bounce.type: 'Permanent' | 'Transient'
      // event.data.bounce.subType: 'Suppressed' | 'MessageRejected' | etc.
      break;
    case 'email.complained':
      await markComplained(event.data.email_id);
      break;
  }
  return new Response('OK');
}
```

### Bounce-rate monitoring

Resend will start suppressing your sends if your bounce rate exceeds ~5%. To stay below that:

1. On `email.bounced` with `bounce.type === 'Permanent'`, mark the recipient's email as `unsubscribed` and skip future sends. Resend also adds them to its suppression list automatically.
2. Log bounce counts to `notification_log.status` (PRD §7.11) and surface a dashboard tile to the admin showing 7-day bounce rate.
3. For external `report_recipient` rows, treat permanent bounce as auto-unsubscribe (don't ask the admin to verify).

**Confidence: HIGH** on all of the above (Resend has well-documented webhook events; [email.bounced webhook docs](https://resend.com/docs/webhooks/emails/bounced)).

---

## 6. Web Push / VAPID — service worker, Hebrew payloads, 410 Gone

### Library: `web-push@3.6.7`. Node engine `>=16`. Default encoding `aes128gcm` (the modern Web Push standard; legacy `aesgcm` only needed for ancient Chrome).

### VAPID key generation (run once, store in `.env`)

```javascript
import webpush from 'web-push';
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log({ publicKey, privateKey });
// VAPID_PUBLIC_KEY=...
// VAPID_PRIVATE_KEY=...
// VAPID_SUBJECT=mailto:admin@nesher.co
```

PRD already locks "no rotation in v1" — rotating these keys invalidates all existing subscriptions.

### Sending a push (Hebrew payload, mind the 4 KB limit)

```javascript
import webpush from 'web-push';
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// Hebrew payload — UTF-8 encoded; check byte length, not character length.
const payload = JSON.stringify({
  title: 'משמרת חדשה שובצה',          // "New shift assigned"
  body: `שלום ${name}, שובצת למשמרת ${slot_name} בתאריך ${date_he}.`,
  url: 'https://apps.nesher.co/my-week',
  tag: `assignment-${assignment_id}`,   // dedup: replaces existing notif with same tag
});

if (Buffer.byteLength(payload, 'utf8') > 4096) {
  // Shorten — Hebrew is 2 bytes per char in UTF-8 for most letters; ~2000 chars max.
  // Strip body, keep title + url.
}

try {
  await webpush.sendNotification(subscription, payload, {
    TTL: 24 * 60 * 60,    // 24 hours; push service drops if not delivered
    urgency: 'normal',     // 'high' for swap-accepted etc.; 'normal' is default
    contentEncoding: 'aes128gcm',
  });
} catch (err) {
  if (err.statusCode === 410 || err.statusCode === 404) {
    // Gone — browser revoked the subscription. DELETE the row.
    await db('push_subscription').where({ endpoint: subscription.endpoint }).del();
  } else if (err.statusCode === 429) {
    // Rate-limited by the push service. Retry later (notification_log retry).
  } else {
    // Log; retry up to 3 times with backoff (PRD §7.11 SLA).
  }
}
```

**Hebrew payload size sanity check:** Hebrew characters are 2 bytes each in UTF-8 (the Hebrew block is U+0590-U+05FF, all in the 2-byte range). A 60-char Hebrew message is ~120 bytes, plus JSON envelope. 4 KB allows generous bodies; only a problem if you embed long URLs or base64 icons. **Don't embed icons in the payload** — use `icon: '/icons/notification.png'` in the service worker `showNotification` call instead (the SW fetches it from your origin).

### Service worker (`app/public/sw.js`)

```javascript
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const options = {
    body: data.body,
    icon: '/icons/notification.png',
    badge: '/icons/badge.png',
    tag: data.tag,
    dir: 'rtl',                       // Hebrew direction for the notification body
    lang: 'he',
    data: { url: data.url },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data.url;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((wins) => {
      const existing = wins.find((w) => w.url === url);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
```

`dir: 'rtl'` on the notification options is supported in Chrome 50+, Firefox 50+, Safari 16+. **Confidence: HIGH**.

### 410 Gone handling

Already in the send pattern above. The rule: `410` or `404` from the push service = browser revoked = delete the `push_subscription` row keyed on `endpoint`. Document for code review: this is correct behavior, not a bug. Web Push subscriptions have no TTL — the only way they're removed is via the explicit "Gone" signal.

---

## 7. Puppeteer — Hebrew PDF rendering, font setup

### Puppeteer version: `puppeteer@^23.x` (latest stable line as of 2026-05). It bundles a known-good Chromium build.

### Critical: Hebrew font installation

Out-of-the-box Chromium does NOT ship a Hebrew font on Debian/Ubuntu. Without one installed in the container, Puppeteer renders Hebrew as tofu boxes (□□□).

**Dockerfile additions** (HIGH confidence, [PDF non-Latin fonts guide](https://medium.com/@surasith_aof/generate-pdf-support-non-latin-fonts-with-puppeteer-d6ca6c982f1c)):

```dockerfile
# In the Lowdefy runtime stage (or a separate pdf-renderer service)
FROM node:22-bookworm

# Install Chromium dependencies + Hebrew + Arabic fonts + fontconfig
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

# Use the system Chromium, not Puppeteer's downloaded one
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**Why `fonts-noto-core`:** Noto fonts cover all Unicode scripts; the `core` package includes Hebrew, Arabic, Cyrillic, Greek, Latin. Smaller than `fonts-noto` (the full set). Alternative `fonts-noto-hebrew` exists but `fonts-noto-core` is safer since we may want Arabic emoji or Latin variants for English templates.

**Why `PUPPETEER_SKIP_DOWNLOAD=true`:** Puppeteer's bundled Chromium is ~280 MB and re-downloaded on each `pnpm install`. Using `apt-get install chromium` (Debian's chromium-browser package) means:
- Smaller image size.
- Apt manages the Chromium version (auto-security-patched).
- Same chromium-sandbox executable as Puppeteer expects.

### RTL rendering correctness

For Hebrew text shaping to be correct, the HTML must:
1. Declare `<html dir="rtl" lang="he">` (same rule as email).
2. Use a font that has Hebrew glyphs (Noto Sans Hebrew, Arial in Liberation, system Hebrew font — all installed by the above).
3. Use real Unicode Hebrew characters (NOT visual-order encoded; logical order is correct).

```html
<!-- pdf/schedule.html — rendered by Puppeteer -->
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 1cm; }
    body { font-family: 'Noto Sans Hebrew', 'Liberation Sans', sans-serif; }
    .calendar-grid { direction: rtl; }
    .ltr { unicode-bidi: embed; direction: ltr; }
  </style>
</head>
<body>
  <h1>לוח משמרות — שבוע <span class="ltr">{{ week_range }}</span></h1>
  ...
</body>
</html>
```

### Render call

```javascript
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
  preferCSSPageSize: true,
});
await browser.close();
return pdf;
```

**Why `--no-sandbox`:** Chromium's sandbox requires Linux user namespaces, which Docker can deny depending on host. We're inside Docker Desktop on Windows — `--no-sandbox` is acceptable because the container is the isolation boundary, not the in-process sandbox.

### Performance

A 30-day × 30-soldier schedule renders in ~1.5–2.5s on hpg5 (cold start ~5s for Chromium boot). Keep the browser instance alive between requests:

```javascript
// Reuse a singleton browser
let browser;
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({ ... });
  }
  return browser;
}
```

PRD §17 `PDF_RENDER_TIMEOUT_SECONDS` should default to 15s and be tunable.

### Where Puppeteer runs — sidecar vs. in-Lowdefy

**Lean: sidecar.** Reasons:
- Chromium adds ~280 MB to the Lowdefy image; doubles its size.
- A PDF render is a long-ish operation (~2s); keeping Lowdefy's request handlers free for hot UI traffic is healthier.
- Restarting Lowdefy because of a Chromium crash is a worse blast radius than restarting a tiny sidecar.

**Pattern:** Add `pdf-renderer` service in compose; tiny Node app exposes `POST /render` accepting `{ html, options }`, returns PDF bytes. Lowdefy's `/api/export/pdf/<run_id>` endpoint composes the HTML server-side, POSTs to `http://pdf-renderer:3000/render`, streams the response.

**Confidence: MEDIUM** — both architectures work; sidecar is the cleaner one but it's an open architectural decision. Flag for Foundations phase planning.

---

## 8. ECharts via `@lowdefy/blocks-echarts` — Hebrew RTL strategy (CRITICAL gotcha)

### The reality: ECharts has NO native RTL support

This is a significant correction to the PRD's leaning. Confirmed via [open ECharts issue #19609](https://github.com/apache/echarts/issues/19609) (RTL feature request, unresolved as of 2024-2026 ECharts releases). ECharts added Arabic *language strings* in v5.5.0, but the layout engine itself is left-to-right only:

- Bar chart X-axis: categories laid out left-to-right.
- Pie chart label connectors: positioned LTR.
- Legend: items laid out LTR.
- Tooltip: positioned to the right of the cursor.

Hebrew **labels** render correctly inside individual text elements (Chrome's bidi algorithm handles the characters), but the chart **layout** is LTR.

### Workaround strategy (MEDIUM confidence)

For the four chart views in PRD §7.13:

1. **Unit-level + Team-level "shift-slot distribution" bar charts** — accept LTR layout; Hebrew labels render correctly inside each bar. Add a Hebrew title in `text-align: right` outside the chart. Users will read the chart left-to-right; this is acceptable for distribution charts where order doesn't carry meaning.

2. **Per-soldier breakdown (pie/bar)** — pie has no directional issue (radial); for the bar use the same approach as above.

3. **Leaderboard horizontal bar chart** — order matters here. Two options:
   - **Option A (LEAN):** Reverse the data array so the longest bar is at the visual right (where RTL readers' eyes start). Set `yAxis.inverse: true` to stack from top.
   - **Option B:** Use the ASCII-bar leaderboard (already a v1 deliverable per PRD §7.13) as the primary, and render the ECharts bar chart small, alongside it, marked "accessibility-only" in the spec. This is consistent with PRD §7.13 "accessible bar chart" framing.

4. **Sparkline (per-month shift-count trend)** — sparklines benefit from RTL much less than full charts (no labels). Acceptable to leave LTR.

5. **Gantt-style team timeline** — biggest RTL pain. ECharts Gantt is community-built. Consider a custom block using `vis-timeline` instead, which has documented RTL support, OR skip Gantt in v1 (PRD v1 scope is acceptable without it; the team calendar is the higher-priority view).

### Recommendation

- **Keep `@lowdefy/blocks-echarts@5.3.0`** for v1. The cost-benefit of switching to AmCharts (commercial license for SaaS) or Highcharts (commercial license $$$) is not worth the small RTL polish gain.
- **Flag in PRD §15 Open Q2 closure:** ECharts is chosen; the limitation is documented. v1.1 reviews whether RTL pain warrants a chart-library swap or building a thin RTL-aware wrapper around ECharts.
- **Add to PITFALLS.md** — see that file's "Pitfall: ECharts RTL surprise".

### Lowdefy block syntax

`@lowdefy/blocks-echarts` is a "minimal wrapper" — you pass an ECharts config option object as the block's `options` property:

```yaml
- id: shift_distribution_chart
  type: EChart
  properties:
    options:
      tooltip: { trigger: 'axis' }
      xAxis:
        type: category
        data: ['בוקר', 'ערב', 'לילה']        # Hebrew labels — render correctly per character
      yAxis: { type: value }
      series:
        - type: bar
          data:
            _request: chart_data        # server-side request returning [10, 20, 15]
```

**Confidence: HIGH** on the block shape; **MEDIUM** on the long-term RTL strategy.

---

## 9. node-cron in a separate container

### Version: `node-cron@4.2.1`. **v4 is a major rewrite from v3** — the API consolidated `scheduled`/`runOnInit` away. Read [migrating from v3](https://nodecron.com/migrating-from-v3) before reading any stale tutorial.

### Pattern: cron triggers HTTP into Lowdefy with shared-secret auth

The cron container is a tiny Node app. It does ONE thing: at scheduled times, POST to `http://lowdefy:3000/api/internal/cron/<job_name>` with a shared secret. Lowdefy receives the request, authenticates the secret, runs the dispatcher logic, and replies with a JSON status.

```javascript
// cron/index.js
import cron from 'node-cron';

const LOWDEFY_URL = process.env.LOWDEFY_URL || 'http://lowdefy:3000';
const SECRET = process.env.CRON_SHARED_SECRET;
const TZ = process.env.TZ || 'Asia/Jerusalem';

async function trigger(jobName) {
  const start = Date.now();
  try {
    const res = await fetch(`${LOWDEFY_URL}/api/internal/cron/${jobName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ triggered_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    console.log(JSON.stringify({ job: jobName, status: 'ok', duration_ms: Date.now() - start }));
  } catch (err) {
    console.error(JSON.stringify({ job: jobName, status: 'error', error: err.message, duration_ms: Date.now() - start }));
    // Fire-and-forget Lowdefy notification for cron.failure via a separate endpoint (or accept the structured-log alerting path).
  }
}

const dailyHour = parseInt(process.env.CRON_DAILY_REPORT_HOUR || '7', 10);
const weeklyDow = parseInt(process.env.CRON_WEEKLY_DIGEST_DOW || '1', 10);   // 1 = Monday
const weeklyHour = parseInt(process.env.CRON_WEEKLY_DIGEST_HOUR || '8', 10);

cron.schedule(`0 ${dailyHour} * * *`, () => trigger('daily_report'), {
  name: 'daily_report',
  timezone: TZ,
  noOverlap: true,
});

cron.schedule(`0 ${weeklyHour} * * ${weeklyDow}`, () => trigger('weekly_digest'), {
  name: 'weekly_digest',
  timezone: TZ,
  noOverlap: true,
});

// 24h before window lock — runs every hour and lets Lowdefy filter
cron.schedule('0 * * * *', () => trigger('availability_lock_reminders'), {
  name: 'lock_reminders',
  timezone: TZ,
  noOverlap: true,
});

console.log(JSON.stringify({ status: 'cron started', timezone: TZ }));
```

`noOverlap: true` is the v4 native option for "if a previous run is still going, skip this trigger". Important for the daily report if Resend has a hiccup and the previous run is retrying.

### Dockerfile (cron/)

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
ENV TZ=Asia/Jerusalem
CMD ["node", "index.js"]
```

`TZ=Asia/Jerusalem` ensures the system clock-derived defaults match the user's expectations, but node-cron v4 respects the explicit `timezone` option anyway.

### Compose entry

```yaml
cron:
  build: ./cron
  container_name: shifty-cron
  environment:
    LOWDEFY_URL: http://lowdefy:3000
    CRON_SHARED_SECRET: ${CRON_SHARED_SECRET:?missing}
    CRON_DAILY_REPORT_HOUR: ${CRON_DAILY_REPORT_HOUR:-7}
    CRON_WEEKLY_DIGEST_DOW: ${CRON_WEEKLY_DIGEST_DOW:-1}
    CRON_WEEKLY_DIGEST_HOUR: ${CRON_WEEKLY_DIGEST_HOUR:-8}
    TZ: Asia/Jerusalem
  depends_on:
    lowdefy:
      condition: service_started
  restart: unless-stopped
```

### Lowdefy-side endpoint authentication

The `/api/internal/cron/<job_name>` endpoints on Lowdefy verify the bearer secret. Since Lowdefy doesn't expose arbitrary REST routes by default (`reference/10-deployment.md`), implement this as a custom plugin that registers Next.js API route handlers (PRD §11.1 endpoint catalog already documents these). The plugin's verification:

```javascript
const expected = process.env.CRON_SHARED_SECRET;
const actual = req.headers.authorization?.replace(/^Bearer /, '');
if (!actual || actual !== expected || actual.length !== expected.length) {
  return new Response('unauthorized', { status: 401 });
}
// Constant-time comparison for safety:
// import { timingSafeEqual } from 'node:crypto';
// if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return 401;
```

**Confidence: HIGH** on the node-cron v4 shape; **MEDIUM** on the Lowdefy custom-plugin-for-API-routes pattern (this needs a small spike during Foundations to confirm the exact plugin shape).

---

## 10. Lowdefy + Docker Compose runtime — the symlink blocker (RANKED FIXES)

### The blocker (already partially solved!)

CLAUDE.md "Open questions" lists: `docker compose build lowdefy` succeeds but Next.js SSR fails with `ERR_MODULE_NOT_FOUND` on hash-suffixed `@lowdefy/helpers-<hash>` packages.

**Discovery during research:** This is **already fixed in the current `app/Dockerfile`** (commit `b8afba1`). The user's CLAUDE.md and `.planning/PROJECT.md` describe it as an "active blocker", but the Lowdefy skill `reference/10-deployment.md` and the actual Dockerfile in the repo both reflect the working fix. **Verify on hpg5 with a fresh build before assuming it's broken.** If the runtime is currently failing, the symptoms have likely shifted to a different cause.

### Root cause (HIGH confidence)

After `lowdefy build`, the Next.js app under `.lowdefy/server/` has a `.next/node_modules/@lowdefy/*-<hash>/` tree of symlinks. Each symlink points "up five levels" via `../../../../..` into `.lowdefy/server/node_modules/.pnpm/...`. The relative path traversal **depends on the original directory layout being preserved**. If a Docker runtime stage `COPY`s only the contents of `.lowdefy/server/` into `/app/`, the `../../../../..` traversals leave the `/app/.next/...` directory and end up dangling at `/`, never finding `.lowdefy/server/node_modules/.pnpm/`.

### Ranked fixes

**Fix #1 (LEANING and ALREADY IMPLEMENTED): Preserve the `/build/.lowdefy/server` path.** Copy the whole `/build` tree across stages and set `WORKDIR /build/.lowdefy/server`. This keeps the relative `../../../../..` valid. **Confidence: HIGH** (this is what `app/Dockerfile` already does):

```dockerfile
FROM node:22-bookworm AS builder
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN npx lowdefy build
RUN cd .lowdefy/server && pnpm exec next build

FROM node:22-bookworm
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY --from=builder /build /build
WORKDIR /build/.lowdefy/server
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
```

This is the chosen fix. Pros: preserves the entire pnpm symlink graph. Cons: ships ~150 MB more than the standalone alternative.

**Fix #2 (fallback if #1 breaks): Set `LOWDEFY_BUILD_OUTPUT_STANDALONE=1` AND remove the outer lockfile so Next.js writes `standalone/` inside `.lowdefy/server/`.** The standalone-output mode bundles every required module file-by-file, no symlinks. The official Lowdefy Dockerfile uses this. The trap is Next.js's detection of multiple lockfiles — if a `pnpm-lock.yaml` exists both at the repo root and inside `.lowdefy/server/`, Next.js declares the workspace root at the outer one and emits standalone at the OUTER root, not `.lowdefy/server/standalone/`.

```dockerfile
# Builder stage
ENV LOWDEFY_BUILD_OUTPUT_STANDALONE=1
RUN rm -f pnpm-lock.yaml  # remove the OUTER lockfile so Next.js picks the inner
RUN npx lowdefy build      # this runs `next build` internally too

# Runtime stage
COPY --from=builder /build/.lowdefy/server/public ./public
COPY --from=builder /build/.lowdefy/server/.next/standalone ./
COPY --from=builder /build/.lowdefy/server/.next/static ./.next/static
CMD ["node", "server.js"]
```

Pros: smaller image (~60% less). Cons: harder to debug; the standalone bundling has occasional gaps when plugins use dynamic `require()`. **Confidence: MEDIUM** — works in principle, brittle in practice.

**Fix #3 (DON'T use): Node `--preserve-symlinks --preserve-symlinks-main`.** This was a CLAUDE.md guess. It tells Node to follow symlinks but use the symlink path (not the resolved real path) as the module identity. It doesn't help here — the symlinks are already followed correctly; the problem is they target a path that doesn't exist in the runtime stage. Skip this. **Confidence: HIGH** — this is a misdiagnosis.

### Other runtime gotchas (from `reference/10-deployment.md` "Troubleshooting")

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No version specified` at build | `version:` instead of `lowdefy:` in `lowdefy.yaml` | First line must be `lowdefy: 5.3.0` |
| `Block type "X" not defined` | Block belongs to a plugin not declared/installed | Add to `plugins:` AND `package.json` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 default policy | Pin `pnpm@9.15.5` via `corepack prepare` |
| `[next-auth][error][NO_SECRET]` | `NEXTAUTH_SECRET` not set | Add to `.env` |
| 401 on every request after login | `NEXTAUTH_URL` mismatch | Set to canonical public URL (`https://apps.nesher.co`) |
| Container starts, healthcheck fails | App taking >60s to boot | Bump `healthcheck.start_period` in `docker-compose.yml` |
| Inbound LAN traffic doesn't reach Lowdefy on hpg5 | WSL2 mirrored networking doesn't forward inbound LAN to WSL bindings | Use Docker Desktop (already in place — see CLAUDE.md "Why Docker Desktop") |
| `docker compose build` fails with `error getting credentials - A specified logon session does not exist` | SSH session is Windows logon type 3 (network); Docker Desktop credential helper requires interactive session | Wrap with PsExec to run inside session 1 — see CLAUDE.md "Why PsExec for SSH-side docker commands" |

### Pre-flight checklist before merging the Foundations phase

- [ ] `docker compose build lowdefy` succeeds via PsExec on hpg5.
- [ ] `docker compose up -d lowdefy` succeeds.
- [ ] `docker logs shifty-lowdefy --tail 50` shows "ready - started server" and no `ERR_MODULE_NOT_FOUND`.
- [ ] `curl -I http://hpg5:8080/` returns 200 (or 302 → /api/auth/signin if the home is protected).
- [ ] `curl -I https://apps.nesher.co/` from outside the LAN works (Cloudflare Tunnel passthrough).
- [ ] Healthcheck transitions to "healthy" within `start_period` (60s).

If any of these fail, treat as a release-blocking incident and triage against Fix #1 / Fix #2.

---

## Source priority and confidence summary

| Area | Source priority | Confidence |
|------|-----------------|------------|
| Lowdefy 5.3.0 current | npm registry (verified 2026-05-12), Lowdefy GitHub release notes 5.3.0 (2026-05-11) | HIGH |
| Lowdefy Docker symlink fix | Already implemented in `app/Dockerfile` + skill `reference/10-deployment.md` + commit `b8afba1` | HIGH |
| Multi-tenant patterns | Lowdefy docs (Context7 `/websites/lowdefy`) + project skill | HIGH on Layers 1–3, MEDIUM on Layer 4 plugin authoring |
| Auth.js KnexAdapter + EmailProvider | Lowdefy `reference/08-auth.md` + NextAuth EmailProvider docs | HIGH for shape, MEDIUM for Resend-SMTP detail |
| OR-Tools CP-SAT (9.15.6755) | PyPI release Jan 2026 + canonical examples in `examples/notebook/examples/shift_scheduling_sat.ipynb` and `nurses_sat.ipynb` | HIGH (versions + recipe patterns) |
| OR-Tools fairness variance | Standard literature, OR-Tools community recommendations | HIGH on range-minimization as substitute |
| WAHA 2026.4.x + NOWEB engine | GitHub releases page + WAHA 2026.3 blog | HIGH |
| WAHA HMAC + retries | Context7 `/devlikeapro/waha` docs | HIGH |
| Resend SDK 6.12.3 + webhooks | npm registry + Resend docs (Context7) | HIGH |
| Hebrew RTL email pattern | W3C i18n guidance + multiple email-marketing guides | HIGH |
| web-push 3.6.7 + 410 Gone | npm registry + web-push-libs/web-push docs | HIGH |
| node-cron 4.2.1 (v4 API) | npm registry + nodecron.com docs | HIGH |
| Puppeteer Hebrew fonts | Puppeteer Alpine troubleshooting + multiple PDF-non-Latin guides | HIGH |
| ECharts NO native RTL | Open ECharts GitHub issue #19609 (unresolved as of mid-2026) | HIGH (negative finding) |
| ECharts workaround strategy | Inferred from RTL design patterns; no canonical Hebrew + ECharts case study | MEDIUM |

---

## Open / followup spikes

These are NOT blockers but should be addressed during their phase:

1. **Foundations phase:** Confirm the Lowdefy custom-plugin shape for API routes (`/api/webhook/resend`, `/api/webhook/waha`, `/api/internal/cron/*`). Spike <2 hours.
2. **Foundations phase:** Decide Puppeteer sidecar vs. in-Lowdefy. Lean sidecar; confirm during phase plan.
3. **Solver phase:** Validate the <10s SLO with a realistic 30×30 test case before committing. If slow, try `linearization_level=2`, alternative search strategies, or hint-based warm starts.
4. **Notifications phase:** Spike the Auth.js EmailProvider + Resend SMTP combo before committing it; if it doesn't work cleanly, write a custom plugin that swaps to Resend HTTP for magic-link delivery.
5. **Dashboard phase:** Re-evaluate ECharts RTL pain in practice. If it's unacceptable, consider building a thin Lowdefy block wrapping `vis-timeline` or `Chart.js` (which both have RTL options).

---

## Sources

- [Lowdefy v5.3.0 release notes (GitHub)](https://github.com/lowdefy/lowdefy/releases) — Lowdefy 5.3.0 (2026-05-11)
- [Lowdefy docs (Context7 mirror)](https://docs.lowdefy.com/) — `_user`, `roles`, auth, deployment
- Lowdefy project skill — `C:\Projects\shifts manager\.claude\skills\lowdefy\reference\*.md` (in-repo, distilled from Context7 `/websites/lowdefy`)
- [PyPI: ortools](https://pypi.org/project/ortools/) — `9.15.6755` (2026-01-14), Python 3.9–3.14
- [OR-Tools nurse scheduling example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/nurses_sat.ipynb)
- [OR-Tools shift_scheduling_sat example](https://github.com/google/or-tools/blob/stable/examples/notebook/examples/shift_scheduling_sat.ipynb)
- [WAHA releases (GitHub)](https://github.com/devlikeapro/waha/releases) — `2026.4.3` (2026-05-07)
- [WAHA 2026.3 release blog](https://waha.devlike.pro/blog/waha-2026-3/) — NOWEB upgrades
- [Resend webhook verification docs](https://resend.com/docs/webhooks/verify-webhooks-requests) — Svix integration via `resend.webhooks.verify()`
- [Resend email.bounced webhook docs](https://resend.com/docs/webhooks/emails/bounced)
- [W3C i18n: structural markup and RTL text](https://www.w3.org/International/questions/qa-html-dir)
- [CodeTwo: RTL languages in HTML email](https://www.codetwo.com/kb/right-to-left-languages/)
- [web-push-libs/web-push GitHub README](https://github.com/web-push-libs/web-push) — v3.6.7
- [node-cron v3→v4 migration](https://nodecron.com/migrating-from-v3) — `4.2.1`
- [Puppeteer troubleshooting (Docker / Alpine)](https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md)
- [PDF non-Latin fonts with Puppeteer](https://medium.com/@surasith_aof/generate-pdf-support-non-latin-fonts-with-puppeteer-d6ca6c982f1c)
- [ECharts RTL feature request (issue #19609)](https://github.com/apache/echarts/issues/19609) — unresolved
- [@lowdefy/blocks-echarts (npm registry)](https://registry.npmjs.org/@lowdefy/blocks-echarts/latest) — 5.3.0 wraps echarts 6.0.0
