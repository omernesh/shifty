# Phase 03: Availability & Rules — Wave 1 Research

**Researched:** 2026-05-18
**Phase / Wave scope:** Phase 03, Wave 1 — **Next.js scaffold + Auth.js (Resend) + Drizzle + first authed route**
**Domain:** Web application framework bootstrapping, authentication, multi-tenant data access, Hebrew RTL UI baseline
**Confidence:** **HIGH** (load-bearing stack pieces are stable + recent docs verified; one MEDIUM area — Auth.js v5 still in beta — documented as a decision-point)

---

## Summary

Wave 1 stands up a fresh Next.js 15 App Router application at the repo root, wires Auth.js with the Resend EmailProvider against the existing `users` / `accounts` / `sessions` / `verification_tokens` tables already in the schema (migration 0002), connects Drizzle ORM to the existing 14-migration Postgres database (migrations stay raw SQL — Drizzle pulls a typed `schema.ts`), creates the `tenantScopedQuery()` helper that is the single Layer-2 enforcement boundary, replaces the deleted Budibase-era CI gate (`tools/check-bb-queries.mjs`) with an AST-based gate over `.ts`/`.tsx` files, re-activates Postgres Layer-5 RLS for the Next.js client by routing every authed request through a `withTenantTx()` Drizzle transaction that issues `SET LOCAL app.current_tenant = <uuid>` against the existing `shifty_app` role (migration 0013 already wired this), renders the Hebrew-RTL root layout, and ships a first authed route that proves the stack end-to-end with a real DB read.

The post-pivot opportunity is large: the Layer-5 RLS layer that was *inactive* during the Budibase era (Budibase connected as `shifts` superuser) becomes *actively enforced* the moment a Next.js connection hits Postgres as `shifty_app` — strictly stronger than the pre-pivot posture. The whole tenant-isolation contract collapses to "every domain-table read/write goes through `tenantScopedQuery()`, which runs inside `withTenantTx(session.user.shiftyTenantId, fn)` — both layers active in lock-step." The legacy `legacy/shifty-handlers/auth/` directory is an excellent porting source: the session-callback shape, the Knex-adapter table-name conventions, and the SET-LOCAL transaction wrapper all map cleanly onto Auth.js v5 + Drizzle.

**Primary recommendation:** Adopt the Next.js 15 (15.5.18, latest stable on the 15.x line) + Auth.js **v5 beta** + Drizzle ORM 0.45.2 + Tailwind v4 + shadcn/ui 4.7 + node-postgres 8.x stack, scaffold via `npx create-next-app@latest` with `--ts --tailwind --app --src-dir --import-alias "@/*"`, manually swap from `next-auth@beta` to a pinned beta version (5.0.0-beta.31), introspect Drizzle from the live DB with `drizzle-kit pull` (`casing: 'preserve'` to keep quoted PascalCase column names from Auth.js tables), wire the auth.config.ts / auth.ts split for edge-runtime middleware compatibility, and build the Layer-2 CI gate as a `ts-morph`-based static check over `src/**/*.{ts,tsx}` that fails when any `db.{select,insert,update,delete}().from(...)` call sits outside `src/lib/tenant/`.

---

<phase_requirements>
## Phase Requirements

W1 doesn't deliver any of Phase 03's SHFT-/AVAL-/RULE- requirements directly — it builds the substrate that W2–W4 will use. It DOES revalidate Phase 1 tenant + auth requirements on the new stack:

| ID | Description | Research Support |
|----|-------------|------------------|
| TEN-01..05 | Multi-tenant isolation at session/query/page/request layers + RLS | Section "Tenant Isolation Triple-Layer" — Auth.js session callback → `tenantScopedQuery()` → `withTenantTx()` → migration 0013 RLS |
| AUTH-01..07 | Magic-link auth, invite codes, session shape | Section "Auth.js v5 + Resend" — port from `legacy/shifty-handlers/auth/` |
| SEC-01..10 | Secrets in env, no client-side tenant_id, audit append-only, CSRF | Auth.js provides CSRF; Drizzle bound to `shifty_app` role for least-privilege |
| PERF-04 | Composite `(tenant_id, ...)` indexes | Already in schema (Phase 1); Drizzle `pull` will surface them |

