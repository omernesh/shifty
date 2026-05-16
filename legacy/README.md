# legacy/shifty-handlers

> **Preserved business logic from the killed Lowdefy stack.**
> Lowdefy was retired on 2026-05-16 (see the banner at the top of `CLAUDE.md`).
> These files are kept so the *next* stack — TBD, likely Next.js 15 + shadcn/ui
> + direct Auth.js — can port them without re-deriving the rules from the PRD.

## What's in here

| Subdir | Count | Origin (Lowdefy path) | Port effort |
|--------|------:|-----------------------|-------------|
| `requests/` | 17 files | `app/plugins/shifty-plugin/src/connections/Knex/requests/` | Wrapper shape changes per new framework; business SQL + validation reusable as-is |
| `helpers/` | 4 files | `app/plugins/shifty-plugin/src/helpers/` | **Pure functions — port verbatim** |
| `auth/` | 3 files | `app/plugins/shifty-plugin/src/auth/` | Framework-light glue; port the shape to whichever Auth.js wiring the new stack uses |
| `hooks/` | 2 files | `app/plugins/shifty-plugin/src/hooks/` | Layer-5 RLS plumbing — `withTenantTx` is the load-bearing primitive |
| `middleware/` | 1 file | `app/plugins/shifty-plugin/src/middleware/` | Pure secret redaction — port verbatim |
| `dispatch/` | 1 file | `app/plugins/shifty-plugin/src/dispatch/resend.js` | **Pure function — port verbatim** (12 unit tests still passing against this path) |

## What the original Lowdefy handler shape was

Every file in `requests/` exports a Lowdefy custom request class with these
static properties:

```js
class Foo {
  static type = 'Foo';                  // Lowdefy request type name
  static schema = { /* JSON Schema */ };
  static meta = { checkRead: false, checkWrite: true };
  static connectionType = 'Knex';

  constructor({ request, connection }) { /* ... */ }
  async resolve() { /* the business work */ }
}
```

When porting:

- The **constructor signature**, **`schema`**, and **`resolve()` body** are the
  things you keep — they encode the validation contract and the SQL/business
  logic. Drop the `static type` / `static meta` / `static connectionType`
  (those exist only so Lowdefy can locate and authorize the handler) and the
  class scaffolding; the new stack's pattern (Server Action, /api/route, RPC)
  will provide its own envelope.
- `request` is the validated payload (the `schema` above already passed). In
  Server Actions this becomes the function arg; in /api/route handlers it's
  parsed from `req.json()`.
- `connection` is a Knex instance. The new stack will inject this differently
  (e.g., a singleton imported from `lib/db.ts`) but the same Knex query builder
  works.

## Tenant isolation primitives

The four-layer defense (PRD §8.3) lives across these dirs:

- **Layer 1 — session-derived tenant_id**: `auth/callbacks.js`
  (`ShiftySessionCallback`) populates `session.user.tenant_id`. The new stack's
  Auth.js session callback can call the same SQL.
- **Layer 5 — Postgres RLS**: `hooks/with-tenant-tx.js` opens a transaction and
  runs `SET LOCAL app.current_tenant = $1` before any queries. This is the
  primitive every mutation handler wraps itself in. The DB-side policies
  (`db/migrations/0011_rls_layer_5.sql` etc.) reference `current_setting('app.current_tenant')`
  — they're framework-independent and keep working on the new stack.

## Tests that depend on these files

The following unit tests under `tests/unit/` import from `legacy/shifty-handlers/`
and continue to pass (12 + 6 + 6 + 8 = 32 cases):

- `tests/unit/canonicalize.spec.ts` → `legacy/shifty-handlers/helpers/canonicalize.js`
- `tests/unit/color-palette.spec.ts` → `legacy/shifty-handlers/helpers/palette.js`
- `tests/unit/role-tag-canonical.spec.ts` → `legacy/shifty-handlers/helpers/role-tag.js`
- `tests/unit/invite-email-rtl.spec.ts` → `legacy/shifty-handlers/dispatch/resend.js`

Run all: `npm run test:unit` (from repo root).

## Do NOT

- Don't edit these files in place. They're a frozen snapshot. If you need to
  fix a bug, fix it in the **ported** copy in the new stack and update the
  test to point at the new path.
- Don't add new files here. New business logic goes into the new stack from
  day one.
- Don't `require()` or `import` from this directory in any service that ships
  to production. This is reference material, not a runtime dependency.
