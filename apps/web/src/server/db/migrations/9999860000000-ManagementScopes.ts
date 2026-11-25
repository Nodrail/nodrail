import type { MigrationInterface, QueryRunner } from "typeorm";

const constraint = "personal_access_tokens_scopes";
const table = "nodrail.personal_access_tokens";
const original = ["read", "rules:write", "inventory:write"];
const management = ["agents:manage", "members:manage", "workspace:settings"];

async function replaceConstraint(queryRunner: QueryRunner, scopes: string[]) {
  const allowed = scopes.map((scope) => `'${scope}'`).join(", ");
  await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
  await queryRunner.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${constraint}
     CHECK ("scopes" <@ ARRAY[${allowed}]::text[]
       AND ('read' = ANY ("scopes") OR "scopes" = ARRAY['inventory:write']::text[]))`,
  );
}

export class ManagementScopes9999860000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await replaceConstraint(queryRunner, [...original, ...management]);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `UPDATE ${table} SET scopes = ARRAY(
         SELECT scope FROM unnest(scopes) AS scope WHERE NOT (scope = ANY ($1))
       ) WHERE scopes && $1::text[]`,
      [management],
    );
    await replaceConstraint(queryRunner, original);
  }
}
