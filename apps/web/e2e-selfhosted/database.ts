import { execFileSync } from "node:child_process";

/** psql in the acceptance stack's Postgres, as its superuser. */
export const acceptanceSql = (query: string) =>
  execFileSync(
    "docker",
    [
      "compose",
      "-p",
      process.env.ACCEPTANCE_PROJECT ?? "nodrail-accept",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "nodrail",
      "-tAc",
      query,
    ],
    { cwd: process.env.ACCEPTANCE_DEPLOY, encoding: "utf8" },
  ).trim();

/** The slug of this run's workspace, from its base path `/app/<slug>/<env>`. */
export const workspaceSlug = (base: string) => base.split("/")[2];
