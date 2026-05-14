# 05 — Data display blocks (tables, lists, charts, content)

For inputs/forms/layout, see `04-blocks-core.md`.

## `AgGridAlpine` / `AgGridBalham` (this project uses Alpine)

Powerful data grid. `AgGridAlpine` and `AgGridBalham` are two themes of the same block (different visual styling).

Plugin package: `@lowdefy/blocks-aggrid`.

```yaml
plugins:
  - name: '@lowdefy/blocks-aggrid'
    version: '5.3.0'
```

Minimal table:

```yaml
- id: employee_table
  type: AgGridAlpine
  properties:
    rowData:
      _request: list_employees
    columnDefs:
      - field: name
        headerName: Name
      - field: email
        headerName: Email
```

Full-featured table:

```yaml
- id: tickets_table
  type: AgGridAlpine
  properties:
    enableCellTextSelection: true
    pagination: true
    paginationPageSize: 25
    rowData:
      _request: list_tickets
    defaultColDef:
      sortable: true
      resizable: true
      filter: true
      flex: 1
    columnDefs:
      - headerName: Title
        field: ticket_title
        width: 200
        pinned: left
      - headerName: Date
        field: created_at
        width: 140
        cellRenderer:
          _function:
            __nunjucks:
              template: '{{ created_at | date("DD MMM YYYY HH:mm") }}'
              on:
                __args: 0.data
      - headerName: Status
        field: status
        width: 110
        cellStyle:
          _function:
            __args: 0
            __return:
              color:
                _if:
                  test:
                    _eq: [{ __args: 0.value }, open]
                  then: '#52c41a'
                  else: '#999'
      - headerName: Owner
        field: owner_name
        editable: true
  events:
    onRowClicked:
      - id: select_row
        type: SetState
        params:
          selected:
            _event: data
    onCellValueChanged:
      - id: persist
        type: Request
        params: update_ticket_field
```

Key properties:

- `rowData` — array of row objects.
- `columnDefs` — array of column configs (every AG Grid column option is allowed).
- `defaultColDef` — applied to all columns.
- `pagination`, `paginationPageSize`.
- `rowSelection: single | multiple`.
- `enableCellTextSelection: true` — allow text copy.
- `domLayout: autoHeight | normal | print`.
- `getRowId: { _function: ... }` — stable row identity (recommended for editable grids).

Key events:

- `onRowClicked { data, rowIndex }` — **payload shape unverified; use with caution**
- `onSelectionChanged { selectedRows }` — **payload shape unverified; use with caution**
- `onCellValueChanged { data, oldValue, newValue, column.field }` — **payload shape unverified; use with caution**
- `onCellClick { cell: { column, value }, colId, row, rowIndex, selected }` — **verified 2026-05-14**

**IMPORTANT (verified 2026-05-14, Plan 02-09 Task 3 spike):**
- The correct event name is **`onCellClick`** (singular), NOT `onCellClicked`. The events schema is open (patternProperties), so `onCellClicked` does not raise a validator warning — but the handler never registers. This is a silent bug.
- The verified payload paths are: `_event: cell.column` (the column field name), `_event: row.<field>` (any row data field). **NOT** `_event: column.field` or `_event: data.<field>` — those paths are wrong and return undefined silently.

```yaml
events:
  onCellClick:                                # singular, not onCellClicked
    - id: capture
      type: SetState
      params:
        clicked_col: { _event: cell.column }  # column field name
        clicked_id:  { _event: row.id }       # row field
        clicked_name: { _event: row.name }    # row field
```

`cellRenderer` accepts a `_function` operator that returns a string (HTML allowed by default — be careful with untrusted data).

Read AG Grid's official docs for the full column / grid option surface; the Lowdefy block exposes the same surface.

## `AntTable`

