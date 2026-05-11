# Lowdefy multi-stage build per https://github.com/lowdefy/lowdefy
# Build stage: compile the YAML app into a Next.js standalone server.
FROM node:20-bookworm AS builder
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx lowdefy build

# Runtime stage: just enough to run the standalone Next.js server.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /build/.lowdefy/server/public        ./public
COPY --from=builder /build/.lowdefy/server/.next/standalone ./
COPY --from=builder /build/.lowdefy/server/.next/static  ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
