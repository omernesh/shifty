# Budibase 3.38.4 CE — Screen JSON contract (reverse-engineered)

**Date:** 2026-05-18
**Method:** Bundle inspection (`/builder/assets/index-BRkMXlAp.js`, 7.6 MB minified) + live API round-trip on hpg5 (POST → GET → DELETE confirmed). All findings empirically verified against the running stack.
**Status:** **LOAD-BEARING** for every Phase 3 W1+ plan that creates screens via the Internal API. Downstream plans (W2 planning_window, W3 availability UI, W4 rules catalog) consume this verbatim and SHOULD NOT re-spike.

---

## 0. The endpoints (Internal API)

All require cookie auth (`POST /api/global/auth/default/login` first → captures `budibase:auth` + `budibase:auth.sig` cookies) and the `x-budibase-app-id: app_dev_<id>` header. Bundle source `buildScreenEndpoints` (idx ~2161102):

| Operation | Method | Path | Notes |
|---|---|---|---|
| List screens | `GET` | `/api/screens` | Returns the array of screens scoped to `x-budibase-app-id`. Returns `[]` for an empty app. |
| Create OR update | `POST` | `/api/screens` | Same endpoint for both. The server distinguishes by the presence of `_id`+`_rev` in the body. No separate PUT/PATCH route. |
| Delete | `DELETE` | `/api/screens/<id>/<rev>` | Returns `{"message":"Screen deleted successfully"}`. |
| Usage in other screens | `POST` | `/api/screens/usage/<id>` | Pre-delete safety check; not required for our use case. |

Bundle source for these (verbatim):

```js
buildScreenEndpoints=cn=>({
  saveScreen:    async $    => await cn.post({ url:"/api/screens", body:$ }),
  deleteScreen:  async($,na) => await cn.delete({ url:`/api/screens/${$}/${na}` }),
  usageInScreens:async $    => await cn.post({ url:`/api/screens/usage/${$}` }),
})
```

## 1. Mandatory pre-requisite: `workspaceApp` must exist

**Empirical finding (2026-05-18 probe on hpg5):** the dev workspace `app_dev_169e766804934fd18f2e20200d8fd22d` shipped from the W0 era has **zero workspaceApps** (`GET /api/workspaceApp` returns `{"workspaceApps":[]}`). Every screen MUST be attached to a `workspaceAppId`. Without one, `POST /api/screens` returns:

```
HTTP 400 — Invalid body - "workspaceAppId" is required
```

### Creating a workspaceApp

Bundle source: `buildWorkspaceAppEndpoints` (idx ~2296262):

```
POST /api/workspaceApp
Body: { name, url }   // ONLY these two fields are accepted on create
```

Verified body that 400s:
```json
{ "name": "Shifty", "url": "/", "navigation": { "navigation": "Top" } }
// → 400 "Invalid body - \"navigation\" is not allowed"
```

Verified body that 201s:
```json
{ "name": "Shifty", "url": "/" }
```

Server response (full echo, 2026-05-18 probe):

