import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/card";
import { ListSummary } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { AgentHeader } from "@/features/agents/components/agent-header";
import { loadAgentPage } from "@/features/agents/load";
import { RuleTable } from "@/features/policies/components/rule-table";
import { EnvironmentRepositoryPolicy } from "@/features/policies/environment-repository-policy";
import { loadRuleList } from "@/features/policies/load";
import { plural } from "@/lib/text";

type Props = PageProps<"/app/[workspace]/[environment]/agents/[agent]/rules">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await params).agent} rules` };
}

/** The rules that decide for this agent: its own, and those for all agents. */
export default async function AgentRulesPage({ params }: Props) {
  const { workspace, environment, agent: agentKey } = await params;
  const page = await loadAgentPage(workspace, environment, agentKey);
  const { agent, base, view } = page;
  const { rules, lastMatched } = await loadRuleList(workspace, environment);
  const applying = rules.filter(
    (rule) => !rule.agentKey || rule.agentKey === agent.key,
  );
  const canManage = view.capabilities.includes("policies:write");
  const newRule = canManage ? (
    <Button asChild>
      <Link href={`${base}/policies/new?agent=${agent.key}`}>
        New rule for {agent.key}
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <AgentHeader page={page} workspace={workspace} current="rules" />
      {applying.length === 0 ? (
        <EmptyState title={`No rules apply to ${agent.key}`} action={newRule}>
          Until one does, each of its actions is denied.
        </EmptyState>
      ) : (
        <>
          <div className="mb-[13px] flex flex-wrap items-center justify-between gap-2">
            <ListSummary className="mb-0">
              {plural(applying.length, "rule")} for {agent.key} or for every
              agent
            </ListSummary>
            {newRule}
          </div>
          <EnvironmentRepositoryPolicy
            workspace={workspace}
            environment={environment}
          >
            <RuleTable
              workspace={workspace}
              environment={environment}
              rules={applying}
              lastMatched={lastMatched}
              agents={[]}
              initialAgent=""
              canManage={canManage}
            />
          </EnvironmentRepositoryPolicy>
        </>
      )}
    </>
  );
}
