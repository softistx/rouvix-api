# syntax=docker/dockerfile:1.10
# The rouvix-api image: the bundled server (bun run build), non-root, with a
# healthcheck on /ready. Build: `docker build --secret id=npm_read,env=NPM_SOFTISTX_READ_TOKEN -t rouvix-api .`
# The @softistx packages come from npmjs with a read token (BuildKit secret
# npm_read, never baked in). Bun is pinned exactly, with @types/bun's range.

# Runtime dependencies only (the scripts and the bundle's externals need them).
FROM oven/bun:1.4.4 AS prod
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=secret,id=npm_read,env=NPM_SOFTISTX_READ_TOKEN bun install --frozen-lockfile --production --ignore-scripts

# Everything, to generate the GraphQL types and bundle the server. Install
# scripts are skipped: a dev dependency's postinstall (a Redis download) has no
# place in an image.
FROM prod AS build
RUN --mount=type=secret,id=npm_read,env=NPM_SOFTISTX_READ_TOKEN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM oven/bun:1.4.4-slim AS run
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# The bundle holds the server; the scripts (db:sync, db:migrate, admin:create)
# and the SDL the server reads at startup run from the sources, with the
# runtime dependencies, so ship both.
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/bunfig.toml /app/tsconfig.json ./
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=prod --chown=bun:bun /app/node_modules ./node_modules
USER bun
EXPOSE 3000
# Bash only (no Bun process per check): one HTTP/1.0 request on /ready, every 30 s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=3s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PORT:-3000} && printf 'GET /ready HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q ' 200 '"]
CMD ["bun", "dist/server.js"]
