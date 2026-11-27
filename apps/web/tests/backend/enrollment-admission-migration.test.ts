import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { expect, test } from "vitest";
import { EnrollmentAndAdmission9999940000000 } from "@/server/db/migrations/9999940000000-EnrollmentAndAdmission";
import {
  backendTestDatabase,
  withScratchDatabase,
} from "../support/local-stack";

test("enrollment migration backfills without a heap rewrite and refuses to discard cancellation or replay state", async () => {
  await withScratchDatabase(
    `${backendTestDatabase().database}_admission`,
    async (urls) => {
      const owner = new DataSource({
        type: "postgres",
        url: urls.owner,
        migrations: [EnrollmentAndAdmission9999940000000],
        migrationsTableName: "nodrail_migrations",
        migrationsTransactionMode: "each",
      });
      const admin = new DataSource({ type: "postgres", url: urls.admin });
      await owner.initialize();
      await admin.initialize();
      const seed = admin.createQueryRunner();
      try {
        const [workspace, environment, agent, installation] = Array.from(
          { length: 4 },
          () => randomUUID(),
        );
        await owner.undoLastMigration();
        await seed.query("SET session_replication_role = replica");
        await seed.query(
          `INSERT INTO nodrail.installations (id, workspace_id, environment_id, agent_id, name, adapter_key)
         VALUES ($1, $2, $3, $4, 'before-migration', 'test')`,
          [installation, workspace, environment, agent],
        );
        const heap = async () => {
          const [row] = await seed.query(
            "SELECT pg_relation_filenode('nodrail.installations')::text AS heap",
          );
          return row.heap as string;
        };
        const before = await heap();
        await owner.runMigrations();
        expect(await heap()).toBe(before);
        const [backfilled] = await seed.query(
          "SELECT admission_key FROM nodrail.installations WHERE id = $1",
          [installation],
        );
        expect(backfilled.admission_key).toMatch(/^[a-f0-9-]{72}$/);
        const [inserted] = await seed.query(
          `INSERT INTO nodrail.installations (workspace_id, environment_id, agent_id, name, adapter_key)
         VALUES ($1, $2, $3, 'after-migration', 'test') RETURNING admission_key`,
          [workspace, randomUUID(), agent],
        );
        expect(inserted.admission_key).toMatch(/^[a-f0-9-]{72}$/);
        expect(inserted.admission_key).not.toEqual(backfilled.admission_key);

        await seed.query(
          "INSERT INTO nodrail.cancelled_enrollment_generations VALUES ($1, $2, $3, $4, 'deadbeef1234')",
          [workspace, environment, randomUUID(), randomUUID()],
        );
        const refuses = () =>
          expect(owner.undoLastMigration()).rejects.toThrow(
            "cancellation fences or pause replay fingerprints exist",
          );
        await refuses();
        expect(
          await seed.query(
            "SELECT generation FROM nodrail.cancelled_enrollment_generations",
          ),
        ).toEqual([{ generation: "deadbeef1234" }]);

        await seed.query(
          "DELETE FROM nodrail.cancelled_enrollment_generations",
        );
        const action = randomUUID();
        await seed.query(
          `INSERT INTO nodrail.action_requests
           (id, workspace_id, installation_id, agent_id, environment_id, idempotency_key,
            tool_key, operation_key, resource_kind, resource_id, permission_fingerprint,
            descriptor_digest, action_digest, initial_policy_version_id, access_epoch,
            initial_evaluation, expires_at, pause_replay_digest)
         VALUES ($1, $2, $3, $4, $5, 'replay', 'test', 'test', 'file', 'a', 'f', 'd', 'a',
           $4, 0, 'denied', now() + interval '1 hour', 'private-replay')`,
          [action, workspace, installation, agent, environment],
        );
        await refuses();
        expect(
          await seed.query(
            "SELECT pause_replay_digest FROM nodrail.action_requests WHERE id = $1",
            [action],
          ),
        ).toEqual([{ pause_replay_digest: "private-replay" }]);
      } finally {
        await seed.release();
        await Promise.all([owner.destroy(), admin.destroy()]);
      }
    },
  );
}, 120_000);
