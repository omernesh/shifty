# 02 — Connections

Connections are top-level data sources. Define under `connections:` in `lowdefy.yaml`. Each connection has `id`, `type`, `properties`. Requests reference connections by `connectionId`.

Connection `properties` operators evaluate **server-side** every time a request is made — `_secret` works here, `_state` does not.

## Shape

```yaml
lowdefy: 5.3.0
connections:
  - id: shifts_db
    type: Knex
    properties:
      client: pg
      connection:
        connectionString:
          _secret: POSTGRES_CONNECTION_STRING
  - id: tickets_api
    type: AxiosHttp
    properties:
      baseURL: https://api.example.com
      headers:
        Authorization:
          _string.concat:
            - 'Bearer '
            - _secret: API_TOKEN
```

## `Knex` (this project uses this)

For all SQL DBs (Postgres, MySQL, MariaDB, MSSQL, Oracle, SQLite, Redshift).

| Property            | Required | Notes                                                                                       |
| ------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `client`            | yes      | `pg` / `postgres` / `postgresql`, `mysql`, `mssql`, `oracledb`, `sqlite3` / `sqlite`, `redshift` |
| `connection`        | yes      | Object **or** string. String form is a connection URL.                                      |
| `searchPath`        | no       | PostgreSQL `search_path`.                                                                   |
| `version`           | no       | DB version hint (for behavior compat).                                                      |
| `useNullAsDefault`  | no       | If true, undefined values become NULL instead of DEFAULT.                                   |

### Postgres — connection string form (what this repo uses)

```yaml
- id: shifts_db
  type: Knex
  properties:
    client: pg
    connection:
      connectionString:
        _secret: POSTGRES_CONNECTION_STRING
```

Set `POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:5432/db` in the env. The container reads it at startup.

### Postgres — object form

```yaml
- id: shifts_db
  type: Knex
  properties:
    client: pg
    connection:
      host: { _secret: PG_HOST }
      port: 5432
      user: { _secret: PG_USER }
      password: { _secret: PG_PASSWORD }
      database: { _secret: PG_DB }
```

### MySQL / MariaDB

```yaml
- id: mysql
  type: Knex
  properties:
    client: mysql
    connection:
      host: { _secret: MYSQL_HOST }
      user: { _secret: MYSQL_USER }
      database: { _secret: MYSQL_DB }
      password: { _secret: MYSQL_PASSWORD }
```

### SQLite

```yaml
- id: sqlite
  type: Knex
  properties:
    client: sqlite
    connection:
      filename: "./mydb.sqlite"
```

The plugin package needed for these is `@lowdefy/connection-knex`. Declare it under `plugins:` AND install in `package.json`.

```yaml
plugins:
  - name: '@lowdefy/connection-knex'
    version: '5.3.0'
```

```json
{ "dependencies": { "@lowdefy/connection-knex": "5.3.0" } }
```

The package bundles drivers for some clients but not all — for `pg`, the Lowdefy server bundles `pg`. For exotic clients like `oracledb` you may need to add the driver explicitly to `dependencies`.

## `AxiosHttp` — REST APIs

```yaml
- id: my_api
  type: AxiosHttp
  properties:
    baseURL: https://api.example.com
    timeout: 10000
    headers:
      Content-Type: application/json
      Authorization:
        _string.concat:
          - 'Bearer '
          - _secret: API_TOKEN
```

Request type for this connection: `AxiosHttp` (see `03-requests.md`).

## `MongoDBCollection` — MongoDB

One connection per collection (collection name is part of the connection, not the request).

| Property       | Required | Notes                                              |
| -------------- | -------- | -------------------------------------------------- |
| `databaseUri`  | yes      | Connection URI. Use `_secret`.                     |
| `databaseName` | no       | Defaults to db in URI.                             |
| `collection`   | yes      | Collection name.                                   |
| `read`         | no       | Default `true`.                                    |
| `write`        | no       | Default `false`. Must enable for inserts/updates.  |
| `options`      | no       | Driver options object.                             |
| `changeLog`    | no       | `{ collection, meta }` — log mutations to another collection. |

