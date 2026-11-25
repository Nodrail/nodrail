import { expect, test } from "vitest";
import { DataSource } from "typeorm";
import { BuiltInLogin9999810000000 } from "@/server/db/migrations/9999810000000-BuiltInLogin";
import { dataSourceOptions } from "@/server/db/options";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";

test("the login migration reverts and reapplies with suspended emails reserved", async () => {
  await withScratchDatabase(
    `${backendTestDatabase().database}_login`,
    async ({ owner }) => {
      revertMigrationsThrough(owner, "BuiltInLogin");
      const source = await new DataSource(
        dataSourceOptions(owner),
      ).initialize();
      const migration = new BuiltInLogin9999810000000();
      const migrate = () =>
        source.transaction(async (manager) => {
          if (!manager.queryRunner) throw new Error("Expected a transaction");
          await migration.up(manager.queryRunner);
        });

      try {
        const [{ id }] = await source.query(
          `INSERT INTO nodrail.users (display_name, verified_email, status)
           VALUES ('Suspended', ' Person@Example.test ', 'suspended') RETURNING id`,
        );
        await source.query(
          `INSERT INTO nodrail.users (display_name, verified_email)
           VALUES ('Active', 'person@example.test')`,
        );
        await expect(migrate()).rejects.toMatchObject({
          driverError: { code: "23505", constraint: "login_accounts_email" },
        });
        await source.query(
          "UPDATE nodrail.users SET verified_email = 'other@example.test' WHERE id <> $1",
          [id],
        );
        runMigrations(owner);
        await expect(
          source.query(
            "SELECT email, password_hash FROM nodrail.login_accounts WHERE user_id = $1",
            [id],
          ),
        ).resolves.toEqual([
          { email: "person@example.test", password_hash: null },
        ]);
      } finally {
        await source.destroy();
      }
    },
  );
});