```json
{
  "workspaceApp": {
    "_id": "workspace_app_<32-hex>",
    "_rev": "1-<rev_hash>",
    "name": "Shifty",
    "url": "/",
    "navigation": {
      "navigation": "Top",
      "title": "Shifty",
      "navWidth": "Large",
      "navBackground": "var(--spectrum-global-color-static-blue-1200)",
      "navTextColor": "var(--spectrum-global-color-static-white)",
      "links": []
    },
    "customTheme": { "fontFamily": "inter" },
    "isDefault": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Server-populated fields:** `_id`, `_rev`, `navigation` (full default sub-shape — title defaults to the `name`), `customTheme`, `isDefault`, timestamps. The client shouldn't try to set these on create.

### Editing the workspaceApp post-create

Bundle source (`workspaceAppStore.edit`):

```
PUT /api/workspaceApp/<_id>
Body: { _id, _rev, name, url, navigation, theme, customTheme, disabled }
```

For W1-01 we don't need to edit — the defaults are fine. W7 (polish) may revisit to set `navigation.links` (the top-nav menu items pointing at our screens).

### apply-fixtures.mjs implication

The applier MUST ensure a workspaceApp exists before applying any screens. Two strategies:
- **Strategy A (preferred):** `apply-fixtures.mjs` reads `BB_WORKSPACE_APP_ID` from env; if unset, it lists workspaceApps and uses the first one; if the list is empty, it creates a "Shifty" workspaceApp with name from env or default.
- **Strategy B:** A separate one-shot `init-workspace.mjs` runs once at deploy bootstrap; subsequent applies require the workspaceApp to exist.

W1-01 chooses **Strategy A** — keeps the applier idempotent end-to-end so a fresh-deployed hpg5 just needs `node src/apply-fixtures.mjs` and the workspace materializes.

## 2. Top-level Screen JSON shape

Bundle source (verbatim, `Screen$1` constructor body at idx ~5664832):

```js
class Screen$1 extends BaseStructure {
  constructor($) {
    super(true, {
      showNavigation: true,
      width: "Large",
      props: {
        _id: uuid$1(),
        _component: "@budibase/standard-components/container",
        _styles: { normal: {}, hover: {}, active: {}, selected: {} },
        _children: [],
        _instanceName: "",
        layout: "flex",
        direction: "column",
        hAlign: "stretch",
        vAlign: "top",
        size: "grow",
        gap: "M",
      },
      routing: { route: "", roleId: "BASIC", homeScreen: false },
      name: "screen-id",
      workspaceAppId: $,           // <-- passed via constructor
    });
  }
  ...
}
```

### The MINIMAL viable create payload (verified 2026-05-18)

```json
{
  "showNavigation": true,
  "width": "Large",
  "props": {
    "_id": "cmp_<8+ chars>",
    "_component": "@budibase/standard-components/container",
    "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
    "_children": [],
    "_instanceName": "Probe Screen",
    "layout": "flex",
    "direction": "column",
    "hAlign": "stretch",
    "vAlign": "top",
    "size": "grow",
    "gap": "M"
  },
  "routing": {
    "route": "/__shape_probe",
    "roleId": "BASIC",
    "homeScreen": false
  },
  "name": "screen-probe",
  "workspaceAppId": "workspace_app_<32-hex>"
}
```

**Server response on success (HTTP 200):** echoes the body with `_id: "screen_<32-hex>"`, `_rev: "1-..."`, and `pluginAdded: false` added. The `props._id` (the component _id) you sent is preserved verbatim.

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | Yes | string | Identifies the screen in lists / logs. NOT a URL. The repo's fixture-applier matches by `routing.route` (not `name`), because `route` is the URL-stable identifier and `name` can be edited freely in the UI. |
| `workspaceAppId` | **Yes** | string | Must reference an existing `workspace_app_*`. See §1. |
| `routing.route` | Yes | string | Path segment (e.g. `/shift-slots`). Empty `""` means "home" (sets `routing.homeScreen = true` semantics). Conflicts with another screen at the same `route + roleId + workspaceAppId` triple are rejected (bundle `isScreenUrlValid` idx ~5666295). |
| `routing.roleId` | Yes | string | One of the role `_id` values from `GET /api/roles`: `"ADMIN"` (Roles$1.ADMIN), `"BASIC"` (default per bundle, the "any logged-in user" role), `"PUBLIC"`. Custom roles get a `role_<hex>` _id. |
| `routing.homeScreen` | No (defaults false) | boolean | True = this screen is the homepage for `(workspaceApp, roleId)`. Only one home per `(workspaceApp, roleId)`; the bundle proactively sets `homeScreen=false` on siblings when toggling. |
| `showNavigation` | No (defaults true) | boolean | If false, the top nav is hidden on this screen (used for full-screen modals / PDFs). |
| `width` | No (defaults "Large") | "Max" \| "Large" \| "Medium" \| "Small" | Visual width preset (no effect on routing). |
| `props` | Yes | object | The root component tree (always a container by default). See §3. |
| `layoutId` | No | string | Custom layout reference. Not used in W1-01. |
| `variant` | No (defaults absent) | "PDF" | Set only on PDF-export screens (bundle PDFScreen subclass). |

## 3. Component tree (`props` recursion)

Every component (the root screen AND every child) is a `Component` instance — same shape:

```json
{
  "_id": "<unique within screen>",
  "_component": "@budibase/standard-components/<name>",
  "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
  "_children": [ /* nested components, same shape */ ],
  "_instanceName": "<human-readable>",
  /* component-specific props (text, dataSource, etc.) */
}
```

### Component types used in W1-01

| `_component` | Purpose | Key props |
|---|---|---|
| `@budibase/standard-components/container` | Layout wrapper (the screen root is one) | `layout: "flex"`, `direction`, `hAlign`, `vAlign`, `size`, `gap` |
| `@budibase/standard-components/tableblock` OR `gridblock` | Data table | `dataSource: { type: "query"|"table"|"viewV2", "_id": "<queryId>", "label": ... }` |
| `@budibase/standard-components/dataprovider` | Wraps a data source so children can bind to its `data` | `dataSource: { ... }`, used by Tables/Repeaters internally |
| `@budibase/standard-components/form` | Form scaffold; children bind to it via `field/...` props | `dataSource`, `actionType: "Create"\|"Update"` |
| `@budibase/standard-components/textfield` | Text input field | `field`, `placeholder`, `label`, `validation` |
| `@budibase/standard-components/numberfield` | Number input | `field`, `min`, `max`, `step` |
| `@budibase/standard-components/datetimefield` | Date/time picker | `field`, `enableTime: true`, `timeOnly: true` for time-only |
| `@budibase/standard-components/multifieldselect` | Multiselect bound to a query | `field`, `dataProvider: "{{ literal [provider-id] }}"`, `valueColumn`, `labelColumn` |
| `@budibase/standard-components/button` | Action trigger | `text`, `type: "cta"\|"primary"\|"warning"`, `onClick: [eventHandlers]` |
| `@budibase/standard-components/modal` | Modal container | `_children` hold the modal content |
| `@budibase/standard-components/radiogroup` | Radio selection | `options: [{ label, value }, ...]`, `onChange: [eventHandlers]` |
| `@budibase/standard-components/text` | Static or bound text | `text`, `align`, `size`, `bold`, `_conditions: [{...}]` for visibility |

### Query-binding pattern (the load-bearing one)

A Table that wraps a Query for our `shift-slot-list`:

```json
{
  "_id": "cmp_shifts_table_<hex>",
  "_component": "@budibase/standard-components/tableblock",
  "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
  "_children": [],
  "_instanceName": "Shifts table",
  "dataSource": {
    "label": "shift-slot-list",
    "tableId": "query_<datasourceId>_<random_hex>",
    "type": "query"
  },
  "title": "משמרות"
}
```

The `dataSource.tableId` carries the QUERY `_id` (yes, the field is named `tableId` even when binding to a query — Budibase historical naming). The query's `_id` is resolved AT APPLY TIME from `client.list('queries')`: filename `shift-slot-list.json` maps to query `name: "shift-slot-list"`, find its `_id` in the live list, substitute. (See `apply-fixtures.mjs` resolver in Task 2.)

### Parameter passing to a query binding

For queries that take parameters (e.g., `team_id` filter on `shift-slot-list`), pass them via a query-config wrapper:

```json
"dataSource": {
  "type": "query",
  "tableId": "query_xxx",
  "label": "shift-slot-list",
  "parameters": [
    { "name": "team_id", "default": "{{ state.selectedTeamId }}" }
  ]
}
```

The `default` value is a Handlebars binding string evaluated at runtime against `Current User`, `state.*`, `data.*` (parent dataprovider's rows), `params.*` (URL params), etc.

### Form-field-to-column binding

Inside a `form` component, each input child has a `field` prop matching the SQL parameter name. For a `shift-slot-create-modal` form, fields `name`, `start_time`, `end_time`, etc. map 1:1 to the named SQL params on `shift-slot-create.json`. The Form's `onSubmit` handler invokes the query passing form state as parameters.

## 4. Event handlers (`onClick`, `onChange`, `onSubmit`, etc.)

Bundle source (idx ~2290446): event handlers are arrays of objects, each with a `##eventHandlerType` discriminator + `parameters`.

