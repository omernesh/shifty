# 04 — Core blocks (inputs, forms, layout, buttons)

The everyday building blocks. Data display and visualization blocks (tables, charts, list) are in `05-blocks-data.md`.

Every block has `id`, `type`, and most have `properties`, `events`, `style`, `layout`, `validate`, `required`, `visible`. Child blocks go in `blocks` (or `areas` / `slots` for layout blocks). Block ids must be unique on the page.

## Common cross-block fields

```yaml
- id: my_block
  type: TextInput
  properties:
    title: Name
    placeholder: Enter your name
  required: true                        # adds a required-field validation
  validate:                             # list of test/status pairs
    - status: error
      message: Must be at least 2 chars
      pass:
        _gte:
          - _string.length: { _state: my_block }
          - 2
  visible:                              # show only when condition is true
    _eq: [{ _state: show_name }, true]
  style:
    marginBottom: 16
  layout:
    span: 12                            # 24-column grid
  events:
    onChange:
      - id: log
        type: SetState
        params:
          last_changed: name
```

## Layout: `Flex` (was `Box` with `layout.content*` in 4.x)

> **Lowdefy 5.3 breaking change:** `Box.layout.contentJustify`, `contentAlign`,
> `contentGutter`, `contentWrap` are DEPRECATED and silently ignored by the Box
> renderer. The Box block does not apply flex layout — it is just a plain wrapper.
> Use the **`Flex`** block for actual flex behaviour.

```yaml
# CORRECT (5.3) — Flex block with properties
- id: toolbar
  type: Flex
  properties:
    justify: space-between       # flex justify-content: flex-start | center | space-between | flex-end
    align: center                # flex align-items: flex-start | center | flex-end
    gap: small                   # small | middle | large  (or a number)
    wrap: wrap                   # wrap | nowrap
  style:
    padding: 24
  blocks:
    - id: child_1
      type: Title
      ...

# WRONG (produces no flex layout in 5.3 — contentJustify silently ignored)
- id: toolbar
  type: Box
  layout:
    contentJustify: space-between   # DEPRECATED — ignored by Box renderer in 5.3
    contentAlign: center            # DEPRECATED — ignored
    contentGutter: [16, 16]         # DEPRECATED — ignored
```

`Box` is still valid as a plain container block (no flex). Use `Flex` whenever you need flex behaviour.

## Container blocks

- **`Card`** — bordered card with optional header/footer slots.
  > **GOTCHA (5.3):** `headStyle` and `bodyStyle` are NOT in the 5.3 Card properties whitelist — they are silently ignored. Header text alignment comes from the page-level `dir="rtl"` attribute. Do not add `headStyle: { textAlign: right }`.
- **`Tabs`** — tabbed container; child blocks are tab panels (`Tab` block).
- **`Collapse`** — accordion.
- **`Modal`** — opens via `setOpen` method or `CallMethod` action.
- **`Drawer`** — side panel; same trigger pattern as Modal.
- **`Affix`** — sticky positioning.
- **`Anchor`** — TOC nav.
- **`Spinner`** — loading indicator from plugin `@lowdefy/blocks-loaders`. Properties: `size: small | medium | large`. Must be declared in both `lowdefy.yaml plugins:` AND `package.json dependencies`. No `tip` property — add a separate `Paragraph` block for loading text.
  ```yaml
  # In lowdefy.yaml:
  plugins:
    - name: '@lowdefy/blocks-loaders'
      version: '5.3.0'
  # In app/package.json:
  # "@lowdefy/blocks-loaders": "5.3.0"
  
  # Block usage:
  - id: my_spinner
    type: Spinner
    properties:
      size: large
  ```
  > **`Spin` does not exist in Lowdefy 5.3.** Use `Spinner` from `@lowdefy/blocks-loaders`.

## `Form`

Groups inputs, supports submit + validate. Form state is read via `_state` on the form's id.

```yaml
- id: new_employee_form
  type: Form
  blocks:
    - id: new_employee_form.name
      type: TextInput
      properties: { title: Name }
      required: true
    - id: new_employee_form.email
      type: TextInput
      properties: { title: Email }
      validate:
        - status: error
          message: Must look like an email
          pass:
            _regex:
              on: { _state: new_employee_form.email }
              pattern: '^[^@]+@[^@]+$'
    - id: submit
      type: Button
      properties: { title: Save, type: primary }
      events:
        onClick:
          - id: validate
            type: Validate
            params: new_employee_form
          - id: save
            type: Request
            params: insert_employee
          - id: reset
            type: Reset
            params: new_employee_form
```

The `Validate` action fails the action chain on any error, so the `Request` won't fire if validation fails.

`Reset` clears the form's input state. Use `Reset` action with the form id.

## Text inputs

| Block                | Notes                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `TextInput`          | Single-line string.                                                |
| `TextArea`           | Multi-line string. `properties.autoSize: { minRows, maxRows }`.    |
| `PasswordInput`      | Same as TextInput but masked. Has `visibilityToggle` property.     |
| `NumberInput`        | Numeric. `properties.min`/`max`/`step`/`precision`/`formatter`.    |
| `PhoneNumberInput`   | Country selector + number. State is `{ value, code }`.             |
| `AutoComplete`       | TextInput with dropdown suggestions (`options` array).             |

