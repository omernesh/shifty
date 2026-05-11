# 03 — Requests

A `request` is a server-side operation tied to a `connection`. Define `requests:` either at the page level or on any block.

```yaml
- id: employees_page
  type: PageHeaderMenu
  requests:
    - id: list_employees
      type: KnexRaw
      connectionId: shifts_db
      properties:
        query: SELECT id, name FROM employees ORDER BY name;
```

Trigger it from the block tree via `_request: list_employees` (data) or via the `Request` action in an event handler.

## Request fields

| Field          | Required | Notes                                                          |
| -------------- | -------- | -------------------------------------------------------------- |
| `id`           | yes      | Unique within the page.                                        |
| `type`         | yes      | Must be supported by the connection's type.                    |
| `connectionId` | yes      | Must match a `connections[].id`.                               |
| `payload`      | no       | Object; operators evaluate **on the client** when the request fires. |
| `properties`   | yes      | Connection-specific. Operators evaluate **on the server**. Use `_payload` to access client data. |

### `payload` vs `properties` — critical distinction

- **`payload`** is built on the client every time the request runs. Use `_state`, `_user`, `_input`, etc. here.
- **`properties`** runs on the server. `_secret` works here. `_state` does NOT — server doesn't have the client's state. To pass client values into properties, put them in `payload` and read them via `_payload`.

```yaml
- id: get_employee
  type: KnexRaw
  connectionId: shifts_db
  payload:
    selected_id:
      _state: selected_employee_id
  properties:
    query: SELECT * FROM employees WHERE id = :id
    parameters:
      id:
        _payload: selected_id
```

## Knex requests (SQL)

### `KnexRaw` — raw SQL

```yaml
- id: list_employees
  type: KnexRaw
  connectionId: shifts_db
  properties:
    query: SELECT id, name, email FROM employees ORDER BY name;
```

With named parameters (safer than string concatenation):

```yaml
- id: find_by_name
  type: KnexRaw
  connectionId: shifts_db
  payload:
    q: { _state: search_box }
  properties:
    query: SELECT * FROM employees WHERE name ILIKE :pattern
    parameters:
      pattern:
        _string.concat: ['%', { _payload: q }, '%']
```

Positional parameters (PostgreSQL `?` placeholder, Knex maps them):

```yaml
- id: find_by_name
  type: KnexRaw
  connectionId: shifts_db
  payload:
    q: { _state: search_box }
  properties:
    query: select * from employees where name = ?
    parameters:
      - _payload: q
```

Reference a `.sql` file:

```yaml
- id: list_employees
  type: KnexRaw
  connectionId: shifts_db
  properties:
    query:
      _ref: queries/list_employees.sql
```

### `KnexBuilder` — programmatic query (avoid raw SQL)

```yaml
- id: list_employees
  type: KnexBuilder
  connectionId: shifts_db
  properties:
    query:
      - from: employees
      - select: [id, name, email]
      - where: [active, true]
      - orderBy: name
```

`KnexBuilder.query` is an ordered array; each item is a Knex method as a single-key object whose value is the args. The array form preserves chaining order.

### Other Knex requests

- `KnexInsertOne`, `KnexInsertMany` — for inserts
- `KnexUpdateOne`, `KnexUpdateMany` — for updates
- `KnexDeleteOne`, `KnexDeleteMany` — for deletes
- `KnexCount` — count rows

```yaml
- id: insert_employee
  type: KnexInsertOne
  connectionId: shifts_db
  payload:
    name: { _state: form.name }
    email: { _state: form.email }
  properties:
    table: employees
    data:
      name: { _payload: name }
      email: { _payload: email }
```

## `AxiosHttp` requests

```yaml
- id: get_users
  type: AxiosHttp
  connectionId: my_api
  properties:
    url: /users
    method: GET
```

POST with body:

```yaml
- id: create_user
  type: AxiosHttp
  connectionId: my_api
  payload:
    name: { _state: name_input }
  properties:
    url: /users
    method: POST
    data:
      name: { _payload: name }
```

Dynamic URL:

```yaml
- id: get_posts
  type: AxiosHttp
  connectionId: my_api
  payload:
    user_id: { _state: user_id }
  properties:
    url:
      _string.concat:
        - /users/
        - { _payload: user_id }
        - /posts
```

The full Axios config surface (`params`, `headers`, `timeout`, `responseType`) is available under `properties`.

## MongoDB requests

```yaml
- id: list_tickets
  type: MongoDBFindMany
  connectionId: tickets
  properties:
    query: { status: open }
    options:
      sort: { created_at: -1 }
      limit: 50

- id: get_ticket
  type: MongoDBFindOne
  connectionId: tickets
  payload:
    id: { _state: ticket_id }
  properties:
    query:
      _id: { $oid: { _payload: id } }

- id: create_ticket
  type: MongoDBInsertOne
  connectionId: tickets
  payload:
    doc: { _state: form }
  properties:
    doc:
      _payload: doc
```

Other Mongo request types: `MongoDBInsertMany`, `MongoDBUpdateOne`, `MongoDBUpdateMany`, `MongoDBDeleteOne`, `MongoDBDeleteMany`, `MongoDBAggregation`.

## Triggering requests

### Auto-trigger on page render — `_request` operator

The `_request` operator evaluates the request the first time it appears in the rendered tree and re-evaluates when its `payload` changes:

```yaml
- id: employee_table
  type: AgGridAlpine
  properties:
    rowData:
      _request: list_employees
    columnDefs: [...]
```

### Explicit trigger — `Request` action

```yaml
- id: refresh_button
  type: Button
  events:
    onClick:
      - id: refresh
        type: Request
        params: list_employees     # single request id
```

Multiple requests in sequence:

```yaml
events:
  onClick:
    - id: refresh_all
      type: Request
      params:
        - list_employees
        - count_employees
```

Call every request on the page:

```yaml
events:
  onClick:
    - id: refresh_all
      type: Request
      params:
        all: true
```

### On page load — async vs blocking

- `onInit` runs before the page renders. Use for short, blocking setup. Long requests here delay first paint.
- `onInitAsync` / `onMount` / `onMountAsync` run in parallel with rendering. Use for data fetches.

```yaml
events:
  onMount:
    - id: load_data
      type: Request
      params: { all: true }
```

## Result shape

Each request returns a `response` accessed via `_request`:

```yaml
content:
  _string.concat:
    - 'Total: '
    - _array.length:
        _request: list_employees
```

For KnexRaw on PostgreSQL: `response` is an array of row objects.
For KnexInsertOne / Update / Delete: returns row count or inserted id depending on driver.
For AxiosHttp: returns the response body (parsed JSON by default).
For Mongo Find: array of docs. FindOne: single doc.

## Validation rules

- `type` must be supported by the `connectionId`'s connection type. Mixing types (e.g., `MongoDBFindOne` against a Knex connection) is a build error.
- A request defined on a block is only callable from within that block subtree. Page-level requests are callable from anywhere on the page.
- Request `id` must be unique on a page across all definition scopes.

## See also

- `02-connections.md` — defining the connection
- `06-operators.md` — `_state`, `_payload`, `_request`, `_secret`
- `07-events-and-actions.md` — the `Request` action
