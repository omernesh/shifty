# Lowdefy multi-stage build.
# WIP: this builds successfully and the container boots, but the Next.js
# SSR runtime fails to resolve some hash-suffixed @lowdefy/* internal
# packages (pnpm symlink layout doesn't survive the COPY between stages).
# The build pipeline works; the runtime config needs more investigation —
# either enabling next.config.js `output: standalone` correctly (Next.js
# emits it at a workspace root that's not where we expect), or using
# `--preserve-symlinks` flags, or following Lowdefy's exact published
# Dockerfile pattern. See CLAUDE.md "Open questions" for context.
FROM node:22-bookworm AS builder
WORKDIR /build
# Pin pnpm to 9.x — pnpm 11 refuses to run build scripts for @sentry/cli/sharp
# (which Lowdefy's @lowdefy/server pulls), exits non-zero, and Lowdefy treats
# the whole install as failed. pnpm 9 has the older, lenient default.
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN npx lowdefy build
RUN cd .lowdefy/server && pnpm exec next build

FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY --from=builder /build/.lowdefy/server ./
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