```json
"onClick": [
  {
    "##eventHandlerType": "Validate Form",
    "parameters": { "componentId": "form_<hex>" }
  },
  {
    "##eventHandlerType": "Execute Query",
    "parameters": {
      "datasourceId": "datasource_plus_<hex>",
      "queryId": "query_<hex>",
      "queryParams": {
        "name": "{{ [form_<hex>].[name] }}",
        "start_time": "{{ [form_<hex>].[start_time] }}",
        "team_id": "{{ [form_<hex>].[team_id] }}"
      },
      "notificationOverride": false
    }
  },
  {
    "##eventHandlerType": "Refresh Data Provider",
    "parameters": { "componentId": "provider_<hex>" }
  },
  {
    "##eventHandlerType": "Close Screen Modal"
  }
]
```

### Known `##eventHandlerType` values (from bundle, idx 2290446 + surrounding)

| Type | Parameters |
|---|---|
| `"Validate Form"` | `{ componentId }` |
| `"Save Row"` | `{ providerId, tableId, notificationOverride, confirm }` |
| `"Execute Query"` | `{ datasourceId, queryId, queryParams, notificationOverride }` |
| `"Close Screen Modal"` | (none) |
| `"Close Side Panel"` | (none) |
| `"Close Modal"` | (none) |
| `"Clear Form"` | `{ componentId }` |
| `"Refresh Data Provider"` | `{ componentId }` |
| `"Navigate To"` | `{ url, peek }` |
| `"Show Notification"` | `{ message, type }` |
| `"Row Action"` | `{ rowActionId, resourceId, rowId }` |
| `"Open Modal"` | `{ componentId }` (the modal component _id) |
| `"Update State"` | `{ key, value, type, persist }` |
| `"Open Side Panel"` | `{ id }` |

