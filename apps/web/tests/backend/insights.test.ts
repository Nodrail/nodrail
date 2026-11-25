import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { readWorkspace, withRuntime, withWorkspace } from "@/server/db/context";
import { getDecisionMetrics, getRuleMetrics } from "@/server/modules/insights";
import { createRule } from "@/server/modules/policies";
import { submitAction } from "@/server/modules/runtime";
import {
  admin,
  permitFor,
  ruleBody,
  useDatabase,
  workspaceWithToken,
} from "./world";

useDatabase();

const ENV = "development";

/** A workspace with agent "bot", its token, and no rule for issues.create. */
const rig = workspaceWithToken;

const submit = (token: string, operation = "issues.create") =>
  withRuntime(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      tool: "github",
      operation,
      resource: { kind: "repository", id: "acme/app" },
      params: { title: "Hello" },
    }),
  );

describe("decision and rule metrics", () => {
  /**
   * Counted by hand. The agent comes with one denied action (issues.delete)
   * and its "bot rule" allowing issues.list. Then: issues.create twice, which
   * no rule covers, so both are denied; issues.list allowed by the bot rule
   * (permit asked), and repos.delete denied by a deny rule. Nothing waits.
   *
   * Actions 5: allowed 1, denied 4, of which no rule 2. Rules, all older
   * than the window: bot rule and the deny rule matched once each, "Close
   * issues" never; the rules decided 3 of the 5.
   */
  test("match the hand-counted fixture", async () => {
    const { w, token } = await rig();
    const rule = (name: string, operation: string, effect: "allow" | "deny") =>
      withWorkspace(w.owner, w.id, (context) =>
        createRule(
          context,
          ENV,
          ruleBody({
            name,
            effect,
            operationKey: operation,
            resource: { kind: "repository", match: "any" },
          }),
        ),
      );
    await rule("Block deletes", "repos.delete", "deny");
    await rule("Close issues", "issues.close", "allow");
    await admin.query(
      `UPDATE nodrail.policy_rules SET updated_at = now() - interval '100 days'
       WHERE workspace_id = $1`,
      [w.id],
    );

    expect((await submit(token)).code).toBe("DENIED");
    expect((await submit(token)).code).toBe("DENIED");
    const listed = await submit(token, "issues.list");
    expect(listed.code).toBe("READY");
    await permitFor(token, listed);
    expect((await submit(token, "repos.delete")).code).toBe("DENIED");

    const decisions = await readWorkspace(w.owner, w.id, (context) =>
      getDecisionMetrics(context, ENV, 30),
    );
    expect(decisions).toEqual({ actions: 5, allowed: 1, denied: 4, noRule: 2 });

    const rules = await readWorkspace(w.owner, w.id, (context) =>
      getRuleMetrics(context, ENV, 30),
    );
    expect(rules).toEqual({
      top: [
        expect.objectContaining({ name: "Block deletes", matches: 1 }),
        expect.objectContaining({ name: "bot rule", matches: 1 }),
      ],
      unused: [
        expect.objectContaining({
          name: "Close issues",
          effect: "allow",
          matches: 0,
          lastMatchedAt: null,
        }),
      ],
      newer: 0,
      activeRules: 3,
      decided: { count: 3, of: 5 },
    });
  });

  test("a rule younger than the window is not called unused", async () => {
    const { w } = await rig();
    const rules = await readWorkspace(w.owner, w.id, (context) =>
      getRuleMetrics(context, ENV, 7),
    );
    expect(rules).toMatchObject({ unused: [], newer: 1, activeRules: 1 });
  });
});
