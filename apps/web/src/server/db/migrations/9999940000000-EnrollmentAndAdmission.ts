import type { MigrationInterface, QueryRunner } from "typeorm";

const keyDefault = "concat(gen_random_uuid(), gen_random_uuid())";

async function bounded(runner: QueryRunner, work: () => Promise<void>) {
  await runner.startTransaction();
  try {
    await runner.query("SET LOCAL lock_timeout = '3s'");
    await work();
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  }
}

export class EnrollmentAndAdmission9999940000000 implements MigrationInterface {
  // Use separate transactions so the table lock is released before the backfill.
  transaction = false;

  async up(runner: QueryRunner) {
    await bounded(runner, async () => {
      await runner.query(`
        ALTER TABLE nodrail.installations ADD COLUMN IF NOT EXISTS admission_key text;
        ALTER TABLE nodrail.installations ALTER COLUMN admission_key SET DEFAULT ${keyDefault};
        DROP POLICY IF EXISTS admission_key_backfill ON nodrail.installations;
        CREATE POLICY admission_key_backfill ON nodrail.installations
          TO CURRENT_USER USING (true) WITH CHECK (true);
      `);
    });

    let after: string | null = null;
    do {
      const cursor = after;
      await bounded(runner, async () => {
        const [batch]: { last: string | null }[] = await runner.query(
          `WITH batch AS (
             SELECT id FROM nodrail.installations
             WHERE admission_key IS NULL AND ($1::uuid IS NULL OR id > $1)
             ORDER BY id LIMIT 1000
           ), filled AS (
             UPDATE nodrail.installations i SET admission_key = ${keyDefault}
             FROM batch WHERE i.id = batch.id AND i.admission_key IS NULL RETURNING i.id
           ) SELECT (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last FROM (SELECT count(*) FROM filled) done`,
          [cursor],
        );
        after = batch?.last ?? null;
      });
    } while (after);

    await bounded(runner, async () => {
      await runner.query(`
        DROP POLICY admission_key_backfill ON nodrail.installations;
        ALTER TABLE nodrail.installations DROP CONSTRAINT IF EXISTS admission_key_populated;
        ALTER TABLE nodrail.installations ADD CONSTRAINT admission_key_populated
          CHECK (admission_key IS NOT NULL) NOT VALID;
      `);
    });
    await bounded(runner, async () => {
      await runner.query(`
        ALTER TABLE nodrail.installations VALIDATE CONSTRAINT admission_key_populated
      `);
    });
    await bounded(runner, async () => {
      await runner.query(`
        ALTER TABLE nodrail.installations ALTER COLUMN admission_key SET NOT NULL;
        ALTER TABLE nodrail.installations DROP CONSTRAINT admission_key_populated;
      `);
    });
    await bounded(runner, async () => {
      await runner.query(`
        ALTER TABLE nodrail.action_requests ADD COLUMN IF NOT EXISTS pause_replay_digest text;
        CREATE TABLE IF NOT EXISTS nodrail.cancelled_enrollment_generations (
          workspace_id uuid NOT NULL,
          environment_id uuid NOT NULL,
          project_id uuid NOT NULL,
          machine_id uuid NOT NULL,
          generation text NOT NULL,
          CONSTRAINT cancelled_enrollment_generation_pk PRIMARY KEY
            (workspace_id, environment_id, project_id, machine_id, generation)
        );
        ALTER TABLE nodrail.cancelled_enrollment_generations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE nodrail.cancelled_enrollment_generations FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant ON nodrail.cancelled_enrollment_generations;
        CREATE POLICY tenant ON nodrail.cancelled_enrollment_generations TO nodrail_app
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id());
        GRANT SELECT, INSERT ON nodrail.cancelled_enrollment_generations TO nodrail_app;
      `);
    });
  }

  async down(runner: QueryRunner) {
    await bounded(runner, async () => {
      // Expose all tenants to the owner inside this transaction and block
      // concurrent writes until rollback or the schema change commits.
      await runner.query(`
        ALTER TABLE nodrail.cancelled_enrollment_generations NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE nodrail.action_requests NO FORCE ROW LEVEL SECURITY;
        DO $$ BEGIN
          IF EXISTS (SELECT FROM nodrail.cancelled_enrollment_generations)
            OR EXISTS (SELECT FROM nodrail.action_requests WHERE pause_replay_digest IS NOT NULL)
          THEN
            RAISE EXCEPTION 'Cannot revert enrollment and admission: cancellation fences or pause replay fingerprints exist.';
          END IF;
        END $$;
        DROP TABLE nodrail.cancelled_enrollment_generations;
        ALTER TABLE nodrail.action_requests DROP COLUMN pause_replay_digest;
        ALTER TABLE nodrail.action_requests FORCE ROW LEVEL SECURITY;
        ALTER TABLE nodrail.installations DROP COLUMN admission_key;
      `);
    });
  }
}