These cover everything W1-01 needs:
- "+ Create" button → `Open Modal` (the create-modal component)
- Modal Submit → `Validate Form` + `Execute Query` (shift-slot-create) + `Close Modal` + `Refresh Data Provider`
- Delete button → `Execute Query` (shift-slot-delete) + `Show Notification` + `Refresh Data Provider`
- Row click (in tableblock) → `Update State` (`selectedRowId = {{ row._id }}`) + `Open Modal` (edit modal)

## 5. Roles + permissions (`routing.roleId`)

Probed `GET /api/roles` on hpg5 (2026-05-18) — three built-in roles, no custom roles yet:

| `_id` | `name` | `permissionId` | `inherits` | UI display |
|---|---|---|---|---|
| `ADMIN` | ADMIN | `admin` | `POWER` | "Admin user" — red |
| `BASIC` | BASIC | `write` | `PUBLIC` | "Basic user" — green (default for `Screen$1`) |
| `PUBLIC` | PUBLIC | `public` | (none) | "Public user" — blue |

W1-01 manager screens should use `routing.roleId: "ADMIN"`. The `BASIC` default in the bundle is for soldiers / non-admin users (Phase 3 W3 hybrid availability UI will use BASIC).

## 6. Bindings: `{{ Current User.shiftyTenantId }}` resolution context

**SPIKE-BINDINGS.md establishes that bindings DO NOT resolve via the Builder API (`POST /api/queries/<id>`). They resolve at the published-app browser runtime via `/api/v2/queries/<id>`.** This is THE load-bearing open question Task 4 verifies.

For screen authoring, this means:
- The screen's HTML/component tree is rendered by the **client runtime bundle**, not the Builder UI.
- Component-level `text`, `value`, `dataSource.parameters[].default` etc. that use `{{ ... }}` are evaluated at runtime in the published-app context.
- A query bound to `shift-slot-list` will resolve `{{ Current User.shiftyTenantId }}` in its WHERE clause IF the runtime resolver works for the browser-loaded app session.

## 7. Publishing the app

Bundle source (idx ~2151887): `publishAppChanges` →

```
POST /api/applications/<appId>/publish
Body: (none required — server uses the dev workspace's state as the source)
```

After publish, the published app is reachable at:
- LAN: `http://hpg5:8080/app/<urlSlug>` where `<urlSlug>` comes from the app's `url` field (`/default%20workspace` in our case)
- Public: `https://apps.nesher.co/app/default%20workspace`

For our dev app `app_dev_169e766804934fd18f2e20200d8fd22d`, the metadata response (probed 2026-05-18) gives `url: "/default%20workspace"`. The published-app's appId drops the `_dev_` prefix: `app_169e766804934fd18f2e20200d8fd22d` (`status: "published"`).

To unpublish (NOT part of W1-01 happy path): `POST /api/applications/<appId>/unpublish`.

## 8. Full example: a "Hello, Postgres" screen with a query-bound table

This is the smallest end-to-end screen for the W1+ playbook. The query `Baseline` already exists on hpg5 (from W0-02 era) — it's `SELECT current_setting('app.current_tenant', true) AS val;`. Below references it by name; the apply-time resolver substitutes the live `_id`.

