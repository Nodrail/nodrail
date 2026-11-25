import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { readWorkspace } from "@/server/db/context";
import { getBilling } from "@/server/modules/billing";
import { dispatch, rig, step } from "./runs-world";
import { admin, useDatabase, useDeployment, type TestWorkspace } from "./world";

useDatabase();

const billingOf = (w: TestWorkspace) =>
  readWorkspace(w.owner, w.id, (context) => getBilling(context));

const setSteps = (w: TestWorkspace, steps: number) =>
  admin.query(
    `INSERT INTO nodrail.billing_usage (workspace_id, period, steps)
     VALUES ($1, date_trunc('month', timezone('UTC', now()))::date, $2)
     ON CONFLICT (workspace_id, period) DO UPDATE SET steps = EXCLUDED.steps`,
    [w.id, steps],
  );

const stored = async (w: TestWorkspace, id: string) => {
  const [row]: { n: number }[] = await admin.query(
    `SELECT count(*)::int AS n FROM nodrail.run_steps
     WHERE workspace_id = $1 AND step_key = $2`,
    [w.id, id],
  );
  return row?.n ?? 0;
};

const event = (id: string, kind: "started" | "finished", key = "ENG-1") => ({
  run: { key },
  step: { id, agent: "qa" },
  event: kind,
});

// Cloud plans: Free and Pro allowances only exist on Cloud.
useDeployment("cloud");

describe("the monthly step allowance", () => {
  test("a step counts once, when first recorded, and never as an action", async () => {
    const { w, token } = await rig();
    const id = randomUUID();
    await step(token, event(id, "started"));
    await step(token, event(id, "started"));
    await step(token, event(id, "finished"));
    await step(token, event(id, "finished"));
    const billing = await billingOf(w);
    expect(billing.steps).toEqual({ used: 1, limit: 1000, state: "ok" });
    expect(billing.usage.used).toBe(0);
  });

  test("past it, a new step is refused and not stored", async () => {
    const { w, token } = await rig();
    await setSteps(w, 1000);
    const id = randomUUID();
    await expect(step(token, event(id, "started"))).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect(await stored(w, id)).toBe(0);
    expect((await billingOf(w)).steps.state).toBe("reached");
  });

  test("a step already recorded can still finish past it", async () => {
    const { w, token } = await rig();
    const id = randomUUID();
    await step(token, event(id, "started"));
    await setSteps(w, 1000);
    await expect(step(token, event(id, "finished"))).resolves.toEqual({
      recorded: true,
    });
  });

  test("a step an action names is paid for by the action", async () => {
    const { w, token } = await rig();
    await setSteps(w, 1000);
    const id = randomUUID();
    await dispatch(token, "qa", { key: "ENG-2", step: { id, agent: "dev" } });
    expect(await stored(w, id)).toBe(1);
    expect((await billingOf(w)).usage.used).toBe(1);
  });
});
