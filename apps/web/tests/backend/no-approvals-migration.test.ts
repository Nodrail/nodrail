// Migration NoApprovals: what only served approvals goes, and the
// rows that remain mean what they mean now. Down restores the structure.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test } from "vitest";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";

const tables = async (client: Client) =>
  (
    await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'nodrail'
         AND table_name IN ('approval_requests', 'insight_dismissals')
       ORDER BY table_name`,
    )
  ).rows.map((row: { table_name: string }) => row.table_name);

const forced = async (client: Client) =>
  Object.fromEntries(
    (
      await client.query(
        `SELECT relname, relforcerowsecurity FROM pg_class
         WHERE relnamespace = 'nodrail'::regnamespace
           AND relname IN ('action_requests', 'installation_credentials',
                           'workspace_invites', 'policy_rules',
                           'workspace_memberships')`,
      )
    ).rows.map((row: { relname: string; relforcerowsecurity: boolean }) => [
      row.relname,
      row.relforcerowsecurity,
    ]),
  );

const rowSecurity = {
  action_requests: true,
  policy_rules: true,
  workspace_memberships: true,
  // Their lookups run before a workspace is known: never forced.
  installation_credentials: false,
  workspace_invites: false,
};

describe("migration NoApprovals", () => {
  test(
    "goes down and up again, moving what is left to allow or deny",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_noappr_updown`,
        async (urls) => {
          const client = new Client({ connectionString: urls.admin });
          await client.connect();
          try {
            expect(await tables(client)).toEqual([]);
            expect(await forced(client)).toEqual(rowSecurity);

            revertMigrationsThrough(urls.owner, "NoApprovals");
            expect(await tables(client)).toEqual([
              "approval_requests",
              "insight_dismissals",
            ]);
            expect(await forced(client)).toEqual(rowSecurity);

            // Rows only the old checks allow, without their neighbours.
            const [w, u, e, v, a, i] = Array.from({ length: 6 }, () =>
              randomUUID(),
            );
            await client.query("SET session_replication_role = replica");
            await client.query(
              `INSERT INTO nodrail.workspace_memberships
                 (workspace_id, user_id, role) VALUES ($1, $2, 'approver')`,
              [w, u],
            );
            await client.query(
              `INSERT INTO nodrail.policy_rules
                 (workspace_id, environment_id, policy_version_id,
                  logical_rule_id, name, tool_key, operation_key, effect,
                  resource_scope, updated_by, updated_at)
               VALUES ($1, $2, $3, $4, 'Review', 'github', 'pr.merge',
                       'require_approval', '{"kind":"repository","match":"any"}',
                       $5, now())`,
              [w, e, v, randomUUID(), u],
            );
            await client.query(
              `INSERT INTO nodrail.action_requests
                 (id, workspace_id, installation_id, agent_id, environment_id,
                  idempotency_key, tool_key, operation_key, resource_kind,
                  resource_id, permission_fingerprint, descriptor_digest,
                  action_digest, initial_policy_version_id, access_epoch,
                  initial_evaluation, expires_at)
               VALUES ($1, $2, $3, $3, $4, 'k', 'github', 'pr.merge',
                       'repository', 'acme/app', 'f', 'd', 'a', $5, 1,
                       'approval_pending', now() + interval '1 hour')`,
              [a, w, i, e, v],
            );
            await client.query("SET session_replication_role = origin");

            runMigrations(urls.owner);
            expect(await tables(client)).toEqual([]);
            expect(await forced(client)).toEqual(rowSecurity);
            const one = async (sql: string, id: string) =>
              (await client.query(sql, [id])).rows[0] as unknown;
            await expect(
              one(
                `SELECT role FROM nodrail.workspace_memberships
                 WHERE workspace_id = $1`,
                w,
              ),
            ).resolves.toEqual({ role: "viewer" });
            await expect(
              one(
                `SELECT effect FROM nodrail.policy_rules WHERE workspace_id = $1`,
                w,
              ),
            ).resolves.toEqual({ effect: "deny" });
            await expect(
              one(
                `SELECT initial_evaluation FROM nodrail.action_requests
                 WHERE id = $1`,
                a,
              ),
            ).resolves.toEqual({ initial_evaluation: "denied" });
            await expect(
              client.query(
                `UPDATE nodrail.workspace_memberships SET role = 'approver'
                 WHERE workspace_id = $1`,
                [w],
              ),
            ).rejects.toThrow(/memberships_role/);
          } finally {
            await client.end();
          }
        },
      ),
    120_000,
  );
});