Phase 03 SHFT/AVAL/RULE requirements are unlocked by W1 but not delivered until W2/W3/W4.
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Stack pivot is locked** — Budibase 3.38.4 is dead, replaced by Next.js 15 + shadcn/ui + Auth.js + Drizzle (PRD §1 amended 2026-05-18).
- **Postgres schema is source of truth** — never edit a committed migration; W1 introduces **zero schema changes**.
- **`tenantScopedQuery()` is the only sanctioned path for domain-table reads** — anything outside it must fail CI.
- **Secrets in `.env` on hpg5 only** — `.env.example` is committed; real `.env` is host-local. `${VAR:?missing}` fail-fast pattern in compose.
- **Hebrew RTL default**, English LTR alternative. Asia/Jerusalem TZ. DD/MM/YYYY (he), YYYY-MM-DD (en).
- **hpg5 is Windows 11 + Docker Desktop.** Any docker command that pulls from a registry must run through PsExec inside session 1. `docker compose up -d` against locally cached images works fine over SSH.
- **No CouchDB / MinIO / Redis / Builder UI** post-pivot — those volumes are wiped.
- **GSD workflow** — Wave 1 plans go through `/gsd-plan-phase` and `/gsd-execute-phase`; no direct edits.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link request page (`/login` form) | Frontend Server (RSC) | — | Form posts to API route; no client JS needed for first submit |
| Magic-link callback (token verification) | API (Auth.js handler) | Database | Auth.js Resend provider + DrizzleAdapter writes `verification_tokens` + `sessions` |
| Session cookie issuance | API (Auth.js handler) | Browser | HTTP-only secure cookie; database session strategy (revocable) |
| Route gate for `app/(authed)/**` | Frontend Server (middleware.ts) | — | Edge-runtime middleware reads session cookie, redirects to `/login` if absent |
| `session.user.shiftyTenantId` hydration | API (Auth.js session callback) | Database | Node runtime; one extra `app_user` lookup per request (database session strategy already costs a session row read) |
| Tenant-scoped data reads | API (Server Component / Server Action) | Database | `tenantScopedQuery(session, table)` wrapped in `withTenantTx(session, tx)` |
| Layer-5 RLS enforcement | Database | — | `shifty_app` role can't bypass RLS; `SET LOCAL app.current_tenant` per request |
| Hebrew RTL chrome | Frontend Server (root layout) | Browser | `<html dir="rtl" lang="he">`; Tailwind logical properties; shadcn `rtl:true` mode |
| Static assets | Next.js public/ + CDN-via-Cloudflare-Tunnel | — | `Image` from `next/image`; no CDN URL rewriting needed |
| First authed route (`/shifts` shell) | Frontend Server (RSC) | API + Database | Reads `shift_slot` via `tenantScopedQuery()` |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `15.5.18` | Web framework (App Router, RSC, Server Actions) | Latest stable 15.x line per PRD §1 lock. Next 16.2.6 is current but the user explicitly locked 15. [VERIFIED: npm view next time --json; published 2026-05-07] |
| `react` | `19.x` (caret pinned by next) | UI library | Next 15 bundles React 19 canary internally; declaring in `package.json` is for tooling compatibility. [CITED: nextjs.org/docs/app/getting-started/installation] |
| `react-dom` | `19.x` | DOM renderer for React | Same justification as `react`. |
| `typescript` | `^5.6.x` | Type system | Next 15 requires TS ≥ 5.1; the next-canonical CI matrix uses 5.6+. TypeScript 6.0.3 is on npm but not yet the install-default for create-next-app. [VERIFIED: npm view typescript version=6.0.3; nextjs.org docs cite 5.1 minimum] |
| `tailwindcss` | `^4.3.0` | Utility-first CSS | Tailwind v4 is current stable as of 2026-05; create-next-app `--yes` installs Tailwind by default. [VERIFIED: npm view tailwindcss version, published 2026-05-08] |
| `@tailwindcss/postcss` | `^4.3.0` | PostCSS plugin for Tailwind v4 | Tailwind v4 split out from the postcss config; required for v4 builds. |
| `pg` | `^8.16.3` | Postgres driver | Standard low-level Postgres driver for Node 20+; pool-aware; matches Drizzle's node-postgres setup. [VERIFIED: npm view pg version] |
| `@types/pg` | `^8.x` | Types for pg | Required for TypeScript. |
| `drizzle-orm` | `^0.45.2` | TypeScript ORM | Latest stable on the 0.x line. Drizzle 1.0.0-rc.2 exists but is not stable; sticking to 0.45 avoids early-adopter pain on a phase that has bigger fish to fry. [VERIFIED: npm view drizzle-orm version=0.45.2 published 2025-10-29] |
| `drizzle-kit` | `^0.31.10` | Drizzle CLI (`pull`, `generate`, `migrate`) | Drizzle's official tooling. Required for `drizzle-kit pull` (the introspect-from-existing-Postgres workflow). [VERIFIED: npm view drizzle-kit version] |
| `next-auth` | `5.0.0-beta.31` | Auth (Auth.js v5) | Auth.js v5 is still in beta (latest beta.31 published 2026-04-14) but it's the only version with first-class App Router support, the Resend provider, and the auth.config split for edge-runtime middleware. Stable Auth.js v4 (4.24.14) is also available and matches the legacy KnexAdapter shape we already ported. **Decision required from user — see Open Questions / Decision Points.** [VERIFIED: npm view next-auth version, dist-tags] |
| `@auth/drizzle-adapter` | `^1.11.2` | Adapter binding Auth.js → Drizzle tables | Stable 1.x release line; works with both Auth.js v5 beta and v4 (4.x has different shape but same import). [VERIFIED: npm view @auth/drizzle-adapter version=1.11.2 published 2026-04-14] |
| `resend` | `^6.12.3` | Resend SDK | Used by Auth.js `next-auth/providers/resend` AND directly by our outbound transactional emails. Same package used in the legacy plugin. [VERIFIED: npm view resend version=6.12.3] |
| `zod` | `^4.4.3` | Runtime input validation | Industry-standard schema validation for Server Action inputs. Auth.js v5 docs reference zod in examples. [VERIFIED: npm view zod version] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `shadcn` (CLI) | `^4.7.0` | Component generator | Run `npx shadcn@latest init`, then `npx shadcn@latest add button card form`. Components are vendored into `src/components/ui/` (no runtime dependency on the CLI). [VERIFIED: npm view shadcn version] |
| `@radix-ui/react-slot` | `^1.2.4` | Radix primitive for shadcn Button | Auto-installed by shadcn CLI when you `add button`. [VERIFIED] |
| `class-variance-authority` | `^0.7.1` | Variant helper for shadcn components | Auto-installed by shadcn CLI. [VERIFIED] |
| `clsx` | `^2.1.1` | Class-name concatenation | Bundled with shadcn `cn()` utility. [VERIFIED] |
| `tailwind-merge` | `^3.6.0` | Tailwind class deduplication | Bundled with shadcn `cn()` utility. [VERIFIED] |
| `lucide-react` | `^1.16.0` | Icon set (used by shadcn) | shadcn default icon library. [VERIFIED: npm view lucide-react version; note major-version jump from 0.x to 1.x happened in 2025] |
| `next-intl` | `^4.12.0` | i18n for App Router | Hebrew/English message catalogs. App-Router-native (vs `next-i18next` which is Pages-Router-era). [VERIFIED: npm view next-intl version] |
| `nodemailer` | `^8.0.7` | Transitive dep of next-auth Email provider | Only needed if we use the SMTP-style Email provider. The Resend provider does NOT require nodemailer — skip unless we add an SMTP fallback. [VERIFIED] |
| `ts-morph` | `^28.0.0` | TS AST library for the Layer-2 CI gate | Cleanest way to walk TypeScript ASTs and assert "no `db.select().from(...)` outside `src/lib/tenant/`." Alternative: hand-rolled regex (too brittle for template strings + qualified imports). [VERIFIED] |
| `eslint-config-next` | `^16.x` | ESLint preset shipped by Next | Auto-configured by create-next-app. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `next-auth@5.0.0-beta.31` | `next-auth@4.24.14` (stable) | **v4** is stable + matches legacy KnexAdapter shape (less porting risk); but v4 lacks Auth.js's edge-runtime split + the streamlined Resend provider import + universal `auth()` helper. v4 path forces us to write a custom Resend wrapper similar to `legacy/shifty-handlers/auth/providers.js`. **Recommendation: v5 beta** — the porting work to add custom Resend handling on v4 cancels out the "v4 is stable" win. |
| `drizzle-orm` | `kysely` | Kysely is also typed Postgres-first; Drizzle wins for the Auth.js ecosystem (official `@auth/drizzle-adapter`). |
| `drizzle-orm` | `prisma` | Prisma is heavier (own migration system would fight our raw-SQL migrations; no first-class Auth.js adapter for our existing column shape). |
| `pg` (node-postgres) | `postgres` (postgres.js) | Both work with Drizzle; pg is the longer-standing choice and the legacy Knex setup also used pg. Sticking to pg minimizes the unknowns. |
| `next-intl` | `next-i18next` | next-i18next is Pages-Router; we're App Router. |
| `ts-morph` Layer-2 gate | ESLint custom rule | A custom ESLint rule integrates better with editor feedback but is harder to write and debug than a ts-morph script. Defer ESLint rule to a v1.1 polish if the ts-morph script proves friction-ful. |
| `ts-morph` Layer-2 gate | Hand-rolled regex (legacy approach) | Regex worked for the Lowdefy YAML and Budibase SQL-string cases because the surface was small and well-shaped. TypeScript source is hostile to regex (template strings, qualified imports, dynamic `from(getTable())` patterns). Use ts-morph. |
| **`pnpm` vs `npm`** | either | Repo currently has zero lockfile in `package.json` (Lowdefy era used pnpm via Lowdefy's own server; the root `package.json` has no lockfile and uses `@playwright/test` only). **Recommend `pnpm`** for two reasons: (1) faster installs on hpg5's Windows Docker Desktop; (2) consistent with what legacy comments reference. But npm works equally well. **Decision-point for planner.** |

### Installation

The exact sequence (planner refines task-by-task):

```bash
# 1. Scaffold via Next CLI (with defaults: TS + Tailwind + App Router + src dir + alias)
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm

# 2. shadcn init + a couple of components for the first authed route
npx shadcn@latest init --rtl
npx shadcn@latest add button card form input label

# 3. Auth.js v5 + Drizzle adapter + Resend
pnpm add next-auth@beta @auth/drizzle-adapter resend zod

# 4. Drizzle + Postgres driver
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg

# 5. i18n + Layer-2 gate tooling
pnpm add next-intl
pnpm add -D ts-morph

# 6. Pull schema from existing Postgres
pnpm drizzle-kit pull
```

### Version verification

| Package | Latest stable | Published | Verified via |
|---------|--------------|-----------|--------------|
| `next` (15.x line) | 15.5.18 | 2026-05-07 | `npm view next time --json` |
| `next` (16.x line, not used) | 16.2.6 | 2026-05-07 | same |
| `next-auth` (v4 stable) | 4.24.14 | 2026-04-14 | same |
| `next-auth` (v5 beta) | 5.0.0-beta.31 | 2026-04-14 | same |
| `@auth/drizzle-adapter` | 1.11.2 | 2026-04-14 | same |
| `@auth/core` | 0.41.2 | 2026-04-14 | (transitive of next-auth) |
| `drizzle-orm` (stable) | 0.45.2 | 2025-10-29 | same |
| `drizzle-orm` (rc) | 1.0.0-rc.2 | 2026-05-05 | same |
| `drizzle-kit` | 0.31.10 | (latest) | `npm view drizzle-kit version` |
| `resend` | 6.12.3 | (latest) | same |
| `tailwindcss` | 4.3.0 | 2026-05-08 | same |
| `shadcn` (CLI) | 4.7.0 | 2026-05-05 | same |
| `zod` | 4.4.3 | (latest) | same |
| `pg` | 8.16.3 | (latest) | same |
| `ts-morph` | 28.0.0 | (latest) | same |

---

## Package Legitimacy Audit

slopcheck 0.6.1 was installed and run against all 23 candidate packages on 2026-05-18. **All packages cleared as `[OK]`** — zero `[SUS]` or `[SLOP]` flagged.

| Package | Registry | Age (approx) | Source repo | slopcheck | Disposition |
|---------|----------|--------------|-------------|-----------|-------------|
| `next` | npm | 10+ years | github.com/vercel/next.js | [OK] | Approved [VERIFIED: npm registry + Context7 official docs + slopcheck] |
| `next-auth` | npm | 7+ years | github.com/nextauthjs/next-auth | [OK] | Approved [VERIFIED] |
| `@auth/core` | npm | 2+ years | github.com/nextauthjs/next-auth | [OK] | Approved [VERIFIED] |
| `@auth/drizzle-adapter` | npm | 2+ years | github.com/nextauthjs/next-auth | [OK] | Approved [VERIFIED] |
| `drizzle-orm` | npm | 3+ years | github.com/drizzle-team/drizzle-orm | [OK] | Approved [VERIFIED] |
| `drizzle-kit` | npm | 3+ years | same | [OK] | Approved [VERIFIED] |
| `resend` | npm | 3+ years | github.com/resend/resend-node | [OK] | Approved [VERIFIED] |
| `pg` | npm | 14+ years | github.com/brianc/node-postgres | [OK] | Approved [VERIFIED] |
| `@types/pg` | npm | 10+ years | DefinitelyTyped | [OK] | Approved [VERIFIED] |
| `tailwindcss` | npm | 8+ years | github.com/tailwindlabs/tailwindcss | [OK] | Approved [VERIFIED] |
| `@tailwindcss/postcss` | npm | 1+ years | same | [OK] | Approved [VERIFIED] |
| `shadcn` | npm | 2+ years | github.com/shadcn-ui/ui | [OK] | Approved [VERIFIED] |
| `lucide-react` | npm | 4+ years | github.com/lucide-icons/lucide | [OK] | Approved [VERIFIED] |
| `@radix-ui/react-slot` | npm | 4+ years | github.com/radix-ui/primitives | [OK] | Approved [VERIFIED] |
| `class-variance-authority` | npm | 3+ years | github.com/joe-bell/cva | [OK] | Approved [VERIFIED] |
| `clsx` | npm | 7+ years | github.com/lukeed/clsx | [OK] | Approved [VERIFIED] |
| `tailwind-merge` | npm | 3+ years | github.com/dcastil/tailwind-merge | [OK] | Approved [VERIFIED] |
| `next-intl` | npm | 4+ years | github.com/amannn/next-intl | [OK] | Approved [VERIFIED] |
| `tailwindcss-rtl` | npm | (older plugin) | github.com/20lives/tailwindcss-rtl | [OK] | **NOT used** (shadcn CLI handles RTL natively, see RTL Strategy section) |
| `nodemailer` | npm | 14+ years | github.com/nodemailer/nodemailer | [OK] | **NOT used** in W1 (Resend provider doesn't need it; keep for SMTP fallback option) |
| `zod` | npm | 7+ years | github.com/colinhacks/zod | [OK] | Approved [VERIFIED] |
| `ts-morph` | npm | 8+ years | github.com/dsherret/ts-morph | [OK] | Approved [VERIFIED] |
| `eslint-config-next` | npm | (Next-bundled) | github.com/vercel/next.js | [OK] | Approved (auto-installed by create-next-app) [VERIFIED] |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Chromium / Safari, Hebrew-first viewport)                   │
│  - Cookie: __Secure-authjs.session-token                              │
│  - Form posts magic-link request to /api/auth/signin/resend           │
│  - Clicks magic link → callback URL with token query string           │
└────────────┬─────────────────────────────────────────┬───────────────┘
             │                                         │
             ▼ static + RSC HTML                       ▼ form POST
┌──────────────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnel → nginx → next-server on hpg5:3000                 │
│                                                                       │
│  middleware.ts (edge runtime, auth.config-only)                       │
│   • For /, /login → pass through                                      │
│   • For (authed)/* → if no valid session cookie → 302 to /login       │
│                                                                       │
│  app/(public)/login/page.tsx                                          │
│   • Server-rendered form posting to NextAuth signin route             │
│                                                                       │
│  app/api/auth/[...nextauth]/route.ts (Auth.js handlers)               │
│   • Resend provider sends magic link via resend SDK                   │
│   • DrizzleAdapter writes verification_tokens, users, sessions        │
│                                                                       │
│  app/(authed)/layout.tsx (Server Component)                           │
│   • Calls `auth()` → loads session + augments with shiftyTenantId     │
│   • Throws redirect('/login') if session.user.shiftyTenantId is null  │
│                                                                       │
│  app/(authed)/shifts/page.tsx (Server Component, first authed route)  │
│   • Calls `tenantScopedQuery(session, shiftSlot).limit(50)`           │
│   • Renders <ShiftList /> client component                            │
└────────────┬────────────────────────────────────┬────────────────────┘
             │                                    │
             ▼ pg.Pool                            ▼ resend HTTPS
┌──────────────────────────────────────┐  ┌──────────────────────────┐
│  Postgres 16 (shifts-postgres)        │  │  Resend API (transactional│
│  - Connect as `shifts` role           │  │  email; magic links + …  │
│    → default-role = `shifty_app`      │  │  later: notifications)   │
│    → NOSUPERUSER, NOBYPASSRLS         │  │                          │
│  - Each request:                      │  │                          │
│      BEGIN                            │  │                          │
│      SET LOCAL app.current_tenant=…   │  │                          │
│      …queries…                       │  │                          │
│      COMMIT                           │  │                          │
│  - 14 migrations applied              │  │                          │
└──────────────────────────────────────┘  └──────────────────────────┘
```

### Recommended Project Structure

```
.
├── app/                          # Next.js App Router
│   ├── layout.tsx                # <html dir="rtl" lang="he">, fonts
│   ├── page.tsx                  # Public landing (or redirect to /login)
│   ├── (public)/
│   │   ├── login/
│   │   │   ├── page.tsx          # Magic-link form
│   │   │   └── verify/page.tsx   # "Check your email" + signin/email
│   │   └── invite/
│   │       └── [code]/page.tsx   # Invite-code redemption form
│   ├── (authed)/
│   │   ├── layout.tsx            # Auth wall + tenant context provider
│   │   ├── page.tsx              # Default authed landing
│   │   └── shifts/
│   │       └── page.tsx          # First authed route (W1 ships this)
│   └── api/
│       └── auth/
│           └── [...nextauth]/
│               └── route.ts      # Auth.js handlers
├── src/
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema (drizzle-kit pull output)
│   │   ├── client.ts             # exports `pool` (pg.Pool) and `db` (drizzle)
│   │   └── relations.ts          # (optional) Drizzle relations
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── config.ts         # auth.config.ts — providers only (edge-safe)
│   │   │   ├── index.ts          # auth.ts — NextAuth() with DrizzleAdapter
│   │   │   ├── callbacks.ts      # session callback (port from legacy)
│   │   │   └── resend-email.ts   # buildInviteHtml/text (port from legacy)
│   │   ├── tenant/
│   │   │   ├── index.ts          # public exports
│   │   │   ├── tenantScopedQuery.ts  # the SINGLE Layer-2 boundary
│   │   │   └── withTenantTx.ts   # SET LOCAL transaction wrapper
│   │   └── i18n/
│   │       └── messages/
│   │           ├── he.json
│   │           └── en.json
│   └── components/
│       └── ui/                   # shadcn vendored components (button, card, …)
├── middleware.ts                 # Edge auth gate
├── auth.ts                       # re-export from src/lib/auth (Auth.js convention)
├── auth.config.ts                # re-export from src/lib/auth/config
├── drizzle.config.ts             # `pull`/`generate` config
├── next.config.ts                # output: 'standalone', headers, env
├── tsconfig.json                 # paths: { "@/*": ["./src/*"] }
├── components.json               # shadcn config, rtl: true
├── postcss.config.mjs            # @tailwindcss/postcss
├── tailwind.config.ts            # content paths, theme extensions
├── Dockerfile                    # multi-stage standalone
├── package.json
├── pnpm-lock.yaml
├── docker-compose.yml            # already exists; add nextjs-app service
├── db/migrations/                # already exists (14 SQL migrations)
└── legacy/shifty-handlers/       # porting source (unchanged)
```

### Pattern 1: Auth.js v5 split — edge-safe middleware + node-runtime full auth

**What:** Auth.js's database adapter cannot run on Vercel-style edge runtimes because it opens TCP sockets. Next.js middleware always runs on edge runtime. The official solution is to split the config: `auth.config.ts` declares providers and edge-safe callbacks; `auth.ts` extends it with the adapter and database-strategy bits; `middleware.ts` imports only `auth.config.ts`.

**When to use:** Always, when using NextAuth 5 with a database adapter. (For our hpg5 self-host this isn't strictly necessary because we don't run on Vercel Edge — Next.js docker `next start` runs everything in Node — but the split is the recommended pattern and keeps the option open for future edge moves.)

**Example:**
```typescript
// src/lib/auth/config.ts
import type { NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';

export default {
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.RESEND_FROM_EMAIL!,
      // sendVerificationRequest overridden in auth.ts to inject Hebrew template
    }),
  ],
  pages: {
    signIn: '/login',
    verifyRequest: '/login/verify',
  },
} satisfies NextAuthConfig;

// src/lib/auth/index.ts
import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/db/client';
import { users, accounts, sessions, verificationTokens } from '@/db/schema';
import authConfig from './config';
import { shiftySessionCallback } from './callbacks';
import { buildInviteHtml, buildInviteText } from './resend-email';
import { Resend } from 'resend';

const resendClient = new Resend(process.env.AUTH_RESEND_KEY);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  callbacks: {
    session: shiftySessionCallback,
  },
  providers: authConfig.providers.map((p) => {
    if (p.id !== 'resend') return p;
    // Override sendVerificationRequest for Hebrew template
    return {
      ...p,
      async sendVerificationRequest({ identifier, url }) {
        const html = buildInviteHtml({ inviteUrl: url, locale: 'he' });
        const text = buildInviteText({ inviteUrl: url, locale: 'he' });
        await resendClient.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: [identifier],
          subject: 'הזמנה לשיפטי',
          html,
          text,
        });
      },
    };
  }),
});

// middleware.ts
import NextAuth from 'next-auth';
import authConfig from '@/lib/auth/config';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Match everything except static/internal/api routes
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

**Source:** [authjs.dev/guides/edge-compatibility](https://authjs.dev/guides/edge-compatibility) — confirmed split pattern; [authjs.dev/getting-started/providers/resend](https://authjs.dev/getting-started/providers/resend) — confirmed Resend provider + `sendVerificationRequest` override hook.

### Pattern 2: Tenant-scoped Drizzle query via per-request transaction (Layer 2 + Layer 5)

**What:** Every domain-table read/write opens a Drizzle transaction, issues `SET LOCAL app.current_tenant = <session-uuid>`, then runs the actual query. Migration 0013 already wired `shifty_app` (NOSUPERUSER, NOBYPASSRLS) as the default role for `shifts` connections; this transaction wrapper completes the Layer-5 contract.

**When to use:** Every time. The only files allowed to call `db.select()/insert()/update()/delete()` directly are inside `src/lib/tenant/` (which exports `tenantScopedQuery()`); the CI gate fails the build otherwise.

**Example:**
```typescript
// src/lib/tenant/withTenantTx.ts
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { PgTransaction } from 'drizzle-orm/pg-core';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function withTenantTx<T>(
  tenantId: string,
  fn: (tx: PgTransaction<any, any, any>) => Promise<T>
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new Error('withTenantTx: tenant_id missing or invalid — request rejected (Layer-5 guard)');
  }
  return db.transaction(async (tx) => {
    // SET LOCAL persists only for this transaction; reverts to the sentinel
    // 00000000-0000-0000-0000-000000000000 (ALTER ROLE default from migration 0013)
    // when the transaction commits or rolls back.
    await tx.execute(sql`SET LOCAL app.current_tenant = ${sql.raw(`'${tenantId}'`)}`);
    return fn(tx);
  });
}

// src/lib/tenant/tenantScopedQuery.ts
import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { withTenantTx } from './withTenantTx';
// Re-export Drizzle's typed query builders, but bound to the tenant.

export function tenantScopedQuery<T extends { tenantId: any }>(
  session: Session,
  fn: (tx: any) => Promise<T[]>
): Promise<T[]> {
  const tenantId = session.user.shiftyTenantId;
  if (!tenantId) throw new Error('tenantScopedQuery: session has no shiftyTenantId');
  return withTenantTx(tenantId, fn);
}

// Call site (in app/(authed)/shifts/page.tsx):
import { tenantScopedQuery } from '@/lib/tenant/tenantScopedQuery';
import { shiftSlot } from '@/db/schema';
import { auth } from '@/lib/auth';

export default async function ShiftsPage() {
  const session = await auth();
  if (!session) return null; // (authed) layout should already gate this
  const slots = await tenantScopedQuery(session, (tx) =>
    tx.select().from(shiftSlot).limit(50)
  );
  return <ShiftList slots={slots} />;
}
```

**Source:** [orm.drizzle.team/docs/rls](https://orm.drizzle.team/docs/rls) — confirmed the per-transaction `set_config` / `set local` pattern; [legacy/shifty-handlers/hooks/with-tenant-tx.js](file://./legacy/shifty-handlers/hooks/with-tenant-tx.js) — our own previous implementation of this exact pattern under Knex (proven in production).

### Pattern 3: Hebrew RTL via shadcn's native `rtl: true` mode

**What:** shadcn v4 ships first-class RTL support — when you initialize with `rtl: true` in `components.json`, the CLI auto-transforms physical positioning classes (`left-*`, `right-*`, `pl-*`, `pr-*`) into logical ones (`start-*`, `end-*`, `ps-*`, `pe-*`) at component-add time. You then set `<html dir="rtl" lang="he">` on the root layout and add the `direction` provider.

**When to use:** From day one. RTL-by-default is cheaper to maintain than retrofitting RTL.

**Example:**
```typescript
// app/layout.tsx
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html dir="rtl" lang="he">
      <body className="font-hebrew antialiased">
        {children}
      </body>
    </html>
  );
}

// components.json (created by `npx shadcn@latest init --rtl`)
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "tailwind.config.ts", "css": "src/app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" },
  "rtl": true
}
```

**Note from shadcn RTL docs:** three components — Calendar, Pagination, Sidebar — need manual RTL adaptation. None of those land in W1 (W1 only uses Button, Card, Form, Input, Label).

**Source:** [ui.shadcn.com/docs/rtl](https://ui.shadcn.com/docs/rtl) — confirmed `rtl: true` config flag + CLI auto-transform behavior.

### Pattern 4: Drizzle introspect-from-existing-Postgres workflow

**What:** Our 14 SQL migrations already exist and are authoritative. Drizzle's `drizzle-kit pull` reverse-engineers them into a typed `src/db/schema.ts`. The output file becomes the TypeScript type source; the SQL files remain the runtime source. They must stay in sync (re-run `pull` after every new migration).

**When to use:** Once during W1 scaffold (initial introspection); thereafter whenever a new migration adds tables or columns.

**Example:**
```typescript
// drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './db/migrations',     // existing migration dir; pull writes alongside
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  introspect: {
    casing: 'preserve',         // KEEP "userId" as "userId", not "user_id"
                                // — required so Auth.js's quoted-identifier
                                // columns match the adapter's expectations
  },
  // Skip pulling raw Auth.js-only views; pull all tables by default
});
```

Then:
```bash
DATABASE_URL='postgres://shifts:…@localhost:5432/shifts' \
  pnpm drizzle-kit pull
```

**Critical:** The Auth.js tables use quoted PascalCase columns (`"userId"`, `"sessionToken"`, `"emailVerified"`, `"providerAccountId"`) — see migration 0002 lines 119–148. `casing: 'preserve'` is mandatory; the default `'camel'` would silently rewrite them and break the adapter contract.

**Source:** [orm.drizzle.team/docs/drizzle-kit-pull](https://orm.drizzle.team/docs/drizzle-kit-pull) — confirmed `casing` config option and behavior with quoted identifiers.

### Pattern 5: Session callback that hydrates `shiftyTenantId` from `app_user`

**What:** Database session strategy gives the session callback the canonical user row from the `users` (Auth.js) table. We then look up `app_user` by email to find which tenant they belong to and augment the session object.

**Why this shape:** The legacy `legacy/shifty-handlers/auth/callbacks.js` solves this exact problem with a chicken-and-egg: the session callback needs to know `tenant_id` *before* RLS context can be set, but it can't query `app_user` because RLS would block it. The legacy solution: bypass RLS for this one narrow lookup. We carry the same idiom forward.

**Why we don't have the chicken-and-egg problem in this version:** Two layers of defense. (a) The session callback runs ONCE per request (database strategy makes one session lookup; we add one app_user lookup). (b) We bypass RLS for this lookup by running the callback against a connection that has NOT yet issued `SET LOCAL app.current_tenant` — `shifty_app` blocks every tenant row by default. We need ONE narrow exemption: an unscoped query on `app_user.email` (a unique column across tenants per migration 0002 `UNIQUE (tenant_id, email)`).

**Cleanest implementation:** A separate pg connection (NOT through Drizzle's main `db`) that uses a stored function with `SECURITY DEFINER`, mirroring how migration 0009 already does this for `lookup_invite_code`. Add a new migration in W2 if needed; for W1, the simplest path is the same SET ROLE NONE bypass the legacy callback used (only requires bootstrap SUPERUSER access, which is the `migrator` role — but we don't want app connections having that).

**Best W1 approach (do not add a migration):** the session callback issues an unscoped query against `app_user` via a Drizzle transaction that does NOT set tenant_id. Because `app_user` has RLS and `shifty_app` cannot bypass it, the query returns 0 rows. **This fails.** Therefore:

- Option A: Add an `app_user` row whose `email` matches the Auth.js `users.email` AT signup time (during `events.createUser`) — so by the time session callback runs, we already know the tenant from the user row's `app_user.tenant_id` linked column. Requires careful handling of multi-tenant emails.
- Option B: Add a `users.shiftyTenantId` column in a W1 migration (smallest schema change) populated at user-creation time from invite-code redemption. Session callback reads it directly from the Auth.js `users` row (which is NOT RLS-protected per migration 0009 lines 8–11). **Cleanest, minimal schema change.**
- Option C: SECURITY DEFINER function `lookup_user_tenant(email)` added in a W1 migration. Same pattern as `lookup_invite_code`.

**Recommendation: Option B.** Justification: (a) The Auth.js `users` table is NOT RLS-protected (deliberate, migration 0009 §RLS Architecture Notes lines 8–11) — adding a tenant FK is consistent with its already-tenant-crossing role. (b) Eliminates the chicken-and-egg without bypass code. (c) One additional migration vs. (Option A) coupling with the signup flow which is itself W2-W3 work.

**Decision-point for planner / discuss-phase user input.**

```typescript
// src/lib/auth/callbacks.ts
import type { Session, User } from 'next-auth';

export async function shiftySessionCallback({
  session,
  user, // database strategy gives us the users row directly
}: {
  session: Session;
  user: User & { shiftyTenantId?: string | null; locale?: string | null };
}): Promise<Session> {
  session.user = {
    ...session.user,
    shiftyTenantId: user.shiftyTenantId ?? null,
    locale: user.locale ?? 'he',
  };
  return session;
}
```

Add to `src/types/next-auth.d.ts` (TypeScript module augmentation):
```typescript
import 'next-auth';
declare module 'next-auth' {
  interface Session {
    user: { id: string; email: string; shiftyTenantId: string | null; locale: 'he' | 'en' };
  }
  interface User {
    shiftyTenantId?: string | null;
    locale?: 'he' | 'en' | null;
  }
}
```

**Source:** [authjs.dev/reference/nextjs#callbacks](https://authjs.dev/reference/nextjs#callbacks); [legacy/shifty-handlers/auth/callbacks.js](file://./legacy/shifty-handlers/auth/callbacks.js).

### Anti-Patterns to Avoid

- **`SET app.current_tenant`** (without LOCAL) — pool reuse leaks tenant context to the next request. Migration 0013 already uses LOCAL; legacy code already uses LOCAL; do not regress.
- **`db.select().from(domainTable)` outside `src/lib/tenant/`** — bypasses Layer 2 and (if not wrapped in `withTenantTx`) also Layer 5. CI gate fails the build.
- **JWT session strategy** — PRD §8.2 says session tokens in HTTP-only cookies, and §8.3 says session has tenant_id. JWT works but breaks "sign out everywhere" / session revocation; with database strategy we get revocation free. The legacy code used database strategy; carry it forward.
- **Connection-pool-aware `set` outside transactions** — even though migration 0013 sets a default tenant sentinel per connection, the production-correct path is `SET LOCAL` inside a transaction every time.
- **`casing: 'camel'` in drizzle.config.ts** — silently rewrites Auth.js quoted columns; adapter then can't find them.
- **Storing the raw Resend API key in the repo or in `next.config.ts` `env`** — must be `.env` on hpg5 only; reference via `process.env.AUTH_RESEND_KEY` at runtime.
- **Allowing `<html dir="ltr">` on the root layout** — every Hebrew label renders mirrored. The RTL default is the cheapest thing to get right on day one.
- **Hand-rolling RTL by using `ml-*`/`mr-*`/`pl-*`/`pr-*` after shadcn init** — defeats the auto-transform; force `ms-*`/`me-*`/`ps-*`/`pe-*` (and let shadcn handle component-generated classes).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Magic-link auth | Custom `verification_tokens` insert + hash + URL builder | Auth.js v5 Resend provider | Auth.js already implements: token hashing (sha256 of token + secret), expiry checks, single-use token deletion, CSRF for callback POST, secure-cookie issuance. The legacy code went deep into this; v5 has it native. |
| Session cookie management | Hand-issued JWT or signed cookie | Auth.js cookie writer | HTTP-only + Secure + SameSite=Lax + `__Secure-` prefix handling for https — already correct in Auth.js. |
| Postgres connection pooling | Per-request `new Pool()` | Single `pg.Pool` in `src/db/client.ts`, drizzle on top | Cold pool churn destroys p95; one pool per process is the correct shape. |
| Layer-2 CI gate | regex over `.ts` files | `ts-morph` AST walk | TypeScript surface is hostile to regex (template strings, qualified imports, dynamic `from(getTable())` patterns). |
| Hebrew RTL component CSS | hand-port physical classes to logical classes | `shadcn init --rtl` (CLI auto-transforms) | shadcn does this at component-add time, every time. Zero manual diff. |
| Drizzle schema from existing DB | Hand-write `pgTable(...)` declarations for 30+ tables | `drizzle-kit pull` | One command vs. ~600 lines of error-prone hand-translation. |
| HTML email Hebrew rendering | Inline-styled `<table>` layouts from scratch | Reuse `legacy/shifty-handlers/dispatch/resend.js` `buildInviteHtml`/`buildInviteText` | Already RTL-correct + plaintext-RLM-prefix-correct + tested in production. |
| Server-action input validation | Hand-rolled `if (!body.x) throw` | `zod` schema with `safeParse` | Validation + type narrowing in one pass. Already standard in Next.js docs. |
| Per-environment `.env` loading | Custom dotenv at app startup | Next's built-in `.env` / `.env.local` loading | Next already does dotenv loading; just put values in `.env`. |
| Postgres role split | Per-request `SET ROLE` | Migration 0013's `ALTER ROLE shifts SET role = shifty_app` | Already done. App connections auto-assume `shifty_app` at TCP handshake. |

**Key insight:** This wave's job is *plumbing* — connecting standard libraries that exist for exactly these problems. The Lowdefy-era investment in `legacy/shifty-handlers/` proves we've already burned the lessons. The pivot makes the libraries' canonical patterns *easier* to use, not harder; resist the urge to recreate any of them.

---

## Runtime State Inventory

> Wave 1 is greenfield-on-existing-database. The "runtime state" sweep is therefore lightweight — most categories are empty because the Budibase-era state was already wiped at pivot time. The one nuance: the existing `shifts-postgres` volume on hpg5 still has the 14 migrations applied with `app.current_tenant` defaulting to the sentinel for the `shifts` role per migration 0013.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Postgres `shifts-postgres` volume contains: the 14-migration schema, zero domain rows (Phase 02 production data was preserved but a fresh test DB is empty), Auth.js tables empty. `tenant`, `org_unit`, `app_user`, `users`, `soldier`, etc. all empty in the dev DB. | None — fresh DB is the design |
| Live service config | Cloudflare Tunnel routes `apps.nesher.co → http://192.168.1.133:8080`. Post-pivot the Next.js app will listen on `:3000` not `:8080`. **Decision-point for planner:** map nginx/proxy on 8080 → 3000, OR change Cloudflare Tunnel to point at 3000, OR have Next.js listen on 8080 directly. Tunnel config lives in a separate Windows user account out-of-scope for our SSH ops. | Document choice; tunnel update may need user's manual action (CLAUDE.md says tunnel is "separate Windows user, out of scope for SSH ops") |
| OS-registered state | Windows Task Scheduler tasks for Postgres backup (per PRD §8.8) — unaffected. No other Shifty-specific OS state from Lowdefy or Budibase eras (those volumes were `docker compose down -v`'d). | None |
| Secrets / env vars | `.env` on hpg5: `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (per `.env.example`). Old Budibase secrets (`COUCH_DB_*`, `MINIO_*`, `REDIS_PASSWORD`, `BUDIBASE_API_KEY`, `JWT_SECRET`, `API_ENCRYPTION_KEY`, `INTERNAL_API_KEY`) are stale — can be removed from hpg5 `.env`. The Auth.js v5 convention is `AUTH_SECRET` and `AUTH_RESEND_KEY` (vs Auth.js v4's `NEXTAUTH_SECRET` + custom `RESEND_API_KEY`). | (a) Remove stale Budibase secrets from hpg5 `.env`. (b) **Decision-point:** rename `NEXTAUTH_SECRET` → `AUTH_SECRET` and `RESEND_API_KEY` → `AUTH_RESEND_KEY` (Auth.js v5 convention) OR keep current names and reference them explicitly in `next-auth` config. Recommend rename — convention wins. |
| Build artifacts | Repo root has no `node_modules/`, no `.next/`, no `pnpm-lock.yaml`. The `package.json` is the Lowdefy-era root tooling pinger (`@playwright/test`, `pg`). | W1 Task 1 replaces `package.json` wholesale via `create-next-app` (will preserve existing scripts like `test:e2e` after merge) |

**Phase 02-era runtime state on hpg5 NOT in scope for W1:** the `budibase-couchdb-data`, `budibase-redis`, `budibase-minio-data`, `budibase-app-data` volumes were dropped at pivot time per ADR §"Next steps" point 2. If those weren't actually dropped, that's a separate W1-Task-0 hpg5 cleanup task (see Open Questions).

---

## Tenant Isolation Triple-Layer (the core W1 contract)

This section is load-bearing for the planner. Every W1 task must align with these layer contracts.

### Layer 1 — Session

- **Source of tenant_id:** `session.user.shiftyTenantId` returned by the Auth.js session callback.
- **Where it comes from:** Set on the Auth.js `users` row at user-creation time (Option B from Pattern 5).
- **Where it CANNOT come from:** request body, query string, path param, header, client-side state, cookie other than the session cookie. CI gate inspects this.
- **What if it's NULL?** The (authed) layout redirects to `/login` (or an invite-code redemption page). A NULL `shiftyTenantId` means the user signed in but hasn't redeemed an invite — they have no tenant yet. (This is a real state, handled in W2-W3, but W1's authed-route gate must check for it.)

### Layer 2 — Typed helper

- **The function:** `tenantScopedQuery(session, fn)` in `src/lib/tenant/tenantScopedQuery.ts`.
- **What it does:** unwraps `session.user.shiftyTenantId`, wraps `fn` in `withTenantTx`, returns the Drizzle query result.
- **What's allowed inside `src/lib/tenant/`:** raw `db.select()/insert()/update()/delete()`, raw `tx.execute(sql\`…\`)`, raw `pool.query(...)`.
- **What's allowed outside `src/lib/tenant/`:** ONLY calls to `tenantScopedQuery()` or to query helpers re-exported from `src/lib/tenant/` (one helper per table is fine, e.g., `findShiftSlotsByTeam(session, teamId)`).
- **The CI gate:** `tools/check-tenant-isolation.ts`, a ts-morph script. Walks every `.ts` / `.tsx` file under `app/` and `src/` (excluding `src/lib/tenant/`); for each `CallExpression`, checks whether the callee chain references any of `{ select, insert, update, delete }` on a `db`-like identifier. Fails build with `Layer 2 violation in src/foo/bar.ts:42`.

### Layer 5 — Postgres RLS

- **Mechanism:** Already wired by migration 0013. `shifts` connections auto-assume `shifty_app` (NOSUPERUSER, NOBYPASSRLS). Every domain table has `tenant_isolation` policy (migration 0009).
- **Per-request activation:** `withTenantTx(tenantId, fn)` opens a Drizzle transaction, issues `SET LOCAL app.current_tenant = '<uuid>'`, runs the user's callback. On commit/rollback the value reverts to the sentinel `00000000-0000-0000-0000-000000000000` per migration 0013 line 87.
- **Bypass paths to know about:**
  - The `migrator` role bypasses RLS — used only for migrations (one-shot compose service). NOT accessible to the app at runtime.
  - The `shifts` SUPERUSER (bootstrap) can bypass via `RESET ROLE`; only test fixtures use this.
  - SECURITY DEFINER functions (e.g., `lookup_invite_code` from migration 0009; possibly a new `lookup_user_tenant` if we go that route in W1).
- **Pitfall:** if `withTenantTx` is bypassed (e.g., a raw `pool.query` outside a transaction), the connection's `app.current_tenant` falls back to the per-role default — which is the sentinel UUID. Queries return zero rows. This is the secure-by-default failure mode; it manifests as "page renders empty list" rather than "tenant leak."

### The contract in one sentence

**Every `db.X.from(table)` in our codebase MUST be inside `withTenantTx(session.user.shiftyTenantId, ...)`. Layer 2 (CI gate) prevents direct calls; Layer 5 (RLS + role split) makes any bypass return zero rows.**

---

## Resend + Auth.js EmailProvider notes

- **Auth.js v5 has a dedicated Resend provider** at `next-auth/providers/resend`. It accepts `apiKey` and `from`. The default body is a plain template; we override via `sendVerificationRequest({ identifier, url, provider })` to inject the Hebrew RTL template from `legacy/shifty-handlers/dispatch/resend.js` (`buildInviteHtml`/`buildInviteText`).
- **The env var naming:** Auth.js v5 conventionally picks `AUTH_RESEND_KEY` from environment automatically. The legacy code used `RESEND_API_KEY`. **Recommendation: rename to `AUTH_RESEND_KEY` in `.env` and `.env.example`** — Auth.js will auto-detect; we don't need to pass `apiKey` explicitly. (Same energy as `AUTH_SECRET` vs `NEXTAUTH_SECRET`.)
- **`RESEND_FROM_EMAIL`:** Auth.js does NOT auto-detect a "from" env var; we must specify `from: process.env.AUTH_RESEND_FROM!` (a manual env var) OR pass it via the provider config literal.
- **Resend domain verification:** the `from` address must be on a Resend-verified domain. PRD/CLAUDE.md references `shifty@nesher.co`. Confirm with user during plan-phase whether nesher.co is Resend-verified or if we use Resend's `onboarding@resend.dev` for dev and switch later.
- **Sandbox mode for local dev:** Resend's onboarding sandbox lets you send to your own verified email only (free tier). For W1 + W2 development, use the onboarding domain + the user's email; production switches to `shifty@nesher.co`.
- **Rate limits:** Resend free tier ~2 req/s — already handled in legacy `bulkDispatchWithBackoff`; W1 only sends single magic-link emails (well within rate limit).

---

## Docker / hpg5 deployment

### Recommended Dockerfile pattern (multi-stage standalone)

```dockerfile
# syntax=docker/dockerfile:1.7
# Use slim (glibc) — Alpine has shown issues with sharp + pg native bindings.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable && pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
# Standalone output is the minimal runtime tree
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

**Key points:**
- `node:22-bookworm-slim` (glibc) — Alpine + native modules (`pg`, `sharp`) is a common failure mode. The official Next.js docker example also uses slim. Final image ~250-300MB.
- Multi-stage with BuildKit cache mount for pnpm store — saves rebuild time on hpg5.
- `output: 'standalone'` in `next.config.ts` makes `.next/standalone/` self-contained (no node_modules needed at runtime).
- Run as non-root `nextjs` user.
- Internal port 3000 — proxied to host via compose.

### `next.config.ts`

```typescript
import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',          // smaller docker images
  reactStrictMode: true,
  experimental: {
    // Server Actions are stable in 15.x; no flag needed
  },
};
export default config;
```

### Docker Compose service addition

```yaml
  nextjs-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: shifty-nextjs
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: ${DATABASE_URL:?missing}
      AUTH_SECRET: ${AUTH_SECRET:?missing}
      NEXTAUTH_URL: ${NEXTAUTH_URL:?missing}
      AUTH_RESEND_KEY: ${AUTH_RESEND_KEY:?missing}
      AUTH_RESEND_FROM: ${AUTH_RESEND_FROM:?missing}
      NODE_ENV: production
    ports:
      - "8080:3000"     # host 8080 → container 3000; matches existing Cloudflare Tunnel mapping
    restart: unless-stopped
```

### Build caveat: registry pulls on hpg5

Per CLAUDE.md: `docker compose build` on hpg5 needs PsExec because Docker Desktop's credential helper requires an interactive session for any registry pull. The first build pulls `node:22-bookworm-slim` from Docker Hub — that's a registry pull → wrap with PsExec.

After the first build, subsequent rebuilds (after `git pull`) of just the app layer don't re-pull the base image; plain SSH `docker compose build nextjs-app` works.

**W1 plan implication:** Document the first-deploy procedure explicitly (PsExec wrap). After that, `git pull && docker compose up -d --build` works over plain SSH.

---

## Test Infrastructure

### What survives from Phase 1-2

- `tests/e2e/_fixtures/seed-tenants.ts` — direct-pg fixture that seeds two tenants. Was written for the Lowdefy era; needs minimal updates:
  - Cookie name handling: legacy used `__Secure-next-auth.session-token`; Auth.js v5 uses `__Secure-authjs.session-token` (default cookie name changed in v5). Update the `SESSION_COOKIE_NAME` constant.
  - `SET ROLE NONE` bypass pattern still works (migration 0013 is unchanged).
- `tests/e2e/_fixtures/teardown.ts` — minimal `TRUNCATE … RESTART IDENTITY` over the seeded tenants.
- `tests/e2e/cross-tenant-leak.spec.ts` — direct-pg leak-probe pattern; survives unchanged.
- `tests/e2e/layer5-rls-activation.spec.ts` — RLS-active pattern; survives. May need re-pointing at the Next.js app's URL.
- `tests/e2e/*.spec.ts` — the rest target Lowdefy/Budibase routes; **most will be REPLACED**, not adapted, in W2-W4 against the new Next.js routes.
- `playwright.config.ts` — change `baseURL` default to `http://localhost:3000` (currently `http://localhost:8080`).

### What W1 needs to add

- **`tests/integration/auth-flow.spec.ts`** — opens `/login`, posts an email, asserts: (a) a `verification_tokens` row written; (b) Resend SDK called (mock via env or use Resend's onboarding sandbox).
- **`tests/integration/tenant-scoped-query.spec.ts`** — directly invokes `tenantScopedQuery()` with seeded tenant fixture; asserts results contain only one tenant's rows.
- **`tests/integration/layer-5-rls-blocks-without-tx.spec.ts`** — opens a raw pg client connecting as `shifts`, runs a plain `SELECT * FROM soldier` WITHOUT setting tenant; asserts 0 rows returned (proves Layer 5 is active).
- **`tools/check-tenant-isolation.ts`** — the ts-morph CI gate; comes with its own unit tests (`tools/test/check-tenant-isolation.test.mjs`) that run small TS fixtures asserting `[OK]` and `[FAIL]` cases (good case: helper inside `src/lib/tenant/` uses `db.select()`; bad case: an `app/(authed)/foo/page.tsx` uses `db.select()`).

### Driver decision: testcontainers vs. live local Postgres vs. hpg5

- **W1 recommendation: live local Postgres via `docker compose up -d postgres`** (same image as hpg5: `postgres:16`, same `postgres-data/` volume conventions). Drizzle integration tests connect to `localhost:5432`.
- **Testcontainers** is overkill for our scale; adds 5-10s startup per test run. Could revisit in W4 if we want isolated CI runs.
- **hpg5 directly** is risky — flaky network from a Windows laptop dev tunnel; keep hpg5 for production / acceptance only.

---

## Common Pitfalls

### Pitfall 1: `casing: 'camel'` in drizzle.config.ts silently breaks Auth.js

**What goes wrong:** `drizzle-kit pull` generates `pgTable("accounts", { userId: ... })` instead of `pgTable("accounts", { "userId": ... })`, and Drizzle treats `userId` as snake_case `user_id` when generating SQL. Auth.js adapter then fails with "column does not exist."

**Why it happens:** Migration 0002 uses quoted PascalCase (`"userId"`, `"sessionToken"`) per Auth.js convention. The default `'camel'` casing rewrites all column references to camelCase TypeScript names mapped to snake_case SQL — wrong for these tables.

**How to avoid:** Set `introspect: { casing: 'preserve' }` in `drizzle.config.ts`. Verify after `pull` that `src/db/schema.ts` shows `userId: uuid('"userId"')` with quoted SQL name.

**Warning signs:** First magic-link attempt fails with Postgres error "column \"user_id\" does not exist" in container logs.

### Pitfall 2: Middleware imports auth.ts (not auth.config.ts) → edge runtime crash

**What goes wrong:** `middleware.ts` imports the full `auth.ts` which pulls in `DrizzleAdapter` which pulls in `pg` which requires Node TCP sockets → edge runtime build error: "node:net is not available."

**Why it happens:** Auth.js v5 docs are explicit about the split but every example also shows `auth.ts` exporting `auth` — easy to import the wrong one.

**How to avoid:** middleware.ts imports `@/lib/auth/config` (the providers-only file). The actual `auth()` helper (with database access) is imported from `@/lib/auth` only in Server Components and API routes.

**Warning signs:** Build error mentioning `node:net`, `node:tls`, or `pg/lib/native`.

### Pitfall 3: Drizzle transactions on pg.Pool — implicit connection acquisition

**What goes wrong:** Someone replaces `db.transaction(...)` with a sequence of `db.execute('SET LOCAL ...')` + `db.select()...`, expecting them to run on the same physical connection. They don't — pg.Pool gives each call a different physical connection. `SET LOCAL` runs on a connection that gets returned to the pool, then the SELECT runs on a different connection that has `app.current_tenant` = sentinel.

**Why it happens:** Looks like a sensible refactor. Hides a subtle pooling bug.

**How to avoid:** Layer 2 helper `withTenantTx` is the ONLY API exposed. Internal-to-helper code never breaks the transaction wrapping. The CI gate flags any `db.execute(...SET LOCAL...)` outside `src/lib/tenant/`.

**Warning signs:** Sporadically empty result sets in production; works fine in test fixtures where the pool has 1 connection.

### Pitfall 4: Resend rate-limit (2 req/s on free tier) hits during W2-W3 invite-bulk send

**What goes wrong:** A team manager imports a 50-soldier CSV; each row triggers a magic-link invite; first 5 send, rest fail with 429.

**Why it happens:** Resend free tier is rate-limited.

**How to avoid:** This isn't a W1 problem (W1 only sends single magic-link logins). But carry the legacy `bulkDispatchWithBackoff` pattern forward for W2-W3 by NOT deleting `legacy/shifty-handlers/dispatch/resend.js`. The 500ms pacing + `[1s, 4s, 16s]` backoff is already implemented and proven.

**Warning signs:** W2-W3 CSV import fails on the 6th row in production with no retry; production-only because the test fixture has 2 rows.

### Pitfall 5: Cookie name mismatch breaks Playwright cookie-auth tests

**What goes wrong:** Legacy `seed-tenants.ts` exports `SESSION_COOKIE_NAME = '__Secure-next-auth.session-token'`. Auth.js v5 uses `__Secure-authjs.session-token` by default. Playwright tests set the wrong cookie name; every authed test redirects to /login.

**Why it happens:** Auth.js v5 renamed the cookie prefix as part of the brand transition.

**How to avoid:** Either (a) explicitly override `cookies.sessionToken.name` in the NextAuth config to keep the legacy name (lowest-touch), or (b) update `SESSION_COOKIE_NAME` in the test fixtures (cleaner). Recommend (b).

**Warning signs:** Every authed Playwright test fails with redirect to /login despite the seeded session row being valid in Postgres.

### Pitfall 6: Next.js 15 + React 19 module-resolution conflict with older type definitions

**What goes wrong:** `pnpm i react @types/react` pulls older `@types/react@18` types that don't match React 19 runtime; build fails with type errors.

**Why it happens:** `@types/react` major versions trail React; some packages still depend on `@types/react@^18`.

**How to avoid:** create-next-app sets the correct versions automatically. If hand-installing, pin `@types/react@^19`.

**Warning signs:** First build fails with `Type 'ReactNode' is not assignable to ...`.

### Pitfall 7: Hebrew Tailwind classes that don't exist (`mr-auto` instead of `me-auto`)

**What goes wrong:** Developer hand-codes a centering pattern using `ml-auto` (or pulls one from a Stack Overflow answer). Renders correctly in LTR mode (the dev's own assumption) but flips to wrong side in RTL.

**Why it happens:** Stack Overflow + LLM training data is LTR-by-default; logical properties are still less common.

**How to avoid:** A lint rule (eslint-plugin-tailwindcss or a custom regex CI gate) that fails on use of `ml-/mr-/pl-/pr-/text-left/text-right` and recommends `ms-/me-/ps-/pe-/text-start/text-end`. Worth adding as a W1 follow-on (not critical for the wave, but cheap to add once we have the CI gate harness).

**Warning signs:** First Hebrew visual regression in W3 (manager edits a form; alignment looks correct in Builder Preview but wrong in production).

---

## Code Examples

> All examples below are verified against current Auth.js v5 + Drizzle 0.45 + Next.js 15 docs (as of 2026-05). Cite sources inline.

### Example 1: `src/db/client.ts`

```typescript
// Source: https://orm.drizzle.team/docs/connect-node-postgres
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Match legacy posture: small pool — hpg5 single-instance, max ~10 concurrent reqs at v1 target.
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
```

### Example 2: `src/lib/auth/config.ts` and `src/lib/auth/index.ts`

```typescript
// src/lib/auth/config.ts — edge-safe, no DB
// Source: https://authjs.dev/guides/edge-compatibility
import type { NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';

export default {
  providers: [
    Resend({
      // apiKey auto-detected from AUTH_RESEND_KEY env var
      from: process.env.AUTH_RESEND_FROM!,
    }),
  ],
  pages: {
    signIn: '/login',
    verifyRequest: '/login/verify',
    error: '/login/error',
  },
  session: { strategy: 'database' },
  // No callbacks here — they live in auth.ts (need DB access)
} satisfies NextAuthConfig;

// src/lib/auth/index.ts — full auth with DB
// Source: https://authjs.dev/getting-started/adapters/drizzle
import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/db/client';
import { users, accounts, sessions, verificationTokens } from '@/db/schema';
import authConfig from './config';
import { shiftySessionCallback } from './callbacks';
import { sendHebrewMagicLink } from './resend-email';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    session: shiftySessionCallback,
  },
  // Override Resend provider's sendVerificationRequest with Hebrew template
  providers: authConfig.providers.map((p) =>
    p.id === 'resend' ? { ...p, sendVerificationRequest: sendHebrewMagicLink } : p
  ),
});
```

### Example 3: `app/api/auth/[...nextauth]/route.ts`

```typescript
// Source: https://authjs.dev/getting-started/installation?framework=next.js
export { GET, POST } from '@/lib/auth';

// In auth.ts above, `handlers` is `{ GET, POST }` — but Auth.js v5 also lets us re-export named handlers directly:
// export const { handlers: { GET, POST } } = NextAuth(...)
```

### Example 4: `middleware.ts`

```typescript
// Source: https://authjs.dev/guides/edge-compatibility
import NextAuth from 'next-auth';
import authConfig from '@/lib/auth/config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isAuthedPath = nextUrl.pathname.startsWith('/(authed)') ||
                       /* expand to the public layout segments */ false;

  // Auth.js v5 idiom: redirect unauthenticated users to /login for authed paths
  // (The route-group syntax in matcher doesn't work directly — match by URL prefix instead)
  if (!isLoggedIn && nextUrl.pathname.startsWith('/shifts')) {
    return Response.redirect(new URL('/login', nextUrl));
  }
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

### Example 5: `app/(authed)/shifts/page.tsx` — first authed route

```typescript
// Source: composition of Auth.js + Drizzle + our tenantScopedQuery
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { tenantScopedQuery } from '@/lib/tenant';
import { shiftSlot } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default async function ShiftsPage() {
  const session = await auth();
  if (!session?.user?.shiftyTenantId) {
    redirect('/login');
  }

  const slots = await tenantScopedQuery(session, (tx) =>
    tx.select().from(shiftSlot).limit(50)
  );

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">משמרות</h1>
      <Card>
        <CardHeader>
          <CardTitle>תבניות משמרת ({slots.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-muted-foreground">אין עדיין תבניות משמרת.</p>
          ) : (
            <ul className="space-y-2">
              {slots.map((slot) => (
                <li key={slot.id} className="flex justify-between">
                  <span>{slot.name}</span>
                  <span className="text-muted-foreground">{slot.headcount}</span>
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-4">צור תבנית חדשה</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Example 6: `tools/check-tenant-isolation.ts` — the Layer-2 CI gate (sketch)

```typescript
// Source: https://ts-morph.com/details/walking
import { Project, SyntaxKind, Node } from 'ts-morph';
import path from 'node:path';

const TENANT_BOUNDARY = path.resolve('src/lib/tenant');
const DB_IDENTIFIERS = new Set(['db', 'tx']);  // expand as needed
const FORBIDDEN_METHODS = new Set(['select', 'insert', 'update', 'delete']);
const project = new Project({
  tsConfigFilePath: './tsconfig.json',
});

const violations: { file: string; line: number; expr: string }[] = [];

for (const sourceFile of project.getSourceFiles(['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'])) {
  const filePath = sourceFile.getFilePath();
  if (filePath.startsWith(TENANT_BOUNDARY)) continue; // exempt
  // Also exempt test files and the auth adapter glue
  if (filePath.includes('/__tests__/') || filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) continue;
  if (filePath.includes('src/db/')) continue; // schema + client are exempt

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const callExpr = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;
    const methodName = expr.getName();
    if (!FORBIDDEN_METHODS.has(methodName)) return;
    // Walk up to find the root identifier
    let root: Node = expr.getExpression();
    while (Node.isPropertyAccessExpression(root) || Node.isCallExpression(root)) {
      root = (root as any).getExpression();
    }
    if (!Node.isIdentifier(root)) return;
    if (!DB_IDENTIFIERS.has(root.getText())) return;
    violations.push({
      file: path.relative(process.cwd(), filePath),
      line: callExpr.getStartLineNumber(),
      expr: callExpr.getText().slice(0, 80),
    });
  });
}

