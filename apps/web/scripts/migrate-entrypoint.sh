#!/bin/sh
set -eu
cd /repo/apps/web
: "${MIGRATION_DATABASE_URL:?Set MIGRATION_DATABASE_URL}"
: "${APP_DATABASE_PASSWORD:?Set APP_DATABASE_PASSWORD}"
: "${AUTH_DATABASE_PASSWORD:?Set AUTH_DATABASE_PASSWORD}"
node --import tsx node_modules/typeorm/cli.js migration:run -d typeorm.config.ts
exec node --import tsx scripts/self-host-bootstrap.mjs
