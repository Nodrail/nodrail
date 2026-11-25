// Self-hosting: provisions the two restricted logins after migrations.
// The server-migrate image runs this as the migration owner.
import pg from "pg";
import { databaseConnection } from "../src/server/db/connection-options.ts";
import { provisionLogin } from "./database-logins.mjs";

const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) throw new Error("Set MIGRATION_DATABASE_URL");
const client = new pg.Client(databaseConnection(owner));
await client.connect();
try {
  await client.query("BEGIN");
  await provisionLogin(
    client,
    process.env.APP_DATABASE_USER || "nodrail_app_login",
    "nodrail_app",
    process.env.APP_DATABASE_PASSWORD ?? "",
  );
  await provisionLogin(
    client,
    "nodrail_auth_login",
    "nodrail_auth",
    process.env.AUTH_DATABASE_PASSWORD ?? "",
  );
  await client.query("COMMIT");
  console.log(
    "Migrations applied; application and authentication logins ready.",
  );
} finally {
  await client.end();
}
