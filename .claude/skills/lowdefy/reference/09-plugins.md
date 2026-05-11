# 09 — Plugins (consuming and authoring)

A Lowdefy plugin is an npm package that exports any of: blocks, connections, requests, actions, operators (client/server/build), auth providers, auth callbacks, auth events.

## Declaring (consuming) a plugin

Two things must match: the npm dependency in `package.json` AND the `plugins:` list in `lowdefy.yaml`.

### `app/package.json`

```json
{
  "dependencies": {
    "lowdefy": "5.3.0",
    "@lowdefy/connection-knex": "5.3.0",
    "@lowdefy/blocks-aggrid": "5.3.0",
    "my-org-shifts-plugin": "1.2.0",
    "another-plugin": "workspace:*"
  }
}
```

### `app/lowdefy.yaml`

```yaml
plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
  - name: 'my-org-shifts-plugin'
    version: '1.2.0'
  - name: 'another-plugin'
    version: 'workspace:*'                  # local monorepo workspace
  - name: 'name-collision-plugin'
    version: '1.0.0'
    typePrefix: Custom                       # prepended to type names to avoid clashes
```

If a plugin's block type is `Calendar`, with `typePrefix: Custom` it becomes `CustomCalendar` in your YAML.

`version: 'workspace:*'` works when Lowdefy and the plugin are in the same pnpm workspace. Useful while developing a plugin alongside the app.

## Built-in plugin catalog (subset)

| Package                            | What it provides                                  |
| ---------------------------------- | ------------------------------------------------- |
| `@lowdefy/blocks-antd`             | Default Ant Design blocks (auto-loaded).          |
| `@lowdefy/blocks-aggrid`           | `AgGridAlpine`, `AgGridBalham`.                   |
| `@lowdefy/blocks-echarts`          | `Echarts`.                                        |
| `@lowdefy/blocks-loaders`          | Loading / skeleton blocks.                        |
| `@lowdefy/blocks-markdown`         | `Markdown`.                                       |
| `@lowdefy/connection-knex`         | `Knex` connection + `KnexRaw`/`KnexBuilder`/etc.  |
| `@lowdefy/connection-axios-http`   | `AxiosHttp` connection and request.               |
| `@lowdefy/connection-mongodb`      | `MongoDBCollection` + Mongo request types.        |
| `@lowdefy/connection-google-sheets`| `GoogleSheet`.                                    |
| `@lowdefy/connection-amazon-s3`    | `AmazonS3`.                                       |
| `@lowdefy/connection-sendgrid-mail`| `SendGridMail`.                                   |
| `@lowdefy/connection-smtp`         | `SMTP`.                                           |
| `@lowdefy/plugin-nextauth`         | Bundles NextAuth providers and adapters.          |

Confirm exact package list per version on npm.

## Calendar plugin notes

For shifty's calendar requirement, search npm for community blocks: `lowdefy-fullcalendar`, `@*/lowdefy-block-calendar`, etc. Lowdefy's plugin system is open — anything is fair game. If no good plugin exists, embed a Google Calendar via an `Html` block or author a custom block (below).

## Authoring a custom plugin

A Lowdefy plugin is an ESM Node package with a fixed `exports` map. Skeleton:

### `package.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./actions": "./src/actions.js",
    "./auth/callbacks": "./src/auth/callbacks.js",
    "./auth/events": "./src/auth/events.js",
    "./auth/providers": "./src/auth/providers.js",
    "./blocks": "./src/blocks.js",
    "./connections": "./src/connections.js",
    "./metas": "./src/metas.js",
    "./operators/client": "./src/operators/client.js",
    "./operators/server": "./src/operators/server.js",
    "./types": "./src/types.js"
  },
  "files": ["src/*"],
  "peerDependencies": {
    "@lowdefy/block-utils": "^5.3.0",
    "react": "^18"
  }
}
```

Only include the export paths your plugin actually uses. Lowdefy's build picks up whichever exports are declared.

### `src/types.js` — declare what type names your plugin contributes

```js
export default {
  actions: ['MyAction'],
  auth: {
    callbacks: ['MyCallback'],
    events: ['MyEvent'],
    provider: ['MyProvider'],
  },
  blocks: ['MyBlock', 'AnotherBlock'],
  connections: ['MyConnection'],
  requests: ['MyConnectionDo', 'MyConnectionRead'],
  operators: {
    build: ['_my_build_operator'],
    client: ['_my_client_operator'],
    server: ['_my_server_operator'],
  },
};
```

This is the manifest Lowdefy validates against. Type names must match the `type:` strings users will put in YAML.

For blocks, prefer to derive types from metadata files (DRY):

```js
// src/types.js
import { extractBlockTypes } from '@lowdefy/block-utils';
import * as metas from './metas.js';

