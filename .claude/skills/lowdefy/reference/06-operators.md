# 06 — Operators

Operators are special YAML keys starting with `_`. They are evaluated at well-defined times. Categories:

| Category | Examples                                  | Evaluation                                          |
| -------- | ----------------------------------------- | --------------------------------------------------- |
| **Build**  | `_ref`, `_var`, `_yaml.parse`            | Build time — when `lowdefy build` runs.            |
| **Server** | `_secret`, `_user`, `_payload`           | At server-side request time.                       |
| **Client** | `_state`, `_input`, `_event`, `_request` | On the client every render (or whenever inputs change). |
| **Shared** | `_eq`, `_and`, `_if`, `_string.*`, `_array.*`, `_object.*`, `_math.*`, `_number.*`, `_nunjucks`, `_format`, `_date`, `_type` | Any context. |

**Critical:** put `_state` in client-side places (block properties, request `payload`). Put `_secret` in server-side places (connection `properties`, request `properties`). Mixing fails silently (operator returns `null`) or with a build error.

## Data lookup operators

### `_state`

Read app state. State is the union of every block's emitted state (TextInput emits its value, Form emits the form object, `SetState` writes arbitrary keys).

```yaml
content: { _state: search_box }              # value of TextInput with id "search_box"
content: { _state: form.name }               # nested
content: { _state: rows.$.title }            # inside a List; "$" is the row index
default_if_missing:
  _state:
    key: optional_field
    default: 'N/A'
```

### `_request`

Read the result of a request defined on the page or an ancestor block. Triggers the request the first time accessed and on `payload` change.

```yaml
rowData: { _request: list_employees }
count: { _array.length: { _request: list_employees } }
total_for_id:
  _request:
    key: get_employee_total
    default: 0
```

### `_user`

Read fields from the logged-in user's id token (NextAuth session). `null` if not logged in.

```yaml
greeting:
  _string.concat: [ 'Hello, ', { _user: name } ]

visible:
  _eq: [ { _user: role }, admin ]

_user: true                                 # entire user object
_user: { key: my_object.subfield }
_user: { key: maybe_missing, default: '' }
```

### `_secret` (server-only)

Resolves to the env var `LOWDEFY_SECRET_<name>` or `<name>` if present. Only valid in server-evaluated positions (connection `properties`, request `properties`).

```yaml
connection:
  connectionString: { _secret: POSTGRES_CONNECTION_STRING }
```

In `.env` (or compose `environment:`):

```
POSTGRES_CONNECTION_STRING=postgresql://...
```

The runtime reads both `LOWDEFY_SECRET_FOO` and `FOO` for `_secret: FOO`.

### `_input`

Inputs passed to a page via URL query (`?id=abc`) or via `Link` action `input:`.

```yaml
properties:
  query: SELECT * FROM employees WHERE id = :id
  parameters:
    id: { _input: id }
```

### `_payload` (server-only)

Inside a request's `properties`, read the request's `payload` (which was built on the client).

```yaml
payload:
  q: { _state: search_box }                 # built on client
properties:
  query: SELECT * FROM t WHERE name = :q
  parameters:
    q: { _payload: q }                      # read on server
```

### `_event`

Inside an action chain, read the event's payload.

```yaml
events:
  onCellValueChanged:
    - id: persist
      type: Request
      params: update_field
  # The Request's payload reads _event:
  # ...
requests:
  - id: update_field
    type: KnexRaw
    payload:
      field: { _event: column.field }
      new_value: { _event: newValue }
      row_id: { _event: data.id }
    properties:
      query: 'UPDATE x SET ?? = :v WHERE id = :id'
      parameters:
        - { _payload: field }
        v: { _payload: new_value }
        id: { _payload: row_id }
```

### `_global`

Cross-page state set via `SetGlobal` action. Persists for the session.

```yaml
visible: { _global: feature_flag_x }
```

### `_var`

Read a `vars:` value passed in via `_ref`.

```yaml
# Caller:
- _ref:
    path: pages/shift.yaml
    vars:
      mode: edit

# pages/shift.yaml:
title:
  _string.concat: [ 'Shift — ', { _var: mode } ]
```

### `_ref`

Build-time include. `_ref: path.yaml` or `_ref: { path, vars }`. See `01-schema-and-app.md`.

## Boolean and comparison operators

```yaml
_eq:      [a, b]
_not_eq:  [a, b]
_gt:      [a, b]
_gte:     [a, b]
_lt:      [a, b]
_lte:     [a, b]
_and:     [a, b, c]
_or:      [a, b]
_not:     bool
_if:      { test: bool, then: x, else: y }
_if_none: [maybe_null, fallback]            # like ??
_type:    value                              # returns 'string'|'number'|...
```

## String / number / array / object / math

These run JS methods. Argument forms vary:

