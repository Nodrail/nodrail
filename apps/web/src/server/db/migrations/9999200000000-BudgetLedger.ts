import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Numeric budgets in Cloud: `budget_windows`, the rows a
 * permit locks in key order before it counts a call, and
 * `budget_reservations`, one per call and budget, settled by the call's
 * report or by an admin or policy manager. Plus `action_subjects`: the work
 * revision an installation sends with an action and again with its permit
 * (`run.subject`, `subject`), which gates on `subject: revision` read.
 *
 * Only new tables; nothing existing is touched or rewritten. Going down
 * drops them with their rows: without them no permit can count a numeric
 * budget, so a version 4 policy holds every call one covers, as engines
 * without a ledger do, and no subject is known, so revision gates stay unmet.
 */
const TABLES = [
  "budget_windows",
  "budget_reservations",
  "action_subjects",
] as const;

const inRequests =
  "action_request_id IN (SELECT id FROM nodrail.action_requests)";

/** What a person who doesn't see the whole workspace may read. */
const MEMBER_SCOPE: Record<(typeof TABLES)[number], string> = {
  budget_windows: "(SELECT nodrail.sees_whole_workspace())",
  budget_reservations: inRequests,
  action_subjects: inRequests,
};

export class BudgetLedger9999200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."budget_windows" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "budget_key" text NOT NULL, "window_key" text NOT NULL, "per" text NOT NULL, "across" text NOT NULL, "run_id" uuid, "run_key" text, "step_key" text, "day" text, "timezone" text, "starts_at" TIMESTAMP WITH TIME ZONE, "ends_at" TIMESTAMP WITH TIME ZONE, "unit" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "touched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_52b562ca508e8b10eed36d86ea8" UNIQUE ("workspace_id", "id"), CONSTRAINT "budget_windows_key" UNIQUE ("workspace_id", "environment_id", "budget_key", "window_key"), CONSTRAINT "budget_windows_scope" CHECK (("across" = 'run') = ("run_id" IS NOT NULL) AND ("per" = 'step') = ("step_key" IS NOT NULL) AND ("run_key" IS NULL OR length("run_key") BETWEEN 1 AND 200) AND length("step_key") <= 200 AND "unit" ~ '^[a-z][a-z0-9_]{0,31}$'), CONSTRAINT "budget_windows_window" CHECK (length("window_key") BETWEEN 1 AND 300 AND "per" IN ('step', 'run', 'day') AND "across" IN ('run', 'environment') AND ("per" = 'day') = ("day" IS NOT NULL) AND ("day" IS NULL) = ("timezone" IS NULL) AND ("day" IS NULL) = ("starts_at" IS NULL) AND ("starts_at" IS NULL) = ("ends_at" IS NULL) AND ("starts_at" IS NULL OR "ends_at" > "starts_at")), CONSTRAINT "budget_windows_budget" CHECK ("budget_key" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'), CONSTRAINT "PK_3531547cd7410430754866b22d5" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE TABLE "nodrail"."budget_reservations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "permit_id" uuid NOT NULL, "window_id" uuid NOT NULL, "budget_key" text NOT NULL, "source" text NOT NULL, "unit" text NOT NULL, "amount" bigint, "measured_path" text, "measured" bigint, "state" text NOT NULL DEFAULT 'reserved', "settled_by" text, "settled_at" TIMESTAMP WITH TIME ZONE, "reconciled_by" uuid, "note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "unknown_after" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "budget_reservations_once" UNIQUE ("workspace_id", "action_request_id", "budget_key"), CONSTRAINT "budget_reservations_amounts" CHECK ("source" IN ('admission', 'measured') AND ("source" = 'admission') = ("amount" IS NOT NULL) AND ("source" = 'measured') = ("measured_path" IS NOT NULL) AND ("amount" IS NULL OR "amount" >= 0) AND ("measured" IS NULL OR ("measured" >= 0 AND "source" = 'measured' AND "state" = 'consumed')) AND ("measured_path" IS NULL OR "measured_path" ~ '^(tokens|result(\\.[a-z][a-z0-9_]{0,62}){1,4})$') AND "unit" ~ '^[a-z][a-z0-9_]{0,31}$' AND "unknown_after" > "created_at"), CONSTRAINT "budget_reservations_state" CHECK ("state" IN ('reserved', 'consumed', 'released', 'unknown') AND ("state" = 'reserved') = ("settled_by" IS NULL) AND ("settled_by" IS NULL) = ("settled_at" IS NULL) AND ("settled_by" IS NULL OR "settled_by" IN ('runtime', 'person')) AND ("settled_by" = 'person') = ("reconciled_by" IS NOT NULL) AND ("settled_by" = 'person') = ("note" IS NOT NULL) AND length("note") BETWEEN 1 AND 500), CONSTRAINT "budget_reservations_budget" CHECK ("budget_key" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'), CONSTRAINT "PK_338ece04adbaedea1b64e01994f" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "budget_reservations_open" ON "nodrail"."budget_reservations"  ("workspace_id", "environment_id", "state", "created_at") `,
    );
    await run(
      `CREATE INDEX "budget_reservations_window" ON "nodrail"."budget_reservations"  ("workspace_id", "window_id", "state") `,
    );
    await run(
      `CREATE TABLE "nodrail"."action_subjects" ("workspace_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "stage" text NOT NULL, "revision" text, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "action_subjects_revision" CHECK ("revision" IS NULL OR "revision" ~ '^[0-9a-f]{64}$'), CONSTRAINT "action_subjects_stage" CHECK ("stage" IN ('submit', 'permit')), CONSTRAINT "PK_9301c6f01f0aeed3bb7b8b1e391" PRIMARY KEY ("workspace_id", "action_request_id", "stage"))`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_subjects" ADD CONSTRAINT "FK_d3f6c6edbd63dbc9666a85bc276" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_windows" ADD CONSTRAINT "FK_71bd79f23077065dd4f90bafcf6" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_reservations" ADD CONSTRAINT "FK_b0f2e00696512e6bbafa5e19dcf" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_reservations" ADD CONSTRAINT "FK_3195a9b995236ed4fb148cec39f" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_reservations" ADD CONSTRAINT "FK_6d92e0cf57b4f4b6ee98daa8673" FOREIGN KEY ("permit_id", "workspace_id", "action_request_id") REFERENCES "nodrail"."decision_permits"("id","workspace_id","action_request_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_reservations" ADD CONSTRAINT "FK_7bce834d869f270cd25ae108e7a" FOREIGN KEY ("window_id", "workspace_id") REFERENCES "nodrail"."budget_windows"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."budget_reservations" ADD CONSTRAINT "FK_0324296e07172e14b3476a0914d" FOREIGN KEY ("workspace_id", "reconciled_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    for (const table of TABLES) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
      await run(`
        CREATE POLICY member_scope ON nodrail.${table}
          AS RESTRICTIVE FOR SELECT TO nodrail_member_read
          USING (${MEMBER_SCOPE[table]})
      `);
      await run(
        `GRANT SELECT ON nodrail.${table} TO nodrail_app, nodrail_member_read`,
      );
    }
    // A window is only added; writing `touched_at` is how a permit locks it.
    await run("GRANT INSERT ON nodrail.budget_windows TO nodrail_app");
    await run(
      "GRANT UPDATE (touched_at) ON nodrail.budget_windows TO nodrail_app",
    );
    // A reservation is added once and only ever settled.
    await run("GRANT INSERT ON nodrail.budget_reservations TO nodrail_app");
    await run(
      "GRANT UPDATE (state, measured, settled_by, settled_at, reconciled_by, note) ON nodrail.budget_reservations TO nodrail_app",
    );
    await run("GRANT INSERT ON nodrail.action_subjects TO nodrail_app");
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    // Policies, grants, indexes and keys go with each table.
    for (const table of [...TABLES].reverse())
      await run(`DROP TABLE nodrail.${table}`);
  }
}