export default extractBlockTypes(metas);
```

### `src/metas.js` — re-export each block's meta

```js
export { default as MyBlock } from './blocks/MyBlock/meta.js';
export { default as AnotherBlock } from './blocks/AnotherBlock/meta.js';
```

### `src/blocks/MyBlock/meta.js`

```js
export default {
  category: 'display',
  icons: ['AiOutlineSmile'],
  styles: ['./MyBlock.css'],
  schema: {
    properties: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
      },
    },
    events: {
      onClick: {
        description: 'Fires on click.',
      },
    },
  },
};
```

`schema` follows JSON-Schema. Lowdefy validates user YAML against this at build time.

### `src/blocks.js` — re-export React components

```js
export { default as MyBlock } from './blocks/MyBlock/MyBlock.js';
export { default as AnotherBlock } from './blocks/AnotherBlock/AnotherBlock.js';
```

### `src/blocks/MyBlock/MyBlock.js`

```jsx
import React from 'react';

const MyBlock = ({ blockId, properties, methods, events }) => (
  <div onClick={() => events.onClick.run({})}>
    <h3>{properties.title}</h3>
    <p>{properties.count}</p>
  </div>
);

export default MyBlock;
```

Lowdefy passes a standard prop shape: `blockId`, `properties`, `events`, `methods`, `value`, `setValue` (for input blocks), `loading`, etc.

For input blocks, call `methods.setValue(newValue)` to write to state. For action emitters, call `events.<name>.run(eventData)`.

### Authoring a connection

```js
// src/connections.js
import MyConnection from './connections/MyConnection.js';
import MyConnectionDo from './connections/requests/MyConnectionDo.js';

export default {
  MyConnection,
  MyConnectionDo,
};
```

```js
// src/connections/MyConnection.js
export default {
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      baseUrl: { type: 'string' },
    },
    required: ['apiKey', 'baseUrl'],
  },
};
```

```js
// src/connections/requests/MyConnectionDo.js
async function MyConnectionDo({ request, connection }) {
  // Use fetch/axios/etc. with connection.apiKey, connection.baseUrl, request.properties
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

### Authoring an operator

Operators are pure functions:

```js
// src/operators/client.js
export function _slugify(args) {
  // args is the operator's value as parsed YAML
  if (typeof args !== 'string') throw new Error('_slugify expects a string');
  return args
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

Client operators run in the browser. Server operators run on the API server (use this for anything that needs Node APIs or secrets). Build operators run once at build time.

### Authoring an action

```js
// src/actions.js
export async function MyAction({ params, methods, blockId }) {
  // Do something — call methods.callAction(...), throw to fail the chain
}
```

## Workflow

1. Scaffold the plugin in a sibling directory (or a pnpm workspace).
2. `pnpm install` inside the plugin and the Lowdefy app side-by-side.
3. Reference with `version: workspace:*` (or `file:../my-plugin`) in `app/package.json`.
4. Add to `plugins:` in `lowdefy.yaml`.
5. Run `pnpx lowdefy build` (or rebuild the Docker image). Type validation will yell if names don't match.
6. Iterate.

For publishing: `pnpm publish` from the plugin directory; bump versions in `app/package.json` and `lowdefy.yaml`.

## Common pitfalls

- **Forgetting `plugins:` in YAML** — the package gets installed but Lowdefy doesn't know to load it. The build won't error but the block/connection/operator won't be available.
- **Type name mismatch** — `types.js` lists `MyBlock`, YAML uses `type: my_block`. Names must match exactly (case-sensitive).
- **Client vs server operators** — using a Node-only API (fs, crypto with Buffer) from a `client` operator crashes in the browser.
- **ESM only** — Lowdefy plugins are ESM. CommonJS imports won't work cleanly.

## See also

- `01-schema-and-app.md` — `plugins:` declaration
- `02-connections.md` / `03-requests.md` — built-in connection plugins
- `08-auth.md` — auth provider/callback/event plugins