```yaml
- id: tickets
  type: MongoDBCollection
  properties:
    databaseUri: { _secret: MONGODB_URI }
    collection: tickets
    write: true
    changeLog:
      collection: tickets_log
      meta:
        user:
          _user: true
```

Request types: `MongoDBFindOne`, `MongoDBFindMany`, `MongoDBAggregation`, `MongoDBInsertOne`, `MongoDBInsertMany`, `MongoDBUpdateOne`, `MongoDBUpdateMany`, `MongoDBDeleteOne`, `MongoDBDeleteMany` (see `03-requests.md`).

## `GoogleSheet` — Google Sheets

One connection per sheet (worksheet). The spreadsheet is treated as row-based; first row is the header.

| Property         | Required | Notes                                                                |
| ---------------- | -------- | -------------------------------------------------------------------- |
| `spreadsheetId`  | yes      | Doc id from the URL.                                                 |
| `sheetId`        | one of `sheetId`/`sheetIndex` | The `gid` from the URL.                              |
| `sheetIndex`     | one of `sheetId`/`sheetIndex` | 0-based tab index.                                  |
| `apiKey`         | for read-only public sheets | A Google Cloud API key.                             |
| `client_email`   | for write / private | Service account email.                                     |
| `private_key`    | for write / private | Service account key (base64-decode if newlines bite). |
| `columnTypes`    | no       | `{ name: string|number|boolean|date|json }` per column.              |
| `read` / `write` | no       | Defaults `true` / `false`.                                           |

```yaml
- id: my_sheet
  type: GoogleSheet
  properties:
    client_email: { _secret: GOOGLE_SHEETS_CLIENT_EMAIL }
    private_key:
      _base64.decode:
        _secret: GOOGLE_SHEETS_PRIVATE_KEY
    spreadsheetId: ubQsWYNGRUq0gFB1sAp2r9oYE19lZ8yGA1T6y0yBoLPW
    sheetId: '1199545345'
    columnTypes:
      name: string
      age: number
      birthday: date
      subscribed: boolean
```

## `AmazonS3` — object storage

```yaml
- id: uploads
  type: AmazonS3
  properties:
    accessKeyId: { _secret: AWS_ACCESS_KEY_ID }
    secretAccessKey: { _secret: AWS_SECRET_ACCESS_KEY }
    region: us-east-1
    bucket: my-bucket
    write: true
    read: true
```

Request types: `AmazonS3PresignedGetObject`, `AmazonS3PresignedPostPolicy`, etc.

## `SendGridMail`, `Mailgun`, `SMTP` — email

```yaml
- id: mailer
  type: SendGridMail
  properties:
    apiKey: { _secret: SENDGRID_API_KEY }
    from: noreply@example.com
```

Request type: `SendGridMailSend` (with `to`, `subject`, `text`, `html`).

## Choosing read vs write

Most connections gate dangerous operations behind explicit `write: true`. Default is read-only. Set `write: true` only when needed; never leak it via env to non-prod.

## Plugin declarations recap

For every connection type used, the plugin package must be declared:

| Connection type             | Plugin package                  |
| --------------------------- | ------------------------------- |
| `Knex`                      | `@lowdefy/connection-knex`      |
| `AxiosHttp`                 | `@lowdefy/connection-axios-http`|
| `MongoDBCollection`         | `@lowdefy/connection-mongodb`   |
| `GoogleSheet`               | `@lowdefy/connection-google-sheets` |
| `AmazonS3`                  | `@lowdefy/connection-amazon-s3` |
| `SendGridMail`              | `@lowdefy/connection-sendgrid-mail` |
| `Mailgun`                   | `@lowdefy/connection-mailgun`   |
| `SMTP`                      | `@lowdefy/connection-smtp`      |
| `Redis`                     | `@lowdefy/connection-redis`     |

The exact package list per Lowdefy version can be confirmed by checking npm for `@lowdefy/connection-*`.

## See also

- `03-requests.md` — request types per connection
- `06-operators.md` — `_secret`, `_base64.decode`, `_string.concat`
- `10-deployment.md` — passing env vars to the container
