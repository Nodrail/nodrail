import { DataSource } from "typeorm";
import { dataSourceOptions } from "./src/server/db/options";

// Used only by the migration CLI, connecting as the migration role.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url)
  throw new Error("Set MIGRATION_DATABASE_URL before running migrations");

export default new DataSource({
  ...dataSourceOptions(url),
  migrations: ["src/server/db/migrations/*.ts"],
  migrationsTableName: "nodrail_migrations",
});
