import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Briefs and connection inputs and results: a mediated call's
 * execution may be `not-called` (the input never reached the provider), and
 * a result records whether it was delivered downstream, apart from whether
 * it conformed. Only a captured, valid result can be delivered; a call that
 * wasn't made captured no result. Existing rows already satisfy both, so
 * nothing is rewritten. Going down fails loudly if a `not-called` row exists.
 */
const EXECUTION = {
  up: `"execution" IS NULL OR ("surface" = 'tool_result' AND "execution" IN ('succeeded', 'failed', 'not-called', 'unknown') AND ("execution" <> 'not-called' OR "capture" <> 'captured'))`,
  down: `"execution" IS NULL OR ("surface" = 'tool_result' AND "execution" IN ('succeeded', 'failed', 'unknown'))`,
};

export class ContractExchanges9998800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD "delivered" boolean`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_execution"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_execution" CHECK (${EXECUTION.up})`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_delivered" CHECK ("delivered" IS NULL OR ("surface" = 'tool_result' AND (NOT "delivered" OR ("capture" = 'captured' AND "validation" = 'valid'))))`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_delivered"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_execution"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_execution" CHECK (${EXECUTION.down})`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP COLUMN "delivered"`,
    );
  }
}
