import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "../../scripts/local-stack.mjs";
import { Client } from "pg";

// Every test command runs from apps/web; Playwright loads this as CommonJS.
const web = process.cwd();
const server = "nodrail_local_only@127.0.0.1:54330";

export const testDatabaseUrl = (role: string, database: string) =>
  `postgres://${role}:${server}/${database}`;

const TEST_SERVICE = "postgres-test";

/** Runs `docker compose` here and answers what it printed. */
export type Compose = (args: string[]) => string;

const compose: Compose = (args) =>
  execFileSync("docker", ["compose", ...args], {
    cwd: web,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/**
 * Whether `docker compose ps --format json` shows the test container up and
 * healthy. Compose prints one object per line, older versions one array.
 */
export function testContainerServing(ps: string) {
  const text = ps.trim();
  if (!text) return false;
  const entries: { Service?: string; State?: string; Health?: string }[] =
    text.startsWith("[")
      ? JSON.parse(text)
      : text.split("\n").map((line) => JSON.parse(line));
  return entries.some(
    (entry) =>
      entry.Service === TEST_SERVICE &&
      entry.State === "running" &&
      entry.Health === "healthy",
  );
}

/**
 * The test container, shared by every worktree and person on this machine:
 * left alone while it serves, else started, or created on a cold start. It
 * is never recreated, which would wipe every other suite's database on it.
 */
export function ensureTestContainer(run: Compose = compose) {
  if (testContainerServing(run(["ps", "--format", "json", TEST_SERVICE])))
    return;
  run(["up", "-d", "--wait", "--no-recreate", TEST_SERVICE]);
}

/**
 * The test container and on it a fresh database, migrated as an ordinary
 * owner like a hosted one. A superuser would skip row level security and
 * hide mistakes that matter there.
 */
export async function provisionTestDatabase(database: string, appRole: string) {
  ensureTestContainer();
  await createTestDatabase(database, appRole);
}

/**
 * An explicit NODRAIL_TEST_DATABASE isolates parallel worktrees on the
 * shared test server. Each suite otherwise uses its own default database.
 */
export const testDatabase = (defaultDatabase: string) => {
  const own = process.env.NODRAIL_TEST_DATABASE;
  if (own !== undefined && !/^nodrail_[a-z0-9_]{1,40}$/.test(own))
    throw new Error("NODRAIL_TEST_DATABASE must look like nodrail_<name>");
  const database = own ?? defaultDatabase;
  return { database, appRole: `${database}_app`, own: own !== undefined };
};

export const backendTestDatabase = () => testDatabase("nodrail_test");

/**
 * One database on the running test container, recreated empty and migrated;
 * nothing else on the server changes, so suites using other databases there
 * keep running.
 */
export const testAuthRole = (database: string) => `${database}_auth`;

export async function createTestDatabase(database: string, appRole: string) {
  const admin = new Client({
    connectionString: testDatabaseUrl("postgres", "postgres"),
  });
  await admin.connect();
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_owner') THEN
        CREATE ROLE nodrail_owner LOGIN CREATEROLE PASSWORD 'nodrail_local_only';
      END IF;
    END $$`);
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database} OWNER nodrail_owner`);
  await admin.end();

  runMigrations(testDatabaseUrl("nodrail_owner", database));

  const client = new Client({
    connectionString: testDatabaseUrl("postgres", database),
  });
  await client.connect();
  for (const [login, role] of [
    [appRole, "nodrail_app"],
    [testAuthRole(database), "nodrail_auth"],
  ]) {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${login}') THEN
          CREATE ROLE ${login} LOGIN PASSWORD 'nodrail_local_only' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT ${role} TO ${login};
    `);
  }
  await client.end();
}

/**
 * Reverts every migration from the latest down to and including `name`, on a
 * database at the latest version. Counted from the migration files, so a new
 * migration doesn't change the tests that use this.
 */
export function revertMigrationsThrough(ownerUrl: string, name: string) {
  const files = readdirSync(join(web, "src/server/db/migrations"))
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const at = files.findIndex((file) => file.endsWith(`-${name}.ts`));
  if (at < 0) throw new Error(`No migration named ${name}`);
  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "tests/support/revert-migrations.ts",
      String(files.length - at),
    ],
    { cwd: web, env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl } },
  );
}

/**
 * A database only this call uses, migrated to the latest version, for a
 * test that changes the schema itself: the suite's own database keeps
 * serving the tests running beside it. Dropped afterwards.
 */
export async function withScratchDatabase<T>(
  database: string,
  run: (urls: { owner: string; admin: string }) => Promise<T>,
) {
  const admin = new Client({
    connectionString: testDatabaseUrl("postgres", "postgres"),
  });
  await admin.connect();
  const drop = () =>
    admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  try {
    await drop();
    await admin.query(`CREATE DATABASE ${database} OWNER nodrail_owner`);
    const owner = testDatabaseUrl("nodrail_owner", database);
    runMigrations(owner);
    return await run({ owner, admin: testDatabaseUrl("postgres", database) });
  } finally {
    await drop();
    await admin.end();
  }
}
