---
name: lowdefy
description: Reference index for the Lowdefy low-code framework (v5.3.x). Use when authoring or debugging this project's lowdefy.yaml, connections, requests, blocks, operators, events, auth, plugins, or Docker deployment. Load only the relevant reference/*.md file — do not read the whole skill at once.
---

# Lowdefy — project skill (shifty)

Lowdefy is config-as-code. The whole app is YAML — there is no UI editor. Source of truth lives in `app/lowdefy.yaml` (plus optional `app/pages/*.yaml`, `app/connections/*.yaml` referenced via `_ref:`).

This skill is an **index, not a textbook.** Pick the one reference file that matches your task. Don't load multiple unless you genuinely need them. Each reference file is 200–800 lines.

## Live ground truth in this repo

When in doubt, copy the patterns that already work in this repo before inventing new ones:

- `app/lowdefy.yaml` — working app schema with Knex/PostgreSQL connection, KnexRaw request, AgGridAlpine block, _request operator
- `app/Dockerfile` — multi-stage build that survives pnpm symlink fragility (see commit `b8afba1` for why the layout matters)
- `docker-compose.yml` — Lowdefy + Postgres + healthcheck pattern
- `db/migrations/0001_init.sql` — the schema Lowdefy queries against
- `.env.example` — required env vars (`POSTGRES_*`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`)

## Where to look — index

| If you're doing…                                                              | Read this                          |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| Editing the top-level `lowdefy.yaml`, adding pages, menus, themes, types, `_ref` splits | `reference/01-schema-and-app.md`   |
| Adding/changing a database, API, S3, or mail connection                       | `reference/02-connections.md`      |
| Writing a query/mutation request (KnexRaw, AxiosHttp, MongoDB ops, etc.)      | `reference/03-requests.md`         |
| Adding form inputs, buttons, layout (Box, Form, TextInput, Selector, etc.)    | `reference/04-blocks-core.md`      |
| Tables, lists, charts, Markdown, Html, Result, etc.                           | `reference/05-blocks-data.md`      |
| Looking up an operator — `_state`, `_request`, `_user`, `_secret`, `_nunjucks`, `_array`, `_string`, etc. | `reference/06-operators.md` |
| Wiring `onClick`/`onInit`/`onMount` to actions (Request, Link, Reset, Validate, SetState, debounce, try/catch) | `reference/07-events-and-actions.md` |
| Anything auth — NextAuth providers, protected pages, roles, `NEXTAUTH_SECRET`/`NEXTAUTH_URL` | `reference/08-auth.md` |
| Consuming an npm plugin, or authoring a custom block/operator/connection      | `reference/09-plugins.md`          |
| Build CLI, Dockerfile, env vars, `.lowdefy/server/` structure, standalone output | `reference/10-deployment.md`     |

## When the reference isn't enough

These files were distilled from a context7 snapshot of `/websites/lowdefy` (3719 snippets, "High" reputation, score 90.7). For obscure or version-specific details, run a fresh query:

```
mcp__context7__query-docs libraryId=/websites/lowdefy query="<specific question>"
```

Prefer this over web search for anything Lowdefy-specific — context7 indexes the official docs and is more current than general training data.

## Cross-cutting gotchas (memorize these)

1. **Operators evaluate at different times.** Block-level operators evaluate on the client every state change. Request `payload` operators evaluate on the client when the request fires. Request `properties` operators evaluate on the **server**. `_secret` only works server-side. `_state` only works client-side. See `reference/06-operators.md`.

2. **pnpm symlink layout is fragile across Docker stages.** The fix in `app/Dockerfile` is to preserve `/build/.lowdefy/server` as a path in the runtime stage — flattening into `/app/` breaks dangling symlinks to `../../../../../...lowdefy/server/node_modules/.pnpm/...`. See commit `b8afba1` and `reference/10-deployment.md`.

3. **`_ref:` is a build-time include.** It splices YAML at build time and supports passing `vars:` for templating. It is NOT a runtime fetch.

4. **Block IDs in lists use `$`.** Inside a `List` or `AgGrid`, the per-row child block's id is `child.$` and the row's data is `_state: child.$` — the `$` is the index placeholder.

5. **Connection type names are case-sensitive PascalCase.** `Knex`, `MongoDBCollection`, `AxiosHttp`, `GoogleSheet`. Same for blocks: `AgGridAlpine`, not `aggridalpine`.

6. **Plugin packages must be installed AND declared.** Add the package to `app/package.json` AND list it under `plugins:` in `lowdefy.yaml`. Either alone won't work.

## File map

```
.claude/skills/lowdefy/
├── SKILL.md                          ← you are here
└── reference/
    ├── 01-schema-and-app.md          ← lowdefy.yaml top-level, pages, menus, themes, _ref
    ├── 02-connections.md             ← Knex/Mongo/Axios/S3/Mail/GoogleSheet
    ├── 03-requests.md                ← KnexRaw, AxiosHttp, MongoDB ops, payload/_payload
    ├── 04-blocks-core.md             ← Inputs, Form, Button, Box, Selector
    ├── 05-blocks-data.md             ← AgGrid, AntTable, List, Markdown, Html, Echarts
    ├── 06-operators.md               ← All operators, evaluation timing, dot-notation
    ├── 07-events-and-actions.md      ← Events schema, action types, debounce, try/catch
    ├── 08-auth.md                    ← NextAuth, protected/public pages, roles
    ├── 09-plugins.md                 ← Declaration, types.js, metas.js, block authoring
    └── 10-deployment.md              ← lowdefy build/start/dev CLI, Dockerfile, env vars
```
