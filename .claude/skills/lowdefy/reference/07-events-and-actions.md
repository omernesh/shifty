# 07 — Events and actions

Blocks expose `events`. An event is a name like `onClick` or `onMount`. The value is either an array of actions or a configured object with `try:` / `catch:` / `debounce:` / `shortcut:`.

## Event schema

```yaml
events:
  onClick: [ action, action, ... ]              # short form
  onChange:                                      # full form
    try:
      - action
      - action
    catch:
      - action
    debounce:
      ms: 300
      immediate: false
    shortcut: ctrl+s                             # or [ ctrl+s, cmd+s ]
```

Actions in `try:` run sequentially. If any action throws, the chain stops and `catch:` runs. `debounce` collapses rapid event fires into one call (default tail-edge; `immediate: true` switches to leading-edge).

## Action shape

```yaml
- id: my_action
  type: <ActionType>
  params: <action-specific>
  if: <bool>                                     # optional — skip if false
  skip: <bool>                                   # alias of !if
  messages:                                       # optional UI feedback
    loading: 'Saving...'
    success: 'Saved'
    error: 'Failed: {{ error.message }}'
```

## Action types

### `Request` — call a request

```yaml
- id: refresh
  type: Request
  params: list_employees                          # single
- id: refresh_many
  type: Request
  params: [list_employees, count_employees]      # multiple
- id: refresh_all
  type: Request
  params: { all: true }                          # everything on the page
```

Returns when all triggered requests complete. Subsequent actions in `try:` wait.

### `Link` — navigate

```yaml
- id: go_home
  type: Link
  params: { pageId: home }

- id: go_with_input
  type: Link
  params:
    pageId: employee_detail
    input: { id: { _state: selected_id } }
    newWindow: false

- id: external
  type: Link
  params:
    url: https://example.com
    newWindow: true

- id: back
  type: Link
  params: { back: true }
```

Available `params` keys: `pageId`, `url`, `input`, `newWindow`, `back`, `pathname` (raw), `query`.

### `Validate` — run form validation

```yaml
- id: validate
  type: Validate
  params: my_form_id                              # validate one block
- id: validate_many
  type: Validate
  params: [field1, field2]
- id: validate_all
  type: Validate                                  # no params = whole page
```

If any validation fails, the action chain stops and `catch:` runs.

### `Reset` — clear input state

```yaml
- id: reset_form
  type: Reset
  params: my_form_id                              # reset one block subtree
- id: reset_all
  type: Reset                                     # whole page
```

### `SetState` — write to state

```yaml
- id: open_modal
  type: SetState
  params:
    show_modal: true
    selected_id: { _state: row.id }
```

Merges into state. To remove keys, set them to `null` and rely on `_if_none` downstream.

### `SetGlobal` — write to cross-page state

```yaml
- id: set_flag
  type: SetGlobal
  params:
    theme: dark
```

### `Login` / `Logout` — NextAuth

```yaml
- id: login
  type: Login
  params:
    providerId: github
    authUrl: /auth/signin
    callbackUrl: /dashboard

- id: logout
  type: Logout
  params:
    callbackUrl: /
```

### `CallMethod` — invoke a block's exposed method

Many blocks expose imperative methods (e.g., `Modal.setOpen`, `Form.submit`, AgGrid's `selectAll`).

```yaml
- id: open
  type: CallMethod
  params:
    blockId: my_modal
    method: setOpen
    args: [true]
```

### `Message` / `Notification` — toast / banner

```yaml
- id: ok
  type: Message
  params:
    type: success                                # success | error | warning | info | loading
    content: Saved
    duration: 2

- id: errored
  type: Notification
  params:
    type: error
    message: Could not save
    description: '{{ error.message }}'
    duration: 4
```

### `ScrollTo`

```yaml
- id: top
  type: ScrollTo
  params:
    blockId: top_of_page                          # or { x, y } or 'top'
    behavior: smooth
```

### `JsAction` — escape hatch

Server-evaluated JS — only available via plugins. Avoid for routine work.

## Built-in events

Pages:

- `onInit` — fires before first render. Blocks rendering. Use for short setup.
- `onInitAsync` — fires before first render. Doesn't block.
- `onMount` — fires after first render.
- `onMountAsync` — same; async-friendly.
- `onEnter` — fires every time the page is entered (including back-nav).
- `onEnterAsync`.
- `onClose` — fires when leaving the page.

Most blocks expose:

- `onClick { x, y }` — for clickable blocks.
- `onChange { value }` — for inputs.
- `onBlur`, `onFocus`, `onPressEnter`.

Block-specific events are listed in each block's reference (see `04-blocks-core.md` and `05-blocks-data.md`).

## Action chaining patterns

### Validate → save → reset

```yaml
events:
  onClick:
    - { id: validate, type: Validate, params: my_form }
    - { id: save, type: Request, params: insert_record }
    - { id: reset, type: Reset, params: my_form }
    - { id: notify, type: Message, params: { type: success, content: Saved } }
    - { id: navigate, type: Link, params: { pageId: list } }
```

If `Validate` fails, none of the following actions run (no save, no reset, no notify).

### Try / catch

```yaml
events:
  onClick:
    try:
      - { id: save, type: Request, params: insert_record }
      - { id: notify, type: Message, params: { type: success, content: Saved } }
    catch:
      - id: oops
        type: Notification
        params:
          type: error
          message: Save failed
          description: '{{ error.message }}'
```

### Conditional actions

```yaml
events:
  onClick:
    - id: validate
      type: Validate
      params: form
    - id: maybe_archive
      type: Request
      params: archive
      if: { _state: should_archive }
    - id: persist
      type: Request
      params: save
```

### Debounce — typeahead

```yaml
events:
  onChange:
    debounce: { ms: 250 }
    try:
      - { id: search, type: Request, params: search_results }
```

### Keyboard shortcut

```yaml
events:
  onClick:
    shortcut: [ctrl+s, cmd+s]
    try:
      - { id: save, type: Request, params: save_record }
```

Shortcuts work even when the bound block isn't focused — they're page-scoped.

## Action error data

Inside `catch:`, the operator `_event` exposes the error: `_event: error.message`, `_event: error.action.id`, `_event: error.action.type`.

```yaml
catch:
  - id: log
    type: Notification
    params:
      type: error
      message:
        _string.concat:
          - 'Action '
          - { _event: error.action.id }
          - ' failed'
      description: { _event: error.message }
```

## See also

- `06-operators.md` — `_event`, `_state` in action params
- `03-requests.md` — what `Request` does
- `08-auth.md` — `Login` / `Logout`