```json
{
  "name": "hello-postgres",
  "workspaceAppId": "{{ resolved at apply time }}",
  "showNavigation": true,
  "width": "Large",
  "routing": { "route": "/hello", "roleId": "ADMIN", "homeScreen": false },
  "props": {
    "_id": "screen_hello_root",
    "_component": "@budibase/standard-components/container",
    "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
    "_instanceName": "Hello screen",
    "layout": "flex",
    "direction": "column",
    "hAlign": "stretch",
    "vAlign": "top",
    "size": "grow",
    "gap": "M",
    "_children": [
      {
        "_id": "cmp_heading",
        "_component": "@budibase/standard-components/text",
        "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
        "_instanceName": "Heading",
        "_children": [],
        "text": "שלום פוסטגרס",
        "size": "L",
        "bold": true
      },
      {
        "_id": "cmp_baseline_table",
        "_component": "@budibase/standard-components/tableblock",
        "_styles": { "normal": {}, "hover": {}, "active": {}, "selected": {} },
        "_instanceName": "Baseline table",
        "_children": [],
        "dataSource": {
          "type": "query",
          "tableId": "{{ resolved at apply time — baseline query _id }}",
          "label": "Baseline"
        },
        "title": "Baseline rows"
      }
    ]
  }
}
```

## 9. Idempotency contract for apply-fixtures.mjs

- **Match by:** `routing.route` (queries match by `name`).
- **Ignore in diff:** `_id`, `_rev`, `createdAt`, `updatedAt`, `pluginAdded`, and any nested `_id` inside `props._children[...]` that the server may rewrite (NOTE: in the 2026-05-18 probe, server PRESERVED the client-supplied `props._id`. If a future Budibase version rewrites it, the applier diff must normalize before comparing).
- **On exact match:** skip (UNCHANGED).
- **On `route` match + body drift:** call `POST /api/screens` with `_id`+`_rev` from the live copy injected into the payload (server treats this as an update). Log UPDATED.
- **On no `route` match:** call `POST /api/screens` without `_id`+`_rev`. Log CREATED.
- **Never deletes screens.** Manual cleanup happens via the Builder UI or a direct `client.deleteScreen()` call from `dump.mjs`. Auto-delete-not-in-fixtures would conflict with the Builder UI as a legitimate authoring surface for ad-hoc work.

## 10. What this spike did NOT resolve (deferred)

- **RTL theme propagation.** The `customTheme.fontFamily: "inter"` from the workspaceApp probe doesn't include a direction setting. Hebrew strings render but the visual direction comes from Budibase's locale config (TBD; Phase 7 polish). For W1-01, Hebrew strings are inlined and the visual quirks (e.g., LTR-aligned columns when content is RTL) are accepted as Phase 7 scope.
- **`navigationLinkLabel` semantics.** The bundle's `blank$1` factory returns `{ data, navigationLinkLabel }` — i.e., when the Builder UI creates a screen via "New Screen" UX, it ALSO updates the workspaceApp's `navigation.links` array to add an entry. For W1-01, we'll add nav links via a follow-up `client.updateWorkspaceApp()` call after all screens are applied. If the link is omitted, the screen is still reachable via direct URL but doesn't appear in the top-nav menu.
- **PDF screen variant.** Budibase has a `PDFScreen` subclass (bundle idx ~5665776) with `_component: "@budibase/standard-components/pdf"` and `variant: "PDF"`. Not used in W1-01; documented here so W7 (PDF export plans) inherits the pattern.
- **Custom-role permissions.** All Phase 3 W1-W4 screens use the three built-in roles. Custom-role design (e.g., `BASIC` user with extra-scope read access to certain manager-only screens) is Phase 5+ scope.

## 11. References (in-bundle byte offsets — for re-verification on Budibase bumps)

All offsets are into the 7.6 MB minified bundle `/builder/assets/index-BRkMXlAp.js` shipped with Budibase 3.38.4 CE. Re-validate on any version bump.

| Section | Byte offset | Function |
|---|---|---|
| `buildAppEndpoints` | 2151700 | `publishAppChanges`, `getApps`, `getApp`, ... |
| `buildScreenEndpoints` | 2161102 | `saveScreen`, `deleteScreen`, `usageInScreens` |
| `buildWorkspaceAppEndpoints` | 2296262 | workspaceApp CRUD |
| `buildRoleEndpoints` | 2159843 | `getRoles`, `saveRole`, ... |
| `Screen$1` class | 5664832 | The Screen base shape factory |
| `PDFScreen` subclass | 5665776 | PDF screen variant |
| `blank$1` factory | 5666607 | "New blank screen" template (used by Builder UX) |
| Event-handler menu | 2290446 | All `##eventHandlerType` values |
| `isScreenUrlValid` | 5666295 | Route+role+workspaceApp uniqueness check |

---

*Spike completed: 2026-05-18*
*By: 03-W1-01 executor (autonomous via D-09)*
*Method: Bundle inspection (bb-bundle.js from `/builder/assets/index-BRkMXlAp.js`) + live API round-trip on hpg5 against `app_dev_169e766804934fd18f2e20200d8fd22d`*