Shared properties: `title`, `placeholder`, `disabled`, `prefix`, `prefixIcon`, `suffix`, `suffixIcon`, `size` (`small`/`middle`/`large`), `variant` (`outlined`/`filled`/`borderless`), `allowClear`, `maxLength`, `showCount`.

Shared events: `onChange { value }`, `onBlur`, `onFocus`, `onPressEnter`, `onInputChange`.

```yaml
- id: search
  type: TextInput
  properties:
    title: Search
    placeholder: Type to filter
    allowClear: true
    prefixIcon: AiOutlineSearch
  events:
    onChange:
      type: Request
      params: search_results
```

## Selectors (single + multi)

| Block                | Notes                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `Selector`           | Single-select dropdown.                                            |
| `MultipleSelector`   | Multi-select with tags. Use `renderTags: true` for chip rendering. |
| `ButtonSelector`     | Radio-button-style group.                                          |
| `CheckboxSelector`   | Multi-select via checkboxes.                                       |
| `RadioSelector`      | Radio button group.                                                |

> **`TagSelector` does not exist in Lowdefy 5.3.** The build error is `[ConfigError] Block type "TagSelector" was used but is not defined. Did you mean "DateSelector"?`. Use `MultipleSelector` instead — it supports `renderTags: true` for chip-style rendering.

Options can be a flat array or an array of objects:

```yaml
- id: ticket_type
  type: Selector
  properties:
    title: Type
    options:
      - Suggestion
      - Complaint
      - Question
```

```yaml
- id: employee
  type: Selector
  properties:
    title: Employee
    options:
      _array.map:
        on: { _request: list_employees }
        callback:
          _function:
            __args: 0
            __return:
              label: { __args: 0.name }
              value: { __args: 0.id }
```

## Booleans and switches

- `Switch` — on/off toggle. State is boolean.
- `Checkbox` — checkbox with label. State is boolean.

## Date / time

- `DateSelector` — picks a date. `format`, `picker` (`date`|`week`|`month`|`quarter`|`year`).
- `DateRangeSelector` — picks two dates. State is `[start, end]`.
- `DateTimeSelector` — date + time.
- `TimeSelector` — time-only.

```yaml
- id: shift_date
  type: DateSelector
  properties:
    title: Date
    picker: date
    format: YYYY-MM-DD
```

State is an ISO datetime string. Format with `_date.format` (see `06-operators.md`).

## File upload

- `S3UploadButton`, `S3UploadDragger` — upload to S3 (requires `AmazonS3` connection).
- `Upload` — generic upload that posts to a request.

## `Button`

```yaml
- id: save_btn
  type: Button
  layout:
    span: 12
  properties:
    title: Save
    type: primary                       # primary | default | dashed | text | link
    icon: AiOutlineSave
    block: true                         # fill parent width
    size: large                         # small | middle | large
    danger: false
    loading:
      _state: saving
    disabled:
      _not: { _state: form_valid }
  events:
    onClick: [...]
```

## Display blocks (text)

- `Title` — `level: 1..5` (h1..h5).
- `Paragraph` — `type: secondary | success | warning | danger`, `content` (supports markdown if `markdown: true`).
- `Text` — inline text.
- `Tag` — colored tag chip. `color: blue | green | red | ...` or hex.
- `Avatar` — user/entity avatar; supports `src`, `icon`, `text`.
- `Alert` — banner. `type: success | info | warning | error`.

## Icons

`Icon` block + the `icon` / `prefixIcon` / `suffixIcon` properties accept either a string (react-icons name) or an object:

```yaml
icon:
  name: AiOutlineHeart
  color: '#f00'
  size: 24
```

Browse icons at https://react-icons.github.io/react-icons/.

## Validation patterns

```yaml
required: true
validate:
  - status: error
    message: Required
    pass:
      _not_null: { _state: my_input }
  - status: error
    message: At least 8 chars
    pass:
      _gte:
        - _string.length: { _state: password }
        - 8
  - status: warning
    message: Looks too short to be a real address
    pass:
      _gte:
        - _string.length: { _state: address }
        - 10
```

Validation is gated by the `Validate` action — it doesn't fire continuously. If you want live feedback, set the form's `validateOn: change` (when supported) or use a custom display block bound to `_state`.

## Visibility and conditional rendering

`visible: <boolean operator>` removes the block from the DOM when false. To merely disable, use `disabled` (where supported).

```yaml
visible:
  _and:
    - { _state: show_advanced }
    - { _eq: [{ _user: role }, admin] }
```

## See also

- `05-blocks-data.md` — tables, lists, charts
- `06-operators.md` — `_state`, `_gte`, `_regex`, `_function`, `_array.map`
- `07-events-and-actions.md` — `Validate`, `Reset`, `SetState`, `Request`
