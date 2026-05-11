# 10 — Deployment, CLI, Docker, env vars

## CLI commands

The Lowdefy CLI is invoked via the `lowdefy` binary that comes with the `lowdefy` package, or via `pnpx lowdefy@<ver>`.

### `lowdefy build`

Compile the YAML config into a Next.js app under `.lowdefy/server/`.

```bash
lowdefy build \
  --config-directory ./ \
  --disable-telemetry \
  --log-level info \
  [--no-next-build] \
  [--ref-resolver path/to/resolver.js] \
  [--server-directory .lowdefy/server] \
  [--skip-codemod-check]
```

- `--no-next-build` — emit Next.js source but skip the Next build. Useful to run `next build` separately with different flags.
- `--ref-resolver` — custom JS resolver for `_ref` (advanced).
- `--server-directory` — change output path (default `.lowdefy/server`).

### `lowdefy dev`

Local development server with file watching.

```bash
lowdefy dev \
  --config-directory ./ \
  --port 3000 \
  --watch ./app \
  --watch-ignore '**/node_modules/**'
```

NOT for production.

### `lowdefy start`

Production server. Run `lowdefy build` first.

```bash
lowdefy start --port 3000 --server-directory .lowdefy/server
```

Equivalent to `cd .lowdefy/server && next start`.

### `lowdefy init`

Bootstrap a new app: `lowdefy init my-app`. Limited use once you have a working repo.

### `lowdefy init-docker`

Generates a Dockerfile based on the app's config. Useful starting point — but the one shipped expects standalone output (see below).

## What `lowdefy build` emits

After `lowdefy build`, the project layout adds:

```
.lowdefy/
  server/
    package.json           # generated, deps for Next + plugins
    pnpm-lock.yaml         # generated
    node_modules/          # pnpm-managed
    next.config.js         # generated
    pages/                 # Next pages router
    public/                # static assets
    .next/                 # next build output (after `next build`)
```

The build executes `next build` automatically unless `--no-next-build`. The generated `node_modules/` uses pnpm's symlink layout (`.pnpm/<hash-suffixed-pkg>/...`).

## Standalone output

Next.js standalone output bundles a minimal runtime under `.next/standalone/`. Lowdefy enables this when env var `LOWDEFY_BUILD_OUTPUT_STANDALONE=1` is set at build time:

```bash
LOWDEFY_BUILD_OUTPUT_STANDALONE=1 lowdefy build
```

This results in:

```
.lowdefy/server/.next/standalone/        # ready-to-ship runtime
.lowdefy/server/.next/static/
.lowdefy/server/public/
```

You can then `node server.js` from `.next/standalone/` directly without `next start`.

**Gotcha:** Next.js detects multiple lockfiles (one at the repo root, one at `.lowdefy/server/`) and emits standalone at the **workspace root**, not at `.lowdefy/server/`. Either delete the outer lockfile before `next build`, or set `outputFileTracingRoot` in the generated `next.config.js`, or just deal with paths shifted up.

## Official Lowdefy Dockerfile (reference)

```dockerfile
FROM node:18-buster AS builder

WORKDIR /lowdefy

COPY . .
ENV LOWDEFY_BUILD_OUTPUT_STANDALONE 1
RUN corepack enable
RUN pnpx lowdefy@4 build --log-level=debug

FROM node:18-alpine AS runner
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
WORKDIR /lowdefy
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 lowdefy
COPY --from=builder --chown=lowdefy:nodejs /lowdefy/.lowdefy/server/public ./public
COPY --from=builder --chown=lowdefy:nodejs /lowdefy/.lowdefy/server/.next/standalone ./
COPY --from=builder --chown=lowdefy:nodejs /lowdefy/.lowdefy/server/.next/static ./.next/static
USER lowdefy
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
```

This requires standalone output to work. **It does not work out of the box** if you have multiple lockfiles (Lowdefy creates an inner one). Either fix the lockfile situation or use the non-standalone variant below.

## What this repo actually uses (non-standalone)

After fighting standalone for hours, this repo uses a non-standalone multi-stage build that preserves the `.lowdefy/server` path in the runtime image:

```dockerfile
FROM node:22-bookworm AS builder
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN npx lowdefy build
RUN cd .lowdefy/server && pnpm exec next build

FROM node:22-bookworm
WORKDIR /build/.lowdefy/server
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY --from=builder /build /build
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
```

**Why the layout matters:** pnpm symlinks in `.lowdefy/server/.next/node_modules/@lowdefy/*` resolve via relative paths like `../../../../../.lowdefy/server/node_modules/.pnpm/...`. From `/app/.next/node_modules/@lowdefy/`, going up 5 dirs hits `/`, then descends into `/.lowdefy/server/...`. If you flatten into `/app/`, that path doesn't exist → `ERR_MODULE_NOT_FOUND`. Preserving `/build/.lowdefy/server` keeps the relative traversal valid.

See commit `b8afba1` for the exact fix.

### pnpm version pinning

