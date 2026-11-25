#!/bin/sh
# First start only: the database and its owner, who runs the migrations and
# may create the app's roles. The app itself never connects as the owner.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --set owner_password="$NODRAIL_OWNER_PASSWORD" <<'SQL'
CREATE ROLE nodrail_owner LOGIN CREATEROLE PASSWORD :'owner_password';
CREATE DATABASE nodrail OWNER nodrail_owner;
SQL
