# ─────────────────────────────────────────────────────────────────────────────
#  SRMC Platform — Web Server Dockerfile
#
#  Builds and runs the web server version (apps/web) with its shared packages.
#  Multi-stage build for a slim production image.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ───────────────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# ── Stage 2: build dependencies & frontend ─────────────────────────────────
FROM base AS build

# Install root dependencies (all workspace packages)
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
COPY apps/web/package.json ./apps/web/
RUN npm install

# Copy source
COPY packages/server/ ./packages/server/
COPY packages/client/ ./packages/client/
COPY apps/web/ ./apps/web/

# Build React client
RUN npm run build -w @srmc/client

# ── Stage 3: production runtime ────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
COPY apps/web/package.json ./apps/web/
RUN npm install --omit=dev

# Copy pre-built client dist and server code from build stage
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY --from=build /app/apps/web ./apps/web

# Data directory (SQLite DB + secrets) — mount a volume here
RUN mkdir -p /data

# Environment variables (all optional — sensible defaults in code)
ENV PORT=3001
ENV SRMC_DATA_DIR=/data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

# Start the web server
CMD ["node", "apps/web/index.js"]