Lighter-weight table (uses Ant Design's `<Table>`). Less powerful than AgGrid but simpler config.

```yaml
- id: employees_table
  type: AntTable
  properties:
    dataSource:
      _request: list_employees
    columns:
      - title: Name
        dataIndex: name
        key: name
        sorter: true
      - title: Email
        dataIndex: email
        key: email
    pagination:
      pageSize: 20
      showSizeChanger: true
    rowKey: id
```

## `List`

Vertical list. Children use `$` to template per-row:

```yaml
- id: posts
  type: List
  properties:
    items:
      _request: list_posts
  blocks:
    - id: posts.$ 
      type: Card
      blocks:
        - id: title.$ 
          type: Title
          properties:
            content:
              _state: posts.$.title
            level: 4
        - id: body.$ 
          type: Paragraph
          properties:
            content:
              _state: posts.$.body
```

The `$` is replaced with the row's index. `_state: posts.$` gives the row's data. `_state: posts.$.field` reads a field.

Inside a `List`, the row block id should be `<list_id>.$` (this matters for state addressing). Some block types auto-name; for editable rows use explicit ids.

## `Markdown`

Render markdown. Useful for help text, dynamic content.

```yaml
- id: readme
  type: Markdown
  properties:
    content: |
      ## Welcome
      This is **shifty**, the team shifts manager.
```

For dynamic content:

```yaml
- id: bio
  type: Markdown
  properties:
    content:
      _nunjucks:
        template: |
          ## {{ user.name }}
          Role: {{ user.role }}
        on:
          user:
            _request: get_user
```

## `Html`

Render raw HTML. **Sanitized by default** — XSS-safe.

```yaml
- id: rendered
  type: Html
  properties:
    html:
      _state: rich_text_content
```

Event: `onTextSelection { text }`.

## `Echarts`

ECharts visualizations.

Plugin package: `@lowdefy/blocks-echarts`.

```yaml
- id: shifts_chart
  type: Echarts
  properties:
    option:
      title: { text: Shifts per day }
      tooltip: { trigger: axis }
      xAxis:
        type: category
        data:
          _array.map:
            on: { _request: shifts_by_day }
            callback:
              _function:
                __args: 0
                __return: { __args: 0.day }
      yAxis: { type: value }
      series:
        - type: bar
          data:
            _array.map:
              on: { _request: shifts_by_day }
              callback:
                _function:
                  __args: 0
                  __return: { __args: 0.count }
```

`option` is the standard ECharts option object — see https://echarts.apache.org/en/option.html.

## `Descriptions` (Ant Design key/value display)

```yaml
- id: employee_card
  type: Descriptions
  properties:
    bordered: true
    column: 2
    title: Employee details
    items:
      - label: Name
        children:
          _request: get_employee.name
      - label: Email
        children:
          _request: get_employee.email
      - label: Role
        children:
          _request: get_employee.role
```

## `Result`

Status page (404, 500, success after submit).

```yaml
- id: thanks
  type: Result
  properties:
    title: Thanks!
    subTitle: Your ticket has been submitted.
    status: success
    icon:
      name: AiOutlineCheckCircle
      color: '#52c41a'
  slots:
    extra:
      blocks:
        - id: back
          type: Button
          properties: { title: Back to home }
          events:
            onClick:
              - { id: home, type: Link, params: { pageId: home } }
```

`status: success | info | warning | error | 404 | 403 | 500`.

## `Statistic`

```yaml
- id: total_employees
  type: Statistic
  properties:
    title: Active employees
    value:
      _request: count_active_employees
    prefix:
      name: AiOutlineUser
```

## `Notification` and `Message` (action only)

These are emitted via the `Notification` / `Message` actions in event handlers — they're not blocks. See `07-events-and-actions.md`.

## Slots

Many container blocks expose named slots:

- `Card` — `title`, `extra`, `actions`, `cover`.
- `PageHeaderMenu` — `header`, `content`, `footer`.
- `Modal` — `title`, `footer`, default body.
- `Result` — `extra`.

Use them like this:

```yaml
- id: ticket_card
  type: Card
  slots:
    title:
      blocks: [...]
    extra:
      blocks: [...]
    actions:
      blocks: [...]
  blocks: [...]   # default body slot
```

## See also

- `06-operators.md` — `_request`, `_array.map`, `_function`, `_nunjucks`
- `07-events-and-actions.md` — `onRowClicked`, `SetState`, `Notification`
- `03-requests.md` — `_request` data shape
