# Lowdefy multi-stage build.
#
# Why the runtime stage copies the entire /build tree (not just .lowdefy/server):
# Lowdefy's `npx lowdefy build` produces a Next.js app under .lowdefy/server/
# with a pnpm symlink layout. The Next.js build externalizes hash-suffixed
# Lowdefy internal packages into .lowdefy/server/.next/node_modules/@lowdefy/
# (e.g. `helpers-f4b7b5506784a410`) as symlinks that point UP five levels and
# then back into `.lowdefy/server/node_modules/.pnpm/...`. Those symlinks
# require the ORIGINAL absolute path layout (i.e. a `/build/.lowdefy/server/`
# style nesting) to resolve. If we copy only the contents of .lowdefy/server
# to /app, the `../../../../..` traversals dangle and Next.js SSR fails with
# `ERR_MODULE_NOT_FOUND: @lowdefy/helpers-<hash>`.
#
# Fix: preserve /build at /build in the runtime image, run next start from
# /build/.lowdefy/server. The path layout above the working dir matters.
FROM node:22-bookworm AS builder
WORKDIR /build
# Pin pnpm to 9.x — pnpm 11 refuses to run build scripts for @sentry/cli/sharp
# (which Lowdefy's @lowdefy/server pulls), exits non-zero, and Lowdefy treats
# the whole install as failed. pnpm 9 has the older, lenient default.
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
# Copy package manifests and local plugin sources before install.
# pnpm-workspace.yaml is intentionally excluded via .dockerignore so that
# Lowdefy's inner @lowdefy/server pnpm install (cwd .lowdefy/server/) doesn't
# enter workspace mode, which previously caused a 2.5-hour hang and hoisting
# issues. The plugin is referenced via file: protocol in package.json and
# lowdefy.yaml instead of workspace:*.
COPY package.json pnpm-lock.yaml* ./
COPY plugins/ ./plugins/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN npx lowdefy build
RUN cd .lowdefy/server && pnpm exec next build

FROM node:22-bookworm
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
# Preserve the original /build path so the relative ../../../../.. symlinks
# under .lowdefy/server/.next/node_modules/@lowdefy/*-<hash> still resolve.
COPY --from=builder /build /build
WORKDIR /build/.lowdefy/server
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
