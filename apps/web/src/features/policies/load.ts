import "server-only";
import { readForPage } from "@/features/shell/load-view";
import type { WorkspaceContext } from "@/server/db/context";
import { listAgentOptions } from "@/server/modules/agents";
import { listRules } from "@/server/modules/policies";
import { policySuggestions } from "@/server/modules/policies/suggestions";
import { ruleLastMatched } from "@/server/modules/policies/usage";
import { activeRunPolicy } from "@/server/modules/runs/policy";

const rulesAndAgents = async (
  context: WorkspaceContext,
  environment: string,
) => ({
  rules: (await listRules(context, environment)).rules,
  agents: await listAgentOptions(context, environment),
});

/** What the rule forms need: the rules to compare with, and agents. */
export function loadRulesAndAgents(workspace: string, environment: string) {
  return readForPage(workspace, (context) =>
    rulesAndAgents(context, environment),
  );
}

/** What a rule list needs: the rules, agents, and when each rule last matched. */
export function loadRuleList(workspace: string, environment: string) {
  return readForPage(workspace, async (context) => ({
    ...(await rulesAndAgents(context, environment)),
    lastMatched: await ruleLastMatched(context, environment),
  }));
}

/** What the gate and budget forms need: the live gates and budgets, and agents. */
export function loadRunPolicyAndAgents(workspace: string, environment: string) {
  return readForPage(workspace, async (context) => ({
    policy: await activeRunPolicy(context, environment),
    agents: await listAgentOptions(context, environment),
  }));
}

/** Names this environment has seen, for a policy form's suggestions. */
export function loadSuggestions(workspace: string, environment: string) {
  return readForPage(workspace, (context) =>
    policySuggestions(context, environment),
  );
}