- **No args:** `_math.PI: null` → `3.14159...`
- **Single arg:** `_string.length: 'abc'` → `3`
- **Named-object args:** `_string.repeat: { on: 'ab', count: 3 }` → `'ababab'`
- **Array args:** `_math.max: [1, 5, 3]` → `5`

### `_string.*`

`_string.charAt`, `_string.concat`, `_string.endsWith`, `_string.includes`, `_string.indexOf`, `_string.length`, `_string.lastIndexOf`, `_string.match`, `_string.normalize`, `_string.padEnd`, `_string.padStart`, `_string.repeat`, `_string.replace`, `_string.search`, `_string.slice`, `_string.split`, `_string.startsWith`, `_string.substring`, `_string.toLowerCase`, `_string.toUpperCase`, `_string.trim`, `_string.trimEnd`, `_string.trimStart`.

### `_number.*`

`_number.parseInt`, `_number.parseFloat`, `_number.isFinite`, `_number.isInteger`, `_number.isNaN`, `_number.isSafeInteger`, `_number.toFixed`, `_number.toExponential`, `_number.toPrecision`, `_number.toLocaleString`, `_number.toString`. Constants: `_number.MAX_VALUE`, `_number.MIN_VALUE`, `_number.MAX_SAFE_INTEGER`, `_number.EPSILON`, etc.

### `_array.*`

`_array.concat`, `_array.copyWithin`, `_array.every`, `_array.fill`, `_array.filter`, `_array.find`, `_array.findIndex`, `_array.flat`, `_array.includes`, `_array.indexOf`, `_array.join`, `_array.lastIndexOf`, `_array.length`, `_array.map`, `_array.reduce`, `_array.reduceRight`, `_array.reverse`, `_array.slice`, `_array.some`, `_array.sort`, `_array.splice`.

Callbacks use `_function`:

```yaml
_array.map:
  on: { _request: list_employees }
  callback:
    _function:
      __args: 0
      __return:
        label: { __args: 0.name }
        value: { __args: 0.id }
```

`__args` is the array of callback arguments; `0` is the first one. `__return` is the value to return.

### `_object.*`

`_object.assign`, `_object.defineProperty`, `_object.entries`, `_object.fromEntries`, `_object.keys`, `_object.values`.

### `_math.*`

All `Math.*` methods and constants: `_math.PI`, `_math.E`, `_math.abs`, `_math.ceil`, `_math.floor`, `_math.round`, `_math.max`, `_math.min`, `_math.pow`, `_math.sqrt`, `_math.random`, etc.

## `_date.*`

`_date.now`, `_date.format`, `_date.parse`, `_date.toISOString`. Format strings follow day.js tokens.

```yaml
_date.format:
  on: { _state: shift_start }
  format: 'YYYY-MM-DD HH:mm'
```

## `_format`

Format numbers/dates/strings via a single operator. Backed by Intl + day.js.

```yaml
_format:
  on: 1234.5
  type: number
  format: 'currency'
  options: { currency: USD, locale: en-US }
```

## `_nunjucks`

Inline template engine (Jinja2-like). Most expressive for stringly-typed output.

```yaml
content:
  _nunjucks:
    template: 'Hello {{ name }}, you have {{ rows|length }} item(s).'
    on:
      name: { _user: name }
      rows: { _request: list_things }
```

Supports filters: `default`, `length`, `upper`, `lower`, `replace`, `trim`, `date`, etc.

The `date` filter formats ISO strings: `{{ created_at | date('DD MMM YYYY') }}`.

## `_function`

Define a small inline function (used by `_array.map`, `_array.filter`, AG Grid `cellRenderer`, etc.). The body can be any operator tree.

```yaml
_function:
  __args: 0
  __return:
    _string.concat: ['Row #', { __args: 0.rowIndex }]
```

`__args` accesses the function's positional args by index. `__return` is the expression returned.

For string-returning functions you can pass a `_nunjucks` template directly:

```yaml
cellRenderer:
  _function:
    __nunjucks:
      template: '{{ created_at | date("DD MMM") }}'
      on:
        __args: 0.data
```

## `_js` (server-side)

For escape-hatch JS. Configured via `cli.types` plugins or a plugin package — not enabled by default. Prefer `_function` + the rich operator set.

## Dot notation and `$` indexing

All lookup operators support dot notation for nested fields:

```yaml
_state: form.address.zip
_user: profile.metadata.role
_request: get_employee.email
```

Inside `List` / `AgGrid`-like contexts, `$` is the row index placeholder:

```yaml
_state: rows.$.field
_state: rows.0.field                        # absolute index also OK
```

## See also

- `03-requests.md` — `payload` (client) vs `properties` (server)
- `07-events-and-actions.md` — `_event` operator inside action chains
- `09-plugins.md` — authoring custom operators
