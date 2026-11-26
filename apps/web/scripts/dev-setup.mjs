// Brings up everything needed to run the product locally. Safe to run again.
import { execFileSync } from "node:child_process";
import pg from "pg";
import { seedEnv } from "./dev-env.mjs";
import { runMigrations } from "./local-stack.mjs";

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });

run("docker", ["compose", "up", "-d", "--wait", "postgres", "mailpit"]);

const server = "nodrail_local_only@127.0.0.1:54329";
const url = (role, database) => `postgres://${role}:${server}/${database}`;
const owner = url("nodrail_owner", "nodrail_dev");

const admin = new pg.Client({ connectionString: url("postgres", "postgres") });
await admin.connect();
const exists = async (sql, value) =>
  (await admin.query(sql, [value])).rowCount > 0;
if (
  !(await exists("SELECT 1 FROM pg_roles WHERE rolname = $1", "nodrail_owner"))
)
  await admin.query(
    "CREATE ROLE nodrail_owner LOGIN CREATEROLE PASSWORD 'nodrail_local_only'",
  );
if (process.argv.includes("--reset"))
  await admin.query("DROP DATABASE IF EXISTS nodrail_dev WITH (FORCE)");
if (
  !(await exists("SELECT 1 FROM pg_database WHERE datname = $1", "nodrail_dev"))
)
  await admin.query("CREATE DATABASE nodrail_dev OWNER nodrail_owner");

runMigrations(owner, "inherit");

for (const role of ["app", "auth"]) {
  const login = `nodrail_dev_${role}`;
  if (!(await exists("SELECT 1 FROM pg_roles WHERE rolname = $1", login)))
    await admin.query(
      `CREATE ROLE ${login} LOGIN PASSWORD 'nodrail_local_only' NOSUPERUSER NOBYPASSRLS`,
    );
  await admin.query(`GRANT nodrail_${role} TO ${login}`);
}
await admin.end();

const wanted = {
  DATABASE_URL: url("nodrail_dev_app", "nodrail_dev"),
  AUTH_DATABASE_URL: url("nodrail_dev_auth", "nodrail_dev"),
  MIGRATION_DATABASE_URL: owner,
  APP_ORIGIN: "http://127.0.0.1:3100",
  SMTP_URL: "smtp://127.0.0.1:55325",
  SMTP_PLAINTEXT_HOST: "127.0.0.1",
  NOTIFICATIONS_FROM: '"Nodrail <notifications@nodrail.test>"',
  NOTIFICATIONS_SECRET: "local-dev-only",
  // The local stand-in. Replace these four with Stripe test keys when you have them.
  STRIPE_API_BASE: "http://127.0.0.1:12111",
  STRIPE_SECRET_KEY: "sk_test_local_stand_in",
  STRIPE_WEBHOOK_SECRET: "whsec_local_stand_in",
  STRIPE_PRICE_PRO: "price_local_pro",
};
seedEnv(".env.local", wanted);

// Local only; a checkout without the hooks still works.
try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: "../..",
    stdio: "ignore",
  });
} catch {
  console.warn("Git hooks not enabled: this is not a git checkout.");
}

console.log(`\nReady. Sign-in emails arrive at http://127.0.0.1:55324`);
