import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Grants the data plane's scopes to every existing host credential:
 * the published policy, recording decided calls, holds, shared budgets and
 * verified evidence. New credentials get them when they are made. Going
 * down takes exactly these away again.
 *
 * Row security on this table is not forced (CredentialLookup lifted it, so
 * the credential lookup can find a workspace): the owner updates it as is,
 * and must not force it again.
 */

const SCOPES = `ARRAY['policy:read', 'decisions:write', 'holds:write', 'budgets:reserve', 'evidence:read']::text[]`;

export class DataPlaneScopes9999500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `UPDATE nodrail.installation_credentials
       SET scopes = ARRAY(SELECT DISTINCT unnest(scopes || ${SCOPES}) ORDER BY 1)`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `UPDATE nodrail.installation_credentials
       SET scopes = ARRAY(SELECT s FROM unnest(scopes) AS s WHERE s <> ALL (${SCOPES}) ORDER BY 1)`,
    );
  }
}
