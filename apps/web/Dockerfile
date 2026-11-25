# Build from the workspace root. The default target serves the console and API.
# The server-migrate target applies migrations and provisions the restricted app and authentication logins.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS node-base

FROM node-base AS dependencies
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY apps/web/ apps/web/
COPY packages/client/ packages/client/
COPY packages/policy-engine/ packages/policy-engine/
COPY packages/web-shared/ packages/web-shared/
RUN pnpm install --frozen-lockfile --offline --filter @nodrail/web...

FROM dependencies AS server-migrate
WORKDIR /repo/apps/web
USER node
ENTRYPOINT ["/bin/sh", "scripts/migrate-entrypoint.sh"]

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
WORKDIR /repo/apps/web
RUN pnpm exec next build

FROM node-base AS server
WORKDIR /srv
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY apps/web/LICENSE apps/web/NOTICE apps/web/TRADEMARKS.md /usr/share/doc/nodrail/
COPY apps/web/licenses/ /usr/share/doc/nodrail/licenses/
COPY apps/web/scripts/schedule.mjs ./apps/web/scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
WORKDIR /srv/apps/web
CMD ["node", "server.js"]
