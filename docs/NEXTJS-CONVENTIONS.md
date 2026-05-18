# Shifty conventions — Next.js + Drizzle + Auth.js stack

Load-bearing conventions doc for the Shifty project's Next.js + Drizzle + Auth.js stack. Replaces the deleted `docs/BUDIBASE-CONVENTIONS.md`. Future Claude Code sessions planning Phase 03+ consume this doc.

## 1. Source-of-truth boundaries

- **Postgres schema** = source of truth for Shifty business data. Add a NEW numbered migration in `db/migrations/`; never edit a committed migration.
- **Drizzle schema (`src/db/schema.ts`)** mirrors Postgres. After adding a SQL migration, run `npx drizzle-kit introspect` to refresh the TS schema, then hand-edit if needed for relations/types. Drizzle is the TYPE source; SQL is the RUNTIME source — they must stay in sync, with SQL winning when they disagree.
- **App Router routes (`app/`)** are the UI source of truth. No screens stored in any external system (the load-bearing learning from the Budibase era).
- **Auth config (`src/lib/auth/`)** = NextAuth.js setup; session shape committed to repo; ported from `legacy/shifty-handlers/auth/` patterns.

## 2. Tenant isolation (release-blocking, see PRD §1)

Three layers, all mandatory:

- **Layer 1 — Session:** `session.user.shiftyTenantId` is the only acceptable source of tenant_id in any query path. NEVER accept tenant_id from request body, query string, or path param. Auth.js sets this via the `jwt` callback after looking it up from the `users` table.
- **Layer 2 — Typed helper:** `tenantScopedQuery(session, table)` — all data access goes through this. It returns a Drizzle query builder pre-filtered with `WHERE table.shifty_tenant_id = session.user.shiftyTenantId`. Direct `db.select().from(...)` calls without going through this helper are CI-failing.
- **Layer 5 — Postgres RLS:** re-activated post-pivot. Per-tenant role + `SET LOCAL app.current_tenant_id = '<uuid>'` in a per-request transaction. Backstop if Layer 1 or 2 fails.
- **CI gate:** static check (TBD location, modeled on the prior `tools/check-bb-queries.mjs`) — fails the build if any `db.select|insert|update|delete().from(...)` call exists outside `src/lib/tenant/`.

## 3. Drizzle conventions

- Schema in `src/db/schema.ts`; one export per table; relations colocated.
- Client in `src/db/client.ts`; exports `db` (the Drizzle instance) and `pool` (pg Pool). Per-request transactions get a separate `tx` argument; never share connections across requests.
- All tables include `tenant_id uuid NOT NULL` (matching the Postgres convention; called `shiftyTenantId` in app-level code/types to avoid collision with any future framework-level tenant field).
- `drizzle.config.ts` at repo root; `schema: "./src/db/schema.ts"`, `out: "./db/migrations"` (so Drizzle and SQL migrations live in the same directory — but new migrations are still raw SQL written by hand, applied via the `migrate` container).

## 4. Auth.js

- Provider: EmailProvider (magic link) via Resend (using `RESEND_API_KEY`).
- Adapter: Drizzle adapter against `users`, `accounts`, `sessions`, `verification_tokens` tables (to be added in next migration if not already in `db/migrations/`).
- Session strategy: database (NOT jwt) so revocation works.
- Custom session callback augments `session.user` with `shiftyTenantId` and `role` (from `users` row).
- Middleware (`middleware.ts` at app root) enforces auth on `app/(authed)/**` segments.
- Email templates: Hebrew default, English fallback; `legacy/shifty-handlers/auth/` has prior templates to port.

## 5. File layout

```
app/
  (authed)/
    layout.tsx          # auth wall + tenant context
    shifts/
    rules/
    swaps/
  (public)/
    login/
  api/
    auth/[...nextauth]/route.ts
src/
  db/
    schema.ts
    client.ts
  lib/
    auth/               # NextAuth config + callbacks
    tenant/             # tenantScopedQuery helper
    solver/             # client for FastAPI solver (Phase 04)
  components/
    ui/                 # shadcn — vendored, not npm dep
    shifts/
    rules/
docs/
  PRD.md
  NEXTJS-CONVENTIONS.md   # this file
db/migrations/            # SQL migrations, source of truth
legacy/shifty-handlers/   # Lowdefy-era logic — porting source
solver/                   # FastAPI + OR-Tools (Phase 04)
```

## 6. Hebrew RTL conventions

- `<html dir="rtl" lang="he">` default in `app/layout.tsx`.
- Per-element `dir="ltr"` for English-only fields (email inputs, code blocks).
- Tailwind logical-property classes (`ms-*`/`me-*`/`ps-*`/`pe-*`) — never `ml-*`/`mr-*`/`pl-*`/`pr-*`.
- `next-intl` (or similar) for translations; default locale `he`, fallback `en`.
- Dates: `DD/MM/YYYY` in `he`; `YYYY-MM-DD` in `en`. Asia/Jerusalem TZ everywhere.

## 7. Backup / DR

- Postgres dump unchanged: `docker compose exec postgres pg_dump -U shifts shifts > backup.sql`.
- No CouchDB, no MinIO, no Redis to back up post-pivot.
- Next.js app code is in git; image rebuilds reproduce state.

## 8. GSD plan shape (Next.js phases)

Each phase plan should specify:

- New routes (file paths under `app/`)
- New tables (SQL migration files)
- New `src/db/schema.ts` entries
- New `src/lib/` helpers
- shadcn components to copy in (`npx shadcn-ui add <component>`)
- Tenant-isolation test cases (negative + positive)
- Hebrew-RTL acceptance criteria

## 9. What survives the pivot, what's dead

**Survives:**

- All 14 SQL migrations in `db/migrations/`
- All business logic in `legacy/shifty-handlers/` (porting source)
- PRD.md spec (unchanged)
- GSD planning artifacts (`.planning/`)
- FastAPI solver design (Phase 04, not yet built)
- hpg5 deployment infra (Docker Compose, Cloudflare Tunnel, PsExec patterns)

**Dead (removed in pivot commit):**

- All `tools/budibase-*`
- `docs/BUDIBASE-CONVENTIONS.md`
- Budibase services in `docker-compose.yml`
- Budibase secrets in `.env.example`
- Phase 02 + Phase 03 W0/W1-01 Budibase-specific artifacts (kept in git history for reference; ROADMAP marks them archived)

## 10. Open items

- [ ] Layer-2 CI gate: re-create as a TS linter/checker against `src/lib/tenant/` boundary (replaces prior `tools/check-bb-queries.mjs`)
- [ ] Drizzle adapter migration for Auth.js tables (if not in db/migrations/ already)
- [ ] First Phase 03 W1 plan: Next.js scaffold + Auth.js + first authed route
