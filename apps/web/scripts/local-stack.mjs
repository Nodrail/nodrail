// Shared by local setup, seeding and tests. Local services only.
import { execFileSync } from "node:child_process";

/** Applies migrations as the given owner, exactly as a deployment would. */
export function runMigrations(ownerUrl, stdio = "pipe") {
  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "node_modules/typeorm/cli.js",
      "migration:run",
      "-d",
      "typeorm.config.ts",
    ],
    {
      env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
      stdio,
    },
  );
}
