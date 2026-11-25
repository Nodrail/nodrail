import { execFileSync } from "node:child_process";
import { appTestDatabase } from "./environment";
import {
  createTestDatabase,
  provisionTestDatabase,
} from "../tests/support/local-stack";

export default async function setup() {
  const { database, appRole, own } = appTestDatabase();
  if (own) await createTestDatabase(database, appRole);
  else await provisionTestDatabase(database, appRole);
  execFileSync("pnpm", ["--filter", "@nodrail/client", "build"], {
    stdio: "ignore",
  });
}
