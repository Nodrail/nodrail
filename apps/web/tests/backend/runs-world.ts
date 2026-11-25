import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  withRuntime,
  withWorkspace,
  type RuntimeContext,
  type RuntimeScope,
} from "@/server/db/context";
import {
  applyPolicyFile,
  previewPolicyFile,
} from "@/server/modules/policies/rule-files";
import { submitAction } from "@/server/modules/runtime";
import { recordStep } from "@/server/modules/runs/steps";
import {
  createAgent,
  createWorkspace,
  issueToken,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

export const ENV = "development";

export const RULES = `- required_engine_version: 3

- list: builders
  items: [dev, infra]

- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow

- gate: Review before the pull request
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: github }
  requires:
    - { agent: qa, verdict: pass, since: { list: builders } }
    - { agent: reviewer, verdict: [ship, ship_with_debt], since: { list: builders } }
  otherwise: deny

- gate: QA before a deploy
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: deploy }
  requires:
    - { agent: qa, verdict: pass }
  otherwise: deny

- budget: Builder step
  step_agent: dev
  per: step
  tool_calls: 2
  otherwise: deny
`;

export async function publish(w: TestWorkspace, text = RULES) {
  return withWorkspace(w.owner, w.id, async (context) => {
    const preview = await previewPolicyFile(context, ENV, text);
    expect(preview.issues).toEqual([]);
    return applyPolicyFile(context, ENV, text, {
      revision: preview.policyRevision,
      fileDigest: preview.fileDigest,
    });
  });
}

/** A workspace with an agent's token and the rules above published. */
export async function rig() {
  const { w, token } = await workspaceWithToken();
  await publish(w);
  return { w, token };
}

export const call = <T>(
  token: string,
  scope: RuntimeScope,
  run: (context: RuntimeContext) => Promise<T>,
) => withRuntime(token, scope, run);

export type Run = { key: string; step?: { id: string; agent: string } };

/** The main agent, or a step, starting a subagent. */
export const dispatch = (token: string, target: string, run?: Run) =>
  call(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      tool: "claude-code",
      operation: "agent",
      resource: { kind: "agent", id: target },
      params: { subagent_type: target },
      ...(run ? { run } : {}),
    }),
  );

export const step = (token: string, body: object) =>
  call(token, "actions:submit", (context) => recordStep(context, body));

/** A whole step: started, then finished with this verdict and spend. */
export async function work(
  token: string,
  key: string,
  agent: string,
  verdict?: string,
  spend?: { usd: number; tokens: number },
) {
  const id = `${agent}-${randomUUID().slice(0, 8)}`;
  const usage = spend ? `\nusd: ${spend.usd}\ntokens: ${spend.tokens}` : "";
  await step(token, { run: { key }, step: { id, agent }, event: "started" });
  await step(token, {
    run: { key },
    step: { id, agent },
    event: "finished",
    ...(verdict
      ? {
          receipt: {
            text: `\`\`\`nodrail-receipt\nverdict: ${verdict}${usage}\n\`\`\``,
          },
        }
      : {}),
  });
  return id;
}

/** Two runs a gate holds (a deploy and a pull request), and one quiet run. */
export async function runsWorkspace() {
  const w = await createWorkspace();
  const bot = await createAgent(w, "bot");
  const other = await createAgent(w, "other");
  await publish(w);
  const token = await issueToken(w, bot);
  await work(token, "feat/held", "dev", "done");
  await dispatch(token, "deploy", { key: "feat/held" });
  await work(token, "feat/waiting", "qa", "fail");
  await dispatch(token, "github", { key: "feat/waiting" });
  await work(token, "feat/quiet", "qa", "pass");
  return { w, bot, other, token };
}
