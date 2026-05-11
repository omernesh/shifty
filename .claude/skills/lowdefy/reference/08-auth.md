# 08 — Authentication and authorization

Lowdefy bakes in Auth.js (NextAuth). 75+ providers (Google, GitHub, Azure AD, Okta, magic-link email, Credentials, etc.). Auth wraps the whole app — pages can be public, protected (logged-in required), or role-gated.

## Required env vars

```
NEXTAUTH_SECRET=<32-byte base64 string>     # openssl rand -base64 32
NEXTAUTH_URL=https://apps.example.com       # canonical app URL; used for callback URLs
```

Set these in `.env` and pass into the container via `docker-compose.yml`. Lowdefy fails to start without `NEXTAUTH_SECRET` if any auth provider is configured.

## Top-level `auth:` config

```yaml
lowdefy: 5.3.0

auth:
  pages:
    protected: true                          # whole app behind login by default
    public:
      - login
      - '404'
    roles:                                   # role → allowed pageIds
      admin:
        - admin_dashboard
        - manage_users
      manager:
        - reports
        - team_overview
  api:                                       # protect API endpoints similarly
    protected: true
    public:
      - health_check
    roles:
      admin:
        - admin_api
  providers:
    - id: github
      type: GitHubProvider
      properties:
        clientId: { _secret: GITHUB_CLIENT_ID }
        clientSecret: { _secret: GITHUB_CLIENT_SECRET }
    - id: credentials
      type: CredentialsProvider
      properties:
        name: Credentials
        credentials:
          email: { type: text, label: Email }
          password: { type: password, label: Password }
  callbacks:
    - id: add_role
      type: SignInCallback
      properties:
        # ... server-side callback to enrich the session
  session:
    strategy: jwt                            # or "database" with an adapter
    maxAge: 2592000                          # 30 days
  pages:
    signIn: /login                           # custom sign-in page route
```

## `auth.pages` — page-level gates

| Key                  | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `protected: true`    | Default: all pages require login. Pages in `public:` are exceptions.       |
| `protected: false`   | Default: all pages are public. Pages NOT in `public:` are still public.    |
| `public: [...]`      | Always-public page ids.                                                    |
| `roles: { name: [...]}` | Only listed roles can access these pages. Implies `protected: true` for them. |

`auth.api` mirrors `auth.pages` for the API surface (request endpoints).

## Providers

Each provider has `id`, `type`, `properties`. `type` is one of the NextAuth provider plugin names — e.g., `GoogleProvider`, `GitHubProvider`, `AzureADProvider`, `EmailProvider` (magic link), `CredentialsProvider` (custom username/password), `OktaProvider`, plus 70+ more.

### `GoogleProvider`

```yaml
- id: google
  type: GoogleProvider
  properties:
    clientId: { _secret: GOOGLE_CLIENT_ID }
    clientSecret: { _secret: GOOGLE_CLIENT_SECRET }
    authorization:
      params:
        prompt: select_account
        scope: openid email profile
```

OAuth callback URL is `<NEXTAUTH_URL>/api/auth/callback/google`. Register that in Google Cloud Console.

### `EmailProvider` — magic links

```yaml
- id: email
  type: EmailProvider
  properties:
    server:
      host: smtp.sendgrid.net
      port: 587
      auth:
        user: apikey
        pass: { _secret: SENDGRID_API_KEY }
    from: noreply@example.com
```

Requires a database adapter (see below) to persist the magic tokens.

### `CredentialsProvider` — username/password

```yaml
- id: credentials
  type: CredentialsProvider
  properties:
    credentials:
      email: { type: text, label: Email }
      password: { type: password, label: Password }
    authorize:
      # Server function — verify creds, return a user object or null
      _function:
        __args: 0
        __return:
          # ... your check
```

Auth.js' `authorize` is JS — for Lowdefy, you usually implement this in a plugin (see `09-plugins.md`).

## Adapter (database session storage)

For `EmailProvider` and persistent sessions, configure a NextAuth adapter:

```yaml
auth:
  adapter:
    type: KnexAdapter                         # plugin-provided
    properties:
      connectionId: shifts_db
```

Adapters write to dedicated tables (users, accounts, sessions, verification_tokens). Their schemas come with the adapter — apply them as a migration once.

## `Login` and `Logout` actions

From a block's event:

```yaml
events:
  onClick:
    - id: login
      type: Login
      params:
        providerId: google
        callbackUrl: /dashboard
```

```yaml
events:
  onClick:
    - id: logout
      type: Logout
      params:
        callbackUrl: /
```

If you don't specify `providerId`, the user lands on the NextAuth provider-selection page.

## `_user` operator

Inside the app, the logged-in user is exposed via `_user`. Available in client AND server contexts.

```yaml
visible:
  _eq: [ { _user: role }, admin ]

content:
  _string.concat: [ 'Hello ', { _user: name } ]

# Server-side in request payload:
properties:
  query: SELECT * FROM employees WHERE created_by = :u
  parameters:
    u:
      _payload: actor_id
payload:
  actor_id: { _user: sub }                   # NextAuth subject claim
```

Standard fields (depend on provider): `name`, `email`, `image`, `sub`, `role` (if your callback adds it). For OpenID Connect providers, the entire id-token is exposed.

## Adding `role` to the session

NextAuth's session by default has `{ user: { name, email, image } }`. To add a role, customize the `session` callback:

```yaml
auth:
  callbacks:
    - id: session
      type: SessionCallback
      properties:
        # Server function — read token/db, write into session.user
        _function:
          __args: 0
          __return:
            session:
              user:
                role: { __args: 0.token.role }
                sub:  { __args: 0.token.sub }
```

For non-trivial logic, write a plugin and reference it (see `09-plugins.md`).

## Roles in `auth.pages.roles`

```yaml
auth:
  pages:
    protected: true
    public: [login, '404']
    roles:
      admin:
        - settings
        - manage_users
      employee:
        - my_shifts
        - clock_in
```

A user can have multiple roles — Lowdefy unions the allowed pages. The `_user: role` field can be a string or an array; the gate matches if any user role is in the page's roles.

## Public landing + protected app

Common pattern: keep `/` public, gate everything else.

```yaml
auth:
  pages:
    protected: true
    public:
      - home                                  # landing page
      - login
      - '404'
```

## Sign-in UI

Auth.js ships a default `/api/auth/signin` page that lists providers. To customize, build a `login` page with your branding and use a `Login` action button per provider.

## Behind a reverse proxy

Set `NEXTAUTH_URL` to the **public** URL (HTTPS), not the internal LAN address. For this repo: `NEXTAUTH_URL=https://apps.nesher.co`. If you set it to `http://hpg5:8080`, callback URLs break for external users.

Also set `AUTH_TRUST_HOST=true` if the proxy strips/changes host headers (Cloudflare Tunnel doesn't, but some proxies do).

## Common errors

- **`[next-auth][error][NO_SECRET]`** — `NEXTAUTH_SECRET` missing.
- **Redirect loop on login** — `NEXTAUTH_URL` doesn't match the URL users actually hit. Fix it to the public canonical URL.
- **`CallbackRouteError`** — provider's redirect URI not registered with the provider's app config.
- **All pages 404 after enabling auth** — every page is now protected; you forgot to add a `login` page to `public:`.

## See also

- `01-schema-and-app.md` — top-level `auth:` placement
- `06-operators.md` — `_user`, `_secret`
- `09-plugins.md` — authoring custom auth callbacks/providers
- `10-deployment.md` — `NEXTAUTH_*` env vars