if (violations.length > 0) {
  console.error('Layer 2 tenant-isolation violations:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.expr}`);
  }
  process.exit(1);
}
console.log('Layer 2 check passed: 0 violations.');
```

---

## State of the Art

| Old Approach (Lowdefy/Budibase era) | Current Approach (post-pivot) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lowdefy YAML pages + custom plugins | Next.js App Router + RSC | 2026-05-18 | Code-first authoring; eliminates "applied-but-inert" failures |
| Budibase Builder UI + CouchDB | Next.js App Router + Postgres | 2026-05-18 | Single source of truth in git; no opaque CouchDB state |
| Knex Postgres queries | Drizzle ORM | 2026-05-18 | Typed queries; same SET LOCAL transaction pattern carries forward |
| `tools/check-bb-queries.mjs` (regex over Budibase SQL strings) | `tools/check-tenant-isolation.ts` (ts-morph over .ts files) | 2026-05-18 | Stronger guarantee — surface is the TypeScript program, not a remote JSON dump |
| NextAuth 4 + KnexAdapter (Lowdefy-era port) | NextAuth 5 beta + DrizzleAdapter | 2026-05-18 | First-class App Router support; edge-runtime middleware split |
| Layer 5 RLS inactive (Budibase superuser bypassed) | Layer 5 RLS active (Next.js connects as `shifty_app`) | 2026-05-18 | Strictly stronger tenant isolation |

**Deprecated / outdated patterns to NOT re-introduce:**
- `next-i18next` — Pages Router era; we're App Router → `next-intl`.
- `getServerSession` (Auth.js v4) → `auth()` helper (v5).
- `<Link href passHref>` pattern (Next 12 era) → just `<Link href="...">`.
- `next/router` from a Server Component → use `next/navigation`'s `redirect()`.
- Webpack-specific config in `next.config.ts` — Next 15 uses Turbopack by default; webpack is opt-in via `--webpack`.

---

## Validation Architecture

(W1 honors `workflow.nyquist_validation: true` per `.planning/config.json`.)

### Test Framework

| Property | Value |
|----------|-------|
| Framework (unit) | Node.js built-in `node:test` (already used by `tests/unit/*.spec.ts` in repo) |
| Framework (integration / e2e) | Playwright 1.49+ (already configured at `playwright.config.ts`) |
| Config file | `playwright.config.ts` (update `baseURL` from `:8080` → `:3000` for dev) |
| Quick run command (unit) | `pnpm test:unit` (existing script — node --test --experimental-strip-types) |
| Quick run command (CI gate) | `pnpm test:check-tenant-isolation` (new script, ts-morph script + its unit tests) |
| Full suite command | `pnpm test:unit && pnpm test:check-tenant-isolation && pnpm playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TEN-01 | Tenant isolation enforced on `tenantScopedQuery()` | integration | `pnpm playwright test tests/e2e/cross-tenant-leak.spec.ts` | ✅ exists, needs URL/cookie-name update (W1 Wave-0 task) |
| TEN-02 | Layer 5 RLS active for app role | integration | `pnpm playwright test tests/e2e/layer5-rls-activation.spec.ts` | ✅ exists, may need URL update only |
| TEN-03 | tenant_id NEVER from request input | static | `pnpm test:check-tenant-isolation` (gate covers this) | ❌ — Wave 0 must create `tools/check-tenant-isolation.ts` + tests |
| AUTH-01 | Magic-link signin produces session row | integration | `pnpm playwright test tests/integration/auth-flow.spec.ts` | ❌ — Wave 0 must create |
| AUTH-02 | Session cookie HTTP-only + Secure | integration | `pnpm playwright test tests/e2e/auth-cookies.spec.ts` | ✅ exists, may need cookie-name update |
| AUTH-04 | `session.user.shiftyTenantId` populated | unit | `pnpm test:unit -- tests/unit/session-callback.spec.ts` | ❌ — Wave 0 must create |
| SEC-01 | All env-driven secrets, none in code | static | grep CI (existing pattern) | ✅ pattern exists |
| SEC-07 | CSRF on state-changing endpoints | integration | Auth.js provides; covered by `auth-flow.spec.ts` | (covered above) |

### Sampling Rate

- **Per task commit:** `pnpm test:check-tenant-isolation && pnpm test:unit` (~5s total)
- **Per wave merge:** Full suite above + `pnpm playwright test` (~60-90s)
- **Phase gate:** Full suite green + manual smoke (open `/login`, request magic link, click link, land on `/shifts`) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tools/check-tenant-isolation.ts` — Layer-2 AST gate
- [ ] `tools/test/check-tenant-isolation.test.mjs` — unit tests for the gate (golden good/bad fixtures)
- [ ] `tests/integration/auth-flow.spec.ts` — magic-link end-to-end via Playwright (uses Resend onboarding sandbox + real inbox OR mocks Resend SDK)
- [ ] `tests/integration/tenant-scoped-query.spec.ts` — direct `tenantScopedQuery()` invocation
- [ ] `tests/integration/layer-5-rls-blocks.spec.ts` — RLS active-enforcement probe
- [ ] `tests/unit/session-callback.spec.ts` — `shiftySessionCallback` unit test
- [ ] `package.json` script entries: `test:check-tenant-isolation`, `test:integration`, `dev`, `build`, `start`
- [ ] Cookie-name update across existing `tests/e2e/_fixtures/seed-tenants.ts` (`__Secure-authjs.session-token`)
- [ ] `baseURL` update in `playwright.config.ts` (3000 instead of 8080)

---

## Security Domain

(W1 honors `security_enforcement` — applicable since this wave wires the authentication boundary.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Auth.js v5 EmailProvider (magic-link, no password storage); CSRF on signin/callback; rate-limited by Resend itself |
| V3 Session Management | yes | Auth.js database session strategy → revocable; HTTP-only Secure SameSite=Lax cookie; `__Secure-` prefix enforced when `NEXTAUTH_URL` is https |
| V4 Access Control | yes | Layer 1 (session.shiftyTenantId) + Layer 2 (`tenantScopedQuery` CI gate) + Layer 5 (Postgres RLS via `withTenantTx`) |
| V5 Input Validation | yes | `zod` schemas for all Server Action inputs and API route bodies |
| V6 Cryptography | yes | Magic-link tokens: 256-bit randomBytes + sha256 (Auth.js native); cookie signing with `AUTH_SECRET` (32-byte hex) |
| V7 Errors & Logging | yes (light) | Audit logs already in schema (`schedule_audit`); W1 just ensures stack traces in logs don't leak email tokens (log-redact pattern from `legacy/shifty-handlers/middleware/log-redact.js`) |
| V11 Business Logic | yes | "Soldier cannot self-grant role tags," "rule overrides can only tighten" — W3/W4 scope; W1 just makes sure server actions can enforce |
| V14 Configuration | yes | All secrets in `.env`; no `process.env.AUTH_RESEND_KEY` literal in code; HTTPS-only NEXTAUTH_URL in production |

### Known Threat Patterns for Next.js + Auth.js + Drizzle

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via query builder bypass | Tampering | Drizzle parameterizes ALL non-`sql.raw()` interpolations; the ONE `sql.raw()` use in `withTenantTx` is fed a regex-validated UUID, defensible |
| Session token hijack | Spoofing | `__Secure-` cookie + HttpOnly + SameSite=Lax (Auth.js default); HTTPS-only in production via Cloudflare Tunnel |
| Open redirect after magic-link callback | Tampering | Auth.js validates callback URL against configured `pages.signIn`; explicit `callbackUrl` query param goes through Auth.js validation |
| CSRF on signin POST | Tampering | Auth.js provides anti-CSRF token on `/api/auth/csrf` automatically |
| Tenant_id smuggled via request body | Elevation | Layer-2 CI gate fails build; Layer 5 RLS returns 0 rows even if Layer-2 bypassed |
| Magic-link token reuse | Spoofing | Auth.js `useVerificationToken` deletes the row on use; single-shot tokens |
| Tampering with `session.user.shiftyTenantId` in client | Tampering | Session callback re-derives from DB on every request (database strategy); client mutations to session object don't reach server |
| Postgres credential leak in stack trace | Information disclosure | log-redact middleware (legacy port); `DATABASE_URL` never logged on `process.env.*` dumps |
| Resend API key in client bundle | Information disclosure | Used only in API routes / Server Actions; Next.js does not bundle non-`NEXT_PUBLIC_*` env vars into the client |

---

## Environment Availability

| Dependency | Required By | Available on hpg5 | Version | Fallback |
|------------|------------|-------------------|---------|----------|
| Postgres 16 | Drizzle, Auth.js adapter | ✓ (via docker compose) | 16 | — |
| Node.js 22+ | Next.js 15 build/runtime | ✓ (inside Dockerfile) | 22 (slim) | — |
| Docker Desktop | All container ops | ✓ (autostart per CLAUDE.md) | — | — |
| Resend API access | Magic-link emails | ⚠ requires `AUTH_RESEND_KEY` provisioning; domain `nesher.co` may need Resend verification | — | Onboarding sandbox `onboarding@resend.dev` for dev (only sends to verified address) |
| pnpm | Build tooling | likely yes (Next.js pulled it transitively before) | — | npm — same package set |
| Cloudflare Tunnel | Public URL access | ✓ runs in separate Windows user (out of scope for our SSH ops) | — | LAN-only via Tailscale `http://hpg5:8080` |
| PsExec | Docker registry pulls on hpg5 | ✓ (per CLAUDE.md) | — | Pull images on a different host and `docker save | docker load` via scp (slow but works) |
| `migrator` Postgres role | running migrations | ✓ (created by 0001 bootstrap) | — | — |
| `shifty_app` Postgres role | Next.js app connection (after migration 0013) | ✓ | — | — |

**Missing dependencies with no fallback:** none — all deps are either present or have viable fallbacks.

**Missing dependencies with fallback:**
- `nesher.co` Resend verification: use onboarding sandbox for dev. Production-acceptance gate (W1 closeout) requires real domain verification by the user.

---

## Open Questions / Decision Points

These are the decisions the planner (or the discuss-phase agent) must resolve. Frame as decision points, not answers.

### 1. **Auth.js v5 beta vs Auth.js v4 stable?**

- What we know: v5-beta.31 (2026-04-14) is the most recent published v5. Stable v4.24.14 (2026-04-14) exists and matches the legacy KnexAdapter shape closer.
- What's unclear: how stable beta.31 is in production. The Vercel team uses it on Vercel's own production but it's still labeled `beta`.
- Recommendation: v5. Justification: official Resend provider, edge-runtime split (future-proofs Vercel/Cloudflare moves), the `auth()` helper is unified across Server Components / Server Actions / API routes. v4 would force us to re-port the Resend custom-wrapper pattern from `legacy/shifty-handlers/auth/providers.js`. **Bring to user.**

### 2. **`shiftyTenantId` lookup strategy in session callback?**

- What we know: database session strategy gives the session callback the canonical `users` row. The legacy callback (`legacy/shifty-handlers/auth/callbacks.js`) bypassed RLS with `SET ROLE NONE` to look up `app_user.tenant_id` by email — works but requires bootstrap superuser semantics.
- What's unclear: whether to add a `users.shiftyTenantId` FK column (Option B, recommended) or use a SECURITY DEFINER lookup function (Option C, no schema change but more code) or do the RLS-bypass (Option A, smallest code change but couples auth flow to bootstrap superuser).
- Recommendation: **Option B** — add `users.shiftyTenantId` UUID column via a new migration in W1; populate it at user-creation time from invite-code redemption. Cleanest separation, smallest code at session-callback time, and the Auth.js `users` table is deliberately NOT RLS-protected. **Bring to user.**

### 3. **Env var rename: `NEXTAUTH_*` → `AUTH_*`?**

- What we know: Auth.js v5 convention is `AUTH_SECRET`, `AUTH_RESEND_KEY`. v4 used `NEXTAUTH_SECRET`. The `.env.example` currently has `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `RESEND_API_KEY`.
- What's unclear: whether the user prefers convention-matching (rename) or backward-compatible names.
- Recommendation: **rename for v5 convention** (`AUTH_SECRET`, `AUTH_RESEND_KEY`, keep `NEXTAUTH_URL` as-is — Auth.js v5 still reads this name as a legacy alias). One commit, one `.env.example` update, one hpg5 `.env` update, zero downstream surprises. **Bring to user.**

### 4. **Cloudflare Tunnel target — change to :3000 or keep :8080?**

- What we know: existing tunnel maps `apps.nesher.co → http://192.168.1.133:8080`. The Next.js container's natural port is 3000.
- What's unclear: whether to update tunnel config (lives in a separate Windows user account on hpg5, out of scope for our SSH ops per CLAUDE.md) or publish container port 8080:3000 to keep the existing tunnel happy.
- Recommendation: **publish `8080:3000` in compose** — zero tunnel config changes; the in-container port doesn't matter to the public URL. Tradeoff: nothing else can use 8080 on hpg5 (already the convention). **Bring to user.**

### 5. **pnpm vs npm?**

- What we know: zero existing lockfile in the repo root. Legacy comments reference pnpm (Lowdefy used it internally). hpg5 likely has npm via Node install but may not have pnpm.
- What's unclear: user preference.
- Recommendation: **pnpm** — faster on Windows Docker Desktop builds; recommended by Next.js docs. But npm works equally well. **Bring to user.**

### 6. **Drizzle 0.45 (stable) vs Drizzle 1.0-rc?**

- What we know: 0.45.2 is the latest 0.x stable. 1.0.0-rc.2 is the next major (May 2026). Both have the same RLS pattern, same `db.transaction()` shape.
- What's unclear: API stability between rc.2 and 1.0.0 final.
- Recommendation: **0.45.2 stable.** Reason: this phase already has plenty of moving pieces; locking the ORM at a stable version eliminates one risk. Upgrade to 1.x in a follow-on phase once 1.0.0 ships. **Default — escalate only if user objects.**

### 7. **Local dev DB — fresh container or use hpg5's?**

- What we know: hpg5 production-ish Postgres lives in `postgres-data/` on hpg5; local dev needs its own. The schema is the same (14 migrations).
- What's unclear: whether to seed local dev with a fresh `docker compose up postgres` + `docker compose run --rm migrate`, or to use port-forwarded hpg5 over Tailscale.
- Recommendation: **fresh local Postgres** — isolated, fast to reset, no risk of clobbering hpg5 data during a misfired `TRUNCATE`. Document the `docker compose up -d postgres && docker compose run --rm migrate` recipe in W1's README diff. **Default.**

### 8. **What if Builder UI state on hpg5 wasn't wiped at pivot time?**

- What we know: ADR §"Next steps" point 2 says "preserve `postgres-data`" but `docker compose down -v` for Budibase services. Whether step 2 actually executed is unknown to research (no commit references it after the ADR).
- What's unclear: live state on hpg5.
- Recommendation: **W1 Task 0** — verify hpg5 has only `shifts-postgres` running, drop any leftover `shifty-budibase-*` and `budibase-*` volumes if present (`docker compose down -v` for any leftover stack), then proceed. Cheap to add; prevents weird port collisions. **Default.**

---

## Assumptions Log

> All claims are tagged `[VERIFIED]` (npm registry + official docs + slopcheck), `[CITED]` (official docs URL), or `[ASSUMED]` (training-knowledge only). The table below lists only `[ASSUMED]` claims that the planner / discuss-phase should validate with the user.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `next.config.ts` `output: 'standalone'` is the right Docker mode for self-hosted Next.js 15 on hpg5 | Docker / hpg5 deployment | Image is larger than necessary; build slower. Low risk, easy to flip. |
| A2 | Resend onboarding sandbox is acceptable for W1 dev iterations before `nesher.co` is verified | Resend notes | If user wants production-from-day-one, W1 needs a Resend domain verification task added |
| A3 | `legacy/shifty-handlers/dispatch/resend.js`'s `buildInviteHtml`/`buildInviteText` port forward verbatim (the Hebrew template renders correctly when used via `sendVerificationRequest`) | Patterns / Don't Hand-Roll | Medium — the legacy code uses `createRequire` (Lowdefy-pnpm-isolation hack) which we don't need in a normal Next.js project. The TEMPLATE STRINGS port verbatim; the wrapper code is rewritten. |
| A4 | Auth.js v5 beta.31's `next-auth/providers/resend` import path is stable | Code examples | Low — Auth.js docs already document this path; if it changes in subsequent betas we update one import. |
| A5 | `pg.Pool` with `max: 10` is adequate for v1 scale | `src/db/client.ts` example | Low — v1 target is 100 tenants × small concurrent usage; revisit at Phase 5 if observed. |
| A6 | hpg5's Cloudflare Tunnel is still pointed at `192.168.1.133:8080` post-pivot | Open Questions #4 | Verify with user; if tunnel was already re-pointed during pivot cleanup, choose the matching compose port. |
| A7 | Auth.js v5's `users` table extension via `usersTable: users` config accepts an extra `shiftyTenantId` column without rejecting the row insert | Pattern 5 / Open Q #2 | Low — adapter doesn't validate column shape, it just inserts the standard fields. Extra columns with DEFAULT NULL are fine. Confirm with first test. |
| A8 | The Lowdefy-era cookie name change from `next-auth.session-token` to `authjs.session-token` happens automatically on Auth.js v5 install (we don't need a custom `cookies.sessionToken.name`) | Pitfall 5 | Low — Auth.js v5 docs confirm the rename. Custom name is opt-in. |
| A9 | The `migrate` service in `docker-compose.yml` does NOT need changes for W1 (it stays one-shot, applies the same 14 migrations); we may add a 15th migration in W1 for `users.shiftyTenantId` per Open Q #2 | Build artifacts | Low — adding a new numbered migration is the established pattern. |
| A10 | shadcn's `migrate rtl` CLI command (referenced in shadcn RTL docs) is unnecessary because we'll `init --rtl` from a fresh project | Pattern 3 | Low — fresh init bypasses the migration step. |

---

## Sources

### Primary (HIGH confidence — Context7 / official docs)

- [nextjs.org/docs/app/getting-started/installation](https://nextjs.org/docs/app/getting-started/installation) — Next.js 15/16 installation, TS minimum 5.1, Tailwind v4 default, App Router structure (last updated 2026-05-13)
- [nextjs.org/docs/app/getting-started/deploying](https://nextjs.org/docs/app/getting-started/deploying) — Docker standalone output, multi-stage Dockerfile (last updated 2026-05-13)
- [authjs.dev/getting-started/adapters/drizzle](https://authjs.dev/getting-started/adapters/drizzle) — DrizzleAdapter import + config
- [authjs.dev/guides/edge-compatibility](https://authjs.dev/guides/edge-compatibility) — split `auth.ts` / `auth.config.ts` pattern
- [authjs.dev/getting-started/providers/resend](https://authjs.dev/getting-started/providers/resend) — Resend provider env vars, `sendVerificationRequest` override hook
- [authjs.dev/reference/nextjs#callbacks](https://authjs.dev/reference/nextjs#callbacks) — session/jwt callback signatures
- [authjs.dev/concepts/session-strategies](https://authjs.dev/concepts/session-strategies) — JWT vs database tradeoffs
- [orm.drizzle.team/docs/get-started/postgresql-new](https://orm.drizzle.team/docs/get-started/postgresql-new) — Drizzle + pg setup
- [orm.drizzle.team/docs/drizzle-kit-pull](https://orm.drizzle.team/docs/drizzle-kit-pull) — `pull` command, `casing` option, --init flag
- [orm.drizzle.team/docs/rls](https://orm.drizzle.team/docs/rls) — official RLS pattern via `set_config` + transaction
- [ui.shadcn.com/docs/installation/next](https://ui.shadcn.com/docs/installation/next) — shadcn init, components.json, vendored components
- [ui.shadcn.com/docs/rtl](https://ui.shadcn.com/docs/rtl) — RTL support, `rtl: true` config flag, auto-transform, migrate command, three manual-RTL components
- [github.com/vercel/next.js/tree/canary/examples/with-docker](https://github.com/vercel/next.js/tree/canary/examples/with-docker) — canonical multi-stage Dockerfile

### Local source-of-truth (HIGH confidence — read directly)

- `docs/PRD.md` §1 (stack), §8.2 (security), §8.3 (RBAC + amendment), §8.5 (i18n/RTL), §8.6 (a11y)
- `docs/NEXTJS-CONVENTIONS.md` — load-bearing conventions
- `.planning/deliberations/2026-05-18-budibase-to-nextjs-pivot.md` — ADR
- `.planning/ROADMAP.md` Phase 03 — W1-W4 scope
- `db/migrations/0001..0014` — schema source of truth
- `legacy/shifty-handlers/auth/{adapters.js,callbacks.js,providers.js}` — porting source for Auth.js patterns
- `legacy/shifty-handlers/dispatch/resend.js` — Hebrew RTL email template (port verbatim)
- `legacy/shifty-handlers/hooks/{knex-tenant.js,with-tenant-tx.js}` — proven SET LOCAL transaction pattern
- `tests/e2e/_fixtures/seed-tenants.ts` — live tenant-seeding pattern (needs cookie-name update)
- `docker-compose.yml`, `.env.example`, `playwright.config.ts` — current compose + env + test config

### Secondary (MEDIUM confidence — WebSearch + slopcheck verified)

- WebSearch result on Drizzle RLS transaction patterns (cross-verified with official `orm.drizzle.team/docs/rls`)
- slopcheck 0.6.1 — 23 packages scanned, all `[OK]` (2026-05-18)
- `npm view <pkg> version / time --json` — version metadata for all packages

### Tertiary (LOW confidence — flagged for validation)

- Hebrew RTL handling in Outlook 2013/2016 (legacy `dispatch/resend.js` notes claim Litmus snapshots; not re-verified in this research; W1 only sends auth magic links → low criticality)
- Resend free-tier rate limit (2 req/s) — claimed in legacy code; not relevant to W1 single-email path; revisit in W2-W3 CSV import

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against `npm view` + slopcheck; install commands match official docs from 2026-05.
- Architecture (tenant isolation triple-layer): HIGH — Drizzle's own RLS docs use exactly the SET LOCAL transaction pattern from our `legacy/with-tenant-tx.js`; the schema already enforces the role split.
- Auth.js v5 beta usage: MEDIUM — beta status is the only soft spot; mitigated by v4 fallback option flagged in Open Q #1.
- shadcn RTL: HIGH — explicit `rtl: true` config flag documented; three known manual-RTL components flagged.
- Layer-2 CI gate (ts-morph): MEDIUM — pattern is sound but the exact ts-morph script is sketched not battle-tested. Wave-0 task includes writing unit-test fixtures against it.
- Docker pattern: HIGH — copies the canonical Next.js example.
- Pitfalls: HIGH — most are either re-stated from legacy code's own comments (load-bearing experience) or from current Auth.js/Drizzle docs.

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (30 days for the stable stack pieces; sooner if Auth.js v5 ships its stable release — re-check beta status weekly during W1 execution)

---

*Compiled by gsd-researcher (Opus 4.7), 2026-05-18. Read by gsd-planner to produce 03-W1-PLAN.md.*