Pin pnpm to 9.x via `corepack prepare pnpm@9.15.5 --activate`. pnpm 11 refuses to run build scripts for `@sentry/cli` and `sharp` (which Lowdefy's `@lowdefy/server` pulls), exits non-zero, and Lowdefy treats the whole install as failed. pnpm 9 has the older, lenient default.

### Node version

Stay on `node:22-bookworm`. Don't switch to `node:22-alpine` — musl breaks some Lowdefy native deps (sharp).

Node 20 + pnpm 11 fails with `ERR_UNKNOWN_BUILTIN_MODULE`. Use node 22 if you ever bump pnpm.

## docker-compose (this repo's)

```yaml
services:
  lowdefy:
    build: ./app
    container_name: shifty-lowdefy
    ports:
      - "8080:3000"                     # host:container
    environment:
      POSTGRES_CONNECTION_STRING: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?missing}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-https://apps.nesher.co}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
```

Lowdefy listens on 3000 inside the container. Host port mapping (8080) is whatever you want.

## Env vars Lowdefy cares about

| Var                                 | What                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `NEXTAUTH_SECRET`                   | Required if any auth provider configured.                     |
| `NEXTAUTH_URL`                      | Public app URL. Used in OAuth callback URLs.                  |
| `AUTH_TRUST_HOST`                   | Set `true` if behind a proxy that mangles host headers.       |
| `LOWDEFY_SECRET_<NAME>`             | Resolves `_secret: NAME` at server-side.                      |
| `<NAME>`                            | Falls back to plain env var if `LOWDEFY_SECRET_<NAME>` unset. |
| `LOWDEFY_BUILD_OUTPUT_STANDALONE`   | At build time: emit Next.js standalone bundle.                |
| `LOWDEFY_DISABLE_TELEMETRY`         | `1` to opt out of telemetry.                                  |
| `NEXT_TELEMETRY_DISABLED`           | `1` to opt out of Next.js telemetry.                          |
| `PORT`                              | Server port (default 3000).                                   |
| `HOSTNAME`                          | Bind host (default `0.0.0.0` in containers).                  |
| `NODE_ENV`                          | `production` in deploy images.                                |

## Behind a reverse proxy

- Set `NEXTAUTH_URL` to the **public** URL (`https://apps.nesher.co`), not the internal one.
- The proxy should preserve `Host` and pass `X-Forwarded-Proto: https` (Cloudflare Tunnel does this automatically).
- The proxy should NOT rewrite paths unless you also set `config.basePath` in `lowdefy.yaml`.
- For OAuth providers, the callback URL is `<NEXTAUTH_URL>/api/auth/callback/<provider>`. Register that exact URL with the provider.
- HTTP→HTTPS 301 redirects from Cloudflare convert POST→GET (HTTP spec). Make sure clients always start on HTTPS or you'll lose form bodies on signup/login.

## Hot-reload while debugging on the deploy host

This repo's hpg5 workflow (Windows + Docker Desktop):

```powershell
# Edit app/*.yaml locally, pscp to hpg5
pscp -l claude -pw "Onclaude2103" -batch ^
  -hostkey "SHA256:tPg5mYQbJO/9ccGmNGeyJeQQSPXq+C6SL3EHJcbRZMQ" ^
  -r "C:\Projects\shifts manager\app\." claude@hpg5:C:/shifts-manager/app/

# Rebuild + restart (PsExec required — docker build pulls base images)
plink ... hpg5 "powershell -c \"...psexec -i 1 -u claude -p ... cmd /c 'cd C:\shifts-manager && docker compose build lowdefy > C:\shifts-manager\build.txt 2>&1 && docker compose up -d lowdefy >> ... 2>&1'; Get-Content C:\shifts-manager\build.txt -Tail 30\""
```

See CLAUDE.md for the full PsExec story.

## Troubleshooting

| Symptom                                    | Cause                                                  | Fix                                              |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| `ERR_MODULE_NOT_FOUND @lowdefy/helpers-<hash>` at runtime | pnpm symlinks broken by Docker COPY layout            | Preserve `/build/.lowdefy/server` path in runtime stage (see above) |
| `No version specified`                     | `version:` instead of `lowdefy:`                       | First line must be `lowdefy: 5.3.0`              |
| `Block type "X" not defined`               | Block belongs to a plugin not declared/installed       | Add to `plugins:` AND `package.json`             |
| `Connection type "X" not defined`          | Same — connection's plugin not declared/installed      | Same                                             |
| `ERR_PNPM_IGNORED_BUILDS`                  | pnpm 11 default policy                                  | Pin `pnpm@9.15.5` via `corepack prepare`         |
| `[next-auth][error][NO_SECRET]`            | `NEXTAUTH_SECRET` not set                              | Add to `.env`                                    |
| 401 on every request after login           | `NEXTAUTH_URL` mismatch                                | Set to canonical public URL                      |
| Container starts, healthcheck fails        | App taking >60s to boot                                | Bump `healthcheck.start_period`                  |

## See also

- `01-schema-and-app.md` — `config` field
- `02-connections.md` — `_secret` env var resolution
- `08-auth.md` — `NEXTAUTH_*`
- `09-plugins.md` — `plugins:` declaration
- Project's `app/Dockerfile`, `docker-compose.yml`, `CLAUDE.md`
