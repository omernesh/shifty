# 01 — App schema, pages, menus, `_ref`

The whole Lowdefy app is a single YAML tree rooted at `lowdefy.yaml`. The top-level keys form the app schema.

## Top-level fields

| Field         | Required | Notes                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `lowdefy`     | yes      | Engine version string, e.g. `5.3.0`. Must match installed package.    |
| `name`        | yes      | App name. Shows in browser tab and as a default header.               |
| `version`     | no       | App's own version (separate from engine version).                     |
| `license`     | no       | SPDX identifier or string.                                            |
| `cli`         | no       | CLI overrides — server-directory, log-level, etc.                     |
| `config`      | no       | App-wide settings (e.g., home page id, theme).                        |
| `auth`        | no       | NextAuth + access control (see `08-auth.md`).                         |
| `plugins`     | no       | List of npm plugin packages to load (see `09-plugins.md`).            |
| `types`       | no       | Custom type definitions / aliases.                                    |
| `themes`      | no       | Theme overrides (Ant Design tokens).                                  |
| `connections` | no       | Data sources (see `02-connections.md`).                               |
| `menus`       | no       | Navigation structure.                                                 |
| `pages`       | yes      | The actual app pages.                                                 |

## Minimal valid app

```yaml
lowdefy: 5.3.0
name: shifty

pages:
  - id: home
    type: PageHeaderMenu
    properties:
      title: Home
    blocks:
      - id: hello
        type: Title
        properties:
          content: Hello
```

## Page types

A `page` has `id`, `type`, `properties`, and `blocks` (or `areas` / `slots` for some page types).

- **`PageHeaderMenu`** — most common. Horizontal header bar with the app's menu, content below.
- **`PageSiderMenu`** — vertical sidebar layout.
- **`PageHeaderMenuFloat`** — header floats over content (good for landing pages).
- **`PageWrappers`** — bring-your-own layout; you compose with `Box` blocks.

All page types support optional `auth.public`/`auth.roles` (see `08-auth.md`).

## Block tree

Every page contains a tree of blocks. Each block has `id`, `type`, and most have `properties`, `events`, `style`, `layout`, optionally `requests`, optionally child `blocks`.

```yaml
- id: my_box
  type: Flex
  # 5.3: prefer Flex block for actual flex layout — Box.layout.contentJustify/
  # contentAlign/contentGutter are deprecated in 5.3. Box.layout is silently
  # ignored by the Box renderer; use Flex.properties instead.
  properties:
    justify: center
    gap: small
  style:
    padding: 24
  blocks:
    - id: title
      type: Title
      properties:
        content: Welcome
        level: 2
```

`layout` is grid-based (24-column system, span 1-24). `style` accepts CSS objects.

## Menus

Defined under top-level `menus`. The first menu is the default. Each menu is a tree of `MenuLink` and `MenuGroup`. `pageId` resolves to a page in `pages:`.

```yaml
menus:
  - id: default
    links:
      - id: home_link
        type: MenuLink
        pageId: home
        properties:
          title: Home
          icon: AiOutlineHome
      - id: admin_group
        type: MenuGroup
        properties:
          title: Admin
          icon: AiOutlineSetting
        links:
          - id: employees_link
            type: MenuLink
            pageId: employees
            properties:
              title: Employees
      - id: external
        type: MenuLink
        url: https://example.com
        properties:
          title: External
  - id: minimal
    links:
      - id: home_link
        type: MenuLink
        pageId: home
```

Apply a non-default menu to a specific page by setting the page's `properties.menuId` to the menu's id.

Icons use react-icons names: `AiOutline*`, `Bs*`, `Fa*`, `Md*`, etc. (Visit https://react-icons.github.io/react-icons/ for the catalog.)

## `_ref` — splitting YAML across files

`_ref` is a build-time include. The build pipeline inlines the referenced file at the location of `_ref`. Use it to keep `lowdefy.yaml` short.

```yaml
# lowdefy.yaml
lowdefy: 5.3.0
name: shifty
pages:
  - _ref: pages/home.yaml
  - _ref: pages/employees.yaml
  - _ref:
      path: pages/shift.yaml
      vars:
        page_id: shift_create
        mode: create
  - _ref:
      path: pages/shift.yaml
      vars:
        page_id: shift_edit
        mode: edit
```

In `pages/shift.yaml`:

```yaml
id:
  _var: page_id
type: PageHeaderMenu
properties:
  title:
    _string.concat:
      - 'Shift — '
      - _var: mode
blocks: [...]
```

`_var` reads vars passed via `_ref.vars`. This is how you parameterize reusable page/block fragments.

`_ref` also supports raw text files for SQL/CSV/etc:

```yaml
properties:
  query:
    _ref: queries/list_employees.sql
```

## `config` field

```yaml
config:
  homePageId: home          # which page is at "/"
  basePath: /app            # mount the app at a subpath
  showBuildErrors: false    # hide build errors from end users in production
  theme:
    token:
      colorPrimary: '#1668dc'
```

## `themes` and theme tokens

Lowdefy uses Ant Design v5 tokens. Override globally:

```yaml
config:
  theme:
    token:
      colorPrimary: '#0ea5e9'
      borderRadius: 6
      fontFamily: 'Inter, system-ui, sans-serif'
```

Per-block overrides via the block's `theme` property (block-specific tokens — see `04-blocks-core.md` and `05-blocks-data.md`).

## Validation rules

- Every `id` must be unique within its scope (page-level for pages, block-tree-level for blocks).
- Block ids inside a `List` or `AgGrid` use `$` as the row-index placeholder: `id: row.$`.
- `pageId` in a `MenuLink` must match a `pages[].id`.
- `connectionId` in a request must match a `connections[].id`.
- Plugin types must be declared under `plugins:` AND installed in `package.json`.

## See also

- `02-connections.md` — defining `connections:`
- `04-blocks-core.md` / `05-blocks-data.md` — block reference
- `08-auth.md` — `auth:` top-level field
- `10-deployment.md` — build CLI and what gets emitted under `.lowdefy/server/`
