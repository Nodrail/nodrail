// Self-hosted operations (CW-06): each scheduled run is recorded, and the
// operator's readiness check says what is set up and when delivery and
// retention last ran, behind the scheduler's secret.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as ready from "@/app/api/health/ready/route";
import * as deliver from "@/app/api/internal/notifications/deliver/route";
import { admin, useDatabase } from "./world";

useDatabase();

const SECRET = "readiness-test-secret-1234567890";
const saved = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, {
    NOTIFICATIONS_SECRET: SECRET,
    APP_ORIGIN: "http://127.0.0.1:3100",
    NODRAIL_DEPLOYMENT: "self-hosted",
  });
  delete process.env.SMTP_URL;
});
afterAll(() => {
  for (const key of [
    "NOTIFICATIONS_SECRET",
    "APP_ORIGIN",
    "NODRAIL_DEPLOYMENT",
    "SMTP_URL",
  ])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});

const call = (
  handler: (request: NextRequest) => Promise<Response>,
  path: string,
  secret: string | null = SECRET,
  method = "GET",
) =>
  handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  );

describe("readiness", () => {
  test("only with the scheduler's secret", async () => {
    expect((await call(ready.GET, "/api/health/ready", null)).status).toBe(401);
    expect((await call(ready.GET, "/api/health/ready", "wrong")).status).toBe(
      401,
    );
  });

  test("not ready until the scheduler has run; then each part says what it is", async () => {
    await admin.query("DELETE FROM nodrail.scheduled_runs");
    const before = await call(ready.GET, "/api/health/ready");
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({
      ready: false,
      deployment: "self-hosted",
      checks: {
        database: "ok",
        auth: "configured",
        email: "missing",
        scheduler: "never run",
      },
    });

    const ran = await call(
      deliver.POST,
      "/api/internal/notifications/deliver",
      SECRET,
      "POST",
    );
    expect(ran.status).toBe(200);
    const after = await call(ready.GET, "/api/health/ready");
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({
      ready: true,
      checks: { scheduler: "ok", email: "missing" },
      scheduler: { job: "deliver", runs: 1, lastError: null },
    });
  });

  test("a scheduler that stopped is stale", async () => {
    await admin.query(
      `UPDATE nodrail.scheduled_runs
       SET last_succeeded_at = now() - interval '3 hours' WHERE job = 'deliver'`,
    );
    const stale = await call(ready.GET, "/api/health/ready");
    expect(stale.status).toBe(503);
    expect((await stale.json()).checks.scheduler).toBe("stale");
  });
});
