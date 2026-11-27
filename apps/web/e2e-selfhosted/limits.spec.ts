import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { connect } from "../e2e-app/helpers";
import { acceptanceSql as sql, workspaceSlug } from "./database";
import { readState, storagePath } from "./state";

test.use({ storageState: storagePath() });

test("self-hosted: past Cloud's 1,000 free actions, calls go on", async ({
  page,
  baseURL,
}) => {
  const { base } = readState();
  const credential = await connect(page, base, `busy-${Date.now()}`);
  // This run's workspace only: the database may hold earlier runs.
  const workspace = sql(
    `SELECT c.workspace_id FROM nodrail.installation_credentials c
     JOIN nodrail.workspaces w ON w.id = c.workspace_id
     WHERE w.slug = '${workspaceSlug(base)}'
     ORDER BY c.created_at DESC LIMIT 1`,
  );
  sql(
    `INSERT INTO nodrail.billing_usage (workspace_id, period, intents)
     VALUES ('${workspace}', date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1500)
     ON CONFLICT (workspace_id, period) DO UPDATE SET intents = 1500`,
  );
  const submitted = await fetch(`${baseURL}/api/v1/runtime/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      tool: "github",
      operation: "issues.create",
      resource: { kind: "repository", id: "acme/app" },
      params: {},
    }),
  });
  expect(submitted.status).toBeLessThan(300);
  expect(
    sql(
      `SELECT intents FROM nodrail.billing_usage WHERE workspace_id = '${workspace}'`,
    ),
  ).toBe("1501");
});

test("a reporting token reads nothing; forged, malformed and oversized reports are refused", async ({
  baseURL,
}) => {
  const { token } = readState();
  const call = (
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ) =>
    fetch(`${baseURL}${path}`, {
      ...init,
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });
  expect((await call("/api/v1/me")).status).toBe(403);
  expect((await call("/api/v1/reported/decisions")).status).toBe(403);
  const json = { "content-type": "application/json" };
  const at = (BigInt(Date.now()) * 1_000_000n).toString();
  // Unique per run, so earlier runs' forged spans don't match.
  const project = `forged-${randomUUID()}`;
  const forged = await call("/api/v1/otlp/v1/traces", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "nodrail.project", value: { stringValue: project } },
              {
                key: "nodrail.workspace",
                value: { stringValue: randomUUID() },
              },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "9".repeat(32),
                  spanId: "9".repeat(16),
                  name: "nodrail.decision",
                  startTimeUnixNano: at,
                  endTimeUnixNano: at,
                  attributes: [
                    { key: "nodrail.host", value: { stringValue: "codex" } },
                    {
                      key: "nodrail.decision",
                      value: { stringValue: "allow" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  expect(forged.status).toBe(200);
  // Kept in the token's own workspace, whatever the span said.
  const where = sql(
    `SELECT w.slug FROM nodrail.reported_events e JOIN nodrail.workspaces w ON w.id = e.workspace_id
     WHERE e.project = '${project}'`,
  );
  expect(`/app/${where}/development`).toBe(readState().base);
  expect(
    (
      await call("/api/v1/otlp/v1/traces", {
        method: "POST",
        headers: json,
        body: "{nope",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("/api/v1/otlp/v1/traces", {
        method: "POST",
        headers: json,
        body: "x".repeat(600 * 1024),
      })
    ).status,
  ).toBe(422);
  const other = await fetch(`${baseURL}/api/v1/otlp/v1/traces`, {
    method: "POST",
    headers: {
      authorization: "Bearer ndp_000000000000_" + "A".repeat(43),
      ...json,
    },
    body: "{}",
  });
  expect(other.status).toBe(401);
});
